package elo

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/db"
	googlesheet "github.com/tolyandre/elo-web-service/pkg/google-sheet"
)

type MatchService struct {
	Queries *db.Queries
	Pool    *pgxpool.Pool
}

func NewMatchService(pool *pgxpool.Pool) IMatchService {
	return &MatchService{
		Queries: db.New(pool),
		Pool:    pool,
	}
}

type IMatchService interface {
	ReplaceMatches(ctx context.Context, matchRows []googlesheet.MatchRow) ([]db.Match, error)
}

func (s *MatchService) ReplaceMatches(ctx context.Context, matchRows []googlesheet.MatchRow) ([]db.Match, error) {

	// start a transaction so replace is atomic
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("unable to begin tx: %v", err)
	}
	// ensure rollback on error
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := s.Queries.WithTx(tx)

	// delete existing data
	if err := q.DeleteAllMatchScores(ctx); err != nil {
		return nil, fmt.Errorf("unable to delete match_scores: %v", err)
	}
	if err := q.DeleteAllMatches(ctx); err != nil {
		return nil, fmt.Errorf("unable to delete matches: %v", err)
	}

	inserted := make([]db.Match, 0, len(matchRows))

	// skip first row as it contains start elo value (fake match)
	for idx, mr := range matchRows[1:] {
		// find or create game
		game, err := q.GetGameByName(ctx, mr.Game)
		if err != nil {
			// try to create the game if it doesn't exist
			game, err = q.AddGame(ctx, mr.Game)
			if err != nil {
				return nil, fmt.Errorf("unable to find or create game '%s': %v", mr.Game, err)
			}
		}

		// prepare date and row values
		// ensure date is not nil: use current row date, else next row's date, else now
		var effectiveDate *time.Time
		if mr.Date != nil {
			effectiveDate = mr.Date
		} else {
			// look for next row with date
			for j := idx + 1; j < len(matchRows); j++ {
				if matchRows[j].Date != nil {
					effectiveDate = matchRows[j].Date
					break
				}
			}
			if effectiveDate == nil {
				now := time.Now()
				effectiveDate = &now
			}
		}

		dt := pgtype.Timestamptz{Time: *effectiveDate, Valid: true}

		gsRow := pgtype.Int4{Int32: int32(mr.RowNum), Valid: true}

		createdMatch, err := q.CreateMatch(ctx, db.CreateMatchParams{Date: dt, GameID: game.ID, GoogleSheetRow: gsRow})
		if err != nil {
			return nil, fmt.Errorf("unable to create match for row %d: %v", mr.RowNum, err)
		}

		// create or upsert scores
		for playerName, score := range mr.PlayersScore {
			player, err := q.GetPlayerByName(ctx, playerName)
			if err != nil {
				// create missing player
				p, err2 := q.CreatePlayer(ctx, db.CreatePlayerParams{Name: playerName, GeologistName: pgtype.Text{Valid: false}, GoogleSheetColumn: pgtype.Int4{Valid: false}})
				if err2 != nil {
					return nil, fmt.Errorf("unable to find or create player '%s': %v", playerName, err2)
				}
				player = p
			}

			if err := q.UpsertMatchScore(ctx, db.UpsertMatchScoreParams{MatchID: createdMatch.ID, PlayerID: player.ID, Score: score}); err != nil {
				return nil, fmt.Errorf("unable to upsert match score for match %d player %s: %v", createdMatch.ID, playerName, err)
			}
		}

		inserted = append(inserted, createdMatch)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("unable to commit tx: %v", err)
	}

	return inserted, nil
}
