package elo

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

type ITournamentService interface {
	ListTournaments(ctx context.Context) ([]db.ListTournamentsRow, error)
	GetTournament(ctx context.Context, id string) ([]db.GetTournamentRow, error)
	CreateTournament(ctx context.Context, id string, name string, start, end time.Time, playerIDs []string) (db.Tournament, error)
	// UpdateTournament replaces a tournament's name, dates and full member set in one
	// transaction. It rejects narrowing the dates past already-played matches and
	// removing a member who has played a match in the tournament.
	UpdateTournament(ctx context.Context, id string, name string, start, end time.Time, playerIDs []string) (db.Tournament, error)
	// DeleteTournament removes a tournament only when it has no members.
	DeleteTournament(ctx context.Context, id string) (db.Tournament, error)
	GetStats(ctx context.Context, id string) ([]db.GetTournamentStatsRow, error)
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

func (s *TournamentService) GetTournament(ctx context.Context, id string) ([]db.GetTournamentRow, error) {
	return s.Queries.GetTournament(ctx, id)
}

func (s *TournamentService) GetStats(ctx context.Context, id string) ([]db.GetTournamentStatsRow, error) {
	return s.Queries.GetTournamentStats(ctx, id)
}

func (s *TournamentService) CreateTournament(ctx context.Context, id string, name string, start, end time.Time, playerIDs []string) (db.Tournament, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return db.Tournament{}, fmt.Errorf("unable to begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.Queries.WithTx(tx)

	created, err := q.CreateTournament(ctx, db.CreateTournamentParams{
		ID:        id,
		Name:      name,
		StartDate: pgtype.Timestamptz{Time: start, Valid: true},
		EndDate:   pgtype.Timestamptz{Time: end, Valid: true},
	})
	if err != nil {
		return db.Tournament{}, err
	}
	for _, pid := range playerIDs {
		if err := q.AddTournamentMember(ctx, db.AddTournamentMemberParams{TournamentID: created.ID, PlayerID: pid}); err != nil {
			return db.Tournament{}, fmt.Errorf("add member %s: %v", pid, err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return db.Tournament{}, fmt.Errorf("commit tx: %v", err)
	}
	return created, nil
}

func (s *TournamentService) UpdateTournament(ctx context.Context, id string, name string, start, end time.Time, playerIDs []string) (db.Tournament, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return db.Tournament{}, fmt.Errorf("unable to begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.Queries.WithTx(tx)

	// New dates must still cover every already-played match in the tournament.
	dateRange, err := q.GetTournamentMatchDateRange(ctx, id)
	if err != nil && !db.IsNoRows(err) {
		return db.Tournament{}, fmt.Errorf("get tournament match date range: %v", err)
	}
	if err == nil { // there are matches
		if start.After(dateRange.MinDate) || end.Before(dateRange.MaxDate) {
			return db.Tournament{}, ErrTournamentDatesNarrowEloRange
		}
	}

	// A removed member must not have played any match in the tournament.
	current, err := q.GetTournament(ctx, id)
	if err != nil {
		return db.Tournament{}, fmt.Errorf("get tournament: %v", err)
	}
	desired := make(map[string]bool, len(playerIDs))
	for _, pid := range playerIDs {
		desired[pid] = true
	}
	currentSet := make(map[string]bool)
	for _, r := range current {
		if r.PlayerID == nil {
			continue
		}
		currentSet[*r.PlayerID] = true
		if !desired[*r.PlayerID] {
			hasMatch, err := q.PlayerHasMatchInTournament(ctx, db.PlayerHasMatchInTournamentParams{TournamentID: id, PlayerID: *r.PlayerID})
			if err != nil {
				return db.Tournament{}, fmt.Errorf("check player matches: %v", err)
			}
			if hasMatch {
				return db.Tournament{}, ErrTournamentMemberHasMatches
			}
		}
	}

	updated, err := q.UpdateTournament(ctx, db.UpdateTournamentParams{
		ID:        id,
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
			if err := q.AddTournamentMember(ctx, db.AddTournamentMemberParams{TournamentID: id, PlayerID: pid}); err != nil {
				return db.Tournament{}, fmt.Errorf("add member %s: %v", pid, err)
			}
		}
	}
	for pid := range currentSet {
		if !desired[pid] {
			if err := q.RemoveTournamentMember(ctx, db.RemoveTournamentMemberParams{TournamentID: id, PlayerID: pid}); err != nil {
				return db.Tournament{}, fmt.Errorf("remove member %s: %v", pid, err)
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return db.Tournament{}, fmt.Errorf("commit tx: %v", err)
	}
	return updated, nil
}

func (s *TournamentService) DeleteTournament(ctx context.Context, id string) (db.Tournament, error) {
	count, err := s.Queries.CountTournamentMembers(ctx, id)
	if err != nil {
		return db.Tournament{}, fmt.Errorf("count members: %v", err)
	}
	if count > 0 {
		return db.Tournament{}, ErrTournamentHasMembers
	}
	return s.Queries.DeleteTournament(ctx, id)
}
