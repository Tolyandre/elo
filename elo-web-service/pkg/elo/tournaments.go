package elo

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

type ITournamentService interface {
	ListTournaments(ctx context.Context) ([]db.ListTournamentsRow, error)
	GetTournament(ctx context.Context, tournamentID id.ID) ([]db.GetTournamentRow, error)
	CreateTournament(ctx context.Context, tournamentID id.ID, name string, start, end time.Time, playerIDs []id.ID) (db.Tournament, error)
	// UpdateTournament replaces a tournament's name, dates and full member set in one
	// transaction. It rejects narrowing the dates past already-played matches and
	// removing a member who has played a match in the tournament.
	UpdateTournament(ctx context.Context, tournamentID id.ID, name string, start, end time.Time, playerIDs []id.ID) (db.Tournament, error)
	// DeleteTournament removes a tournament only when it has no members.
	DeleteTournament(ctx context.Context, tournamentID id.ID) (db.Tournament, error)
	GetStats(ctx context.Context, tournamentID id.ID) ([]db.GetTournamentStatsRow, error)
}

type TournamentService struct {
	Queries *db.Queries
	Pool    *pgxpool.Pool
}

func NewTournamentService(pool *pgxpool.Pool) ITournamentService {
	return &TournamentService{Queries: db.New(pool), Pool: pool}
}

func (s *TournamentService) ListTournaments(ctx context.Context) ([]db.ListTournamentsRow, error) {
	return s.Queries.ListTournaments(ctx)
}

func (s *TournamentService) GetTournament(ctx context.Context, tournamentID id.ID) ([]db.GetTournamentRow, error) {
	return s.Queries.GetTournament(ctx, tournamentID)
}

func (s *TournamentService) GetStats(ctx context.Context, tournamentID id.ID) ([]db.GetTournamentStatsRow, error) {
	return s.Queries.GetTournamentStats(ctx, tournamentID)
}

func (s *TournamentService) CreateTournament(ctx context.Context, tournamentID id.ID, name string, start, end time.Time, playerIDs []id.ID) (db.Tournament, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return db.Tournament{}, fmt.Errorf("unable to begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.Queries.WithTx(tx)

	created, err := q.CreateTournament(ctx, db.CreateTournamentParams{
		ID:        tournamentID,
		Name:      name,
		StartDate: pgtype.Timestamptz{Time: start, Valid: true},
		EndDate:   pgtype.Timestamptz{Time: end, Valid: true},
	})
	if err != nil {
		return db.Tournament{}, err
	}
	for _, pid := range playerIDs {
		if err := q.AddTournamentMember(ctx, db.AddTournamentMemberParams{TournamentID: created.ID, PlayerID: pid}); err != nil {
			return db.Tournament{}, fmt.Errorf("add member %s: %w", pid, err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return db.Tournament{}, fmt.Errorf("commit tx: %w", err)
	}
	return created, nil
}

func (s *TournamentService) UpdateTournament(ctx context.Context, tournamentID id.ID, name string, start, end time.Time, playerIDs []id.ID) (db.Tournament, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return db.Tournament{}, fmt.Errorf("unable to begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.Queries.WithTx(tx)

	// New dates must still cover every already-played match in the tournament.
	dateRange, err := q.GetTournamentMatchDateRange(ctx, tournamentID)
	if err != nil && !db.IsNoRows(err) {
		return db.Tournament{}, fmt.Errorf("get tournament match date range: %w", err)
	}
	if err == nil { // there are matches
		if start.After(dateRange.MinDate) || end.Before(dateRange.MaxDate) {
			return db.Tournament{}, ErrTournamentDatesNarrowEloRange
		}
	}

	// A removed member must not have played any match in the tournament.
	current, err := q.GetTournament(ctx, tournamentID)
	if err != nil {
		return db.Tournament{}, fmt.Errorf("get tournament: %w", err)
	}
	desired := make(map[id.ID]bool, len(playerIDs))
	for _, pid := range playerIDs {
		desired[pid] = true
	}
	currentSet := make(map[id.ID]bool)
	for _, r := range current {
		if r.PlayerID == nil {
			continue
		}
		currentSet[*r.PlayerID] = true
		if !desired[*r.PlayerID] {
			hasMatch, err := q.PlayerHasMatchInTournament(ctx, db.PlayerHasMatchInTournamentParams{TournamentID: tournamentID, PlayerID: *r.PlayerID})
			if err != nil {
				return db.Tournament{}, fmt.Errorf("check player matches: %w", err)
			}
			if hasMatch {
				return db.Tournament{}, ErrTournamentMemberHasMatches
			}
		}
	}

	updated, err := q.UpdateTournament(ctx, db.UpdateTournamentParams{
		ID:        tournamentID,
		Name:      name,
		StartDate: pgtype.Timestamptz{Time: start, Valid: true},
		EndDate:   pgtype.Timestamptz{Time: end, Valid: true},
	})
	if err != nil {
		// ErrNoRows (tournament not found) and unique-violation are returned raw so
		// the handler can map them to 404 / 409.
		return db.Tournament{}, err
	}

	for pid := range desired {
		if !currentSet[pid] {
			if err := q.AddTournamentMember(ctx, db.AddTournamentMemberParams{TournamentID: tournamentID, PlayerID: pid}); err != nil {
				return db.Tournament{}, fmt.Errorf("add member %s: %w", pid, err)
			}
		}
	}
	for pid := range currentSet {
		if !desired[pid] {
			if err := q.RemoveTournamentMember(ctx, db.RemoveTournamentMemberParams{TournamentID: tournamentID, PlayerID: pid}); err != nil {
				return db.Tournament{}, fmt.Errorf("remove member %s: %w", pid, err)
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return db.Tournament{}, fmt.Errorf("commit tx: %w", err)
	}
	return updated, nil
}

func (s *TournamentService) DeleteTournament(ctx context.Context, tournamentID id.ID) (db.Tournament, error) {
	count, err := s.Queries.CountTournamentMembers(ctx, tournamentID)
	if err != nil {
		return db.Tournament{}, fmt.Errorf("count members: %w", err)
	}
	if count > 0 {
		return db.Tournament{}, ErrTournamentHasMembers
	}
	return s.Queries.DeleteTournament(ctx, tournamentID)
}
