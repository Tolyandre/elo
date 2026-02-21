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
	ReplaceMatches(ctx context.Context, matchRows []googlesheet.MatchRow, settings googlesheet.Settings) ([]db.Match, error)
}

func (s *MatchService) ReplaceMatches(ctx context.Context, matchRows []googlesheet.MatchRow, settings googlesheet.Settings) ([]db.Match, error) {

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

	// Track current Elo for each player across matches
	// Use player name as key since that's what matchRows use
	currentElo := make(map[string]float64)

	// skip first row as it contains start elo value (fake match)
	for /*idx*/ _, mr := range matchRows[1:] {
		// find or create game
		game, err := q.GetGameByName(ctx, mr.Game)
		if err != nil {
			// try to create the game if it doesn't exist
			game, err = q.AddGame(ctx, mr.Game)
			if err != nil {
				return nil, fmt.Errorf("unable to find or create game '%s': %v", mr.Game, err)
			}
		}

		// // prepare date and row values
		// // ensure date is not nil: use current row date, else next row's date, else now
		// var effectiveDate *time.Time
		// if mr.Date != nil {
		// 	effectiveDate = mr.Date
		// } else {
		// 	// look for next row with date
		// 	for j := idx + 1; j < len(matchRows); j++ {
		// 		if matchRows[j].Date != nil {
		// 			effectiveDate = matchRows[j].Date
		// 			break
		// 		}
		// 	}
		// 	if effectiveDate == nil {
		// 		now := time.Now()
		// 		effectiveDate = &now
		// 	}
		// }
		var effectiveDate *time.Time = mr.Date
		var dt pgtype.Timestamptz
		if effectiveDate == nil {
			dt = pgtype.Timestamptz{Valid: false}
		} else {
			dt = pgtype.Timestamptz{Time: *effectiveDate, Valid: true}
		}

		gsRow := pgtype.Int4{Int32: int32(mr.RowNum), Valid: true}

		createdMatch, err := q.CreateMatch(ctx, db.CreateMatchParams{Date: dt, GameID: game.ID, GoogleSheetRow: gsRow})
		if err != nil {
			return nil, fmt.Errorf("unable to create match for row %d: %v", mr.RowNum, err)
		}

		// Calculate Elo changes for this match
		// Build previousElo map for players in this match
		previousElo := make(map[string]float64)
		for playerName := range mr.PlayersScore {
			if elo, exists := currentElo[playerName]; exists {
				previousElo[playerName] = elo
			} else {
				previousElo[playerName] = StartingElo
			}
		}

		// Calculate new Elos using the elo package
		newElos := CalculateNewElo(previousElo, StartingElo, mr.PlayersScore, settings.EloConstK, settings.EloConstD)

		// Calculate individual components for each player
		absoluteLoserScore := GetAsboluteLoserScore(mr.PlayersScore)

		// create or upsert scores with Elo values
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

			// Calculate elo_pay and elo_earn
			prevElo := previousElo[playerName]
			newElo := newElos[playerName]

			// elo_pay = -K * WinExpectation
			eloPay := -settings.EloConstK * WinExpectation(prevElo, mr.PlayersScore, StartingElo, previousElo, settings.EloConstD)

			// elo_earn = K * NormalizedScore
			eloEarn := settings.EloConstK * NormalizedScore(score, mr.PlayersScore, absoluteLoserScore)

			if err := q.UpsertMatchScore(ctx, db.UpsertMatchScoreParams{
				MatchID:  createdMatch.ID,
				PlayerID: player.ID,
				Score:    score,
				EloPay:   pgtype.Float8{Float64: eloPay, Valid: true},
				EloEarn:  pgtype.Float8{Float64: eloEarn, Valid: true},
				NewElo:   pgtype.Float8{Float64: newElo, Valid: true},
			}); err != nil {
				return nil, fmt.Errorf("unable to upsert match score for match %d player %s: %v", createdMatch.ID, playerName, err)
			}

			// Update current Elo for this player
			currentElo[playerName] = newElo
		}

		inserted = append(inserted, createdMatch)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("unable to commit tx: %v", err)
	}

	return inserted, nil
}
