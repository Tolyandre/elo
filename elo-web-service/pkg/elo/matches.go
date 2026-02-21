package elo

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/db"
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
	AddMatch(ctx context.Context, gameID int32, playerScores map[int32]float64, date *time.Time, googleSheetRow *int) (db.Match, error)
}

// AddMatch adds a single match with Elo calculations
// Validates that game_id and all player_ids exist via foreign key constraints
func (s *MatchService) AddMatch(ctx context.Context, gameID int32, playerScores map[int32]float64, date *time.Time, googleSheetRow *int) (db.Match, error) {
	// start a transaction
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return db.Match{}, fmt.Errorf("unable to begin tx: %v", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := s.Queries.WithTx(tx)

	// prepare date parameter
	var dt pgtype.Timestamptz
	var effectiveDate time.Time
	if date == nil {
		dt = pgtype.Timestamptz{Valid: false}
		// Use current time for settings lookup if match date is not specified
		effectiveDate = time.Now()
	} else {
		dt = pgtype.Timestamptz{Time: *date, Valid: true}
		effectiveDate = *date
	}

	// Get Elo settings for the match date
	settings, err := q.GetEloSettingsForDate(ctx, pgtype.Timestamptz{Time: effectiveDate, Valid: true})
	if err != nil {
		return db.Match{}, fmt.Errorf("unable to get Elo settings for date %v: %v", effectiveDate, err)
	}

	eloConstK := settings.EloConstK
	eloConstD := settings.EloConstD

	// prepare google sheet row parameter
	var gsRow pgtype.Int4
	if googleSheetRow == nil {
		gsRow = pgtype.Int4{Valid: false}
	} else {
		gsRow = pgtype.Int4{Int32: int32(*googleSheetRow), Valid: true}
	}

	// create match (foreign key will validate game_id exists)
	createdMatch, err := q.CreateMatch(ctx, db.CreateMatchParams{
		Date:           dt,
		GameID:         gameID,
		GoogleSheetRow: gsRow,
	})
	if err != nil {
		return db.Match{}, fmt.Errorf("unable to create match: %v", err)
	}

	// Get latest Elo for each player
	// IMPORTANT: Lock players in a consistent order (sorted by ID) to prevent deadlocks
	previousElo := make(map[int32]float64)

	// Sort player IDs to lock in consistent order
	playerIDs := make([]int32, 0, len(playerScores))
	for playerID := range playerScores {
		playerIDs = append(playerIDs, playerID)
	}
	// Sort numerically to ensure consistent locking order
	sortPlayerIDs(playerIDs)

	for _, playerID := range playerIDs {
		// Lock the player row to prevent concurrent Elo calculations
		// This ensures that if two matches are added concurrently for the same player,
		// they will be processed sequentially
		_, err = q.LockPlayerForEloCalculation(ctx, playerID)
		if err != nil {
			return db.Match{}, fmt.Errorf("unable to lock player %d for Elo calculation (player may not exist): %v", playerID, err)
		}

		// Get latest Elo for this player (now safe from concurrent updates)
		latestElo, err := q.GetPlayerLatestElo(ctx, playerID)
		if err != nil {
			// No previous matches, use starting Elo
			previousElo[playerID] = StartingElo
		} else {
			if latestElo.Valid {
				previousElo[playerID] = latestElo.Float64
			} else {
				previousElo[playerID] = StartingElo
			}
		}
	}

	// Calculate new Elos (convert to string keys for elo package)
	previousEloStr := make(map[string]float64)
	playerScoresStr := make(map[string]float64)
	for playerID, elo := range previousElo {
		key := fmt.Sprintf("%d", playerID)
		previousEloStr[key] = elo
	}
	for playerID, score := range playerScores {
		key := fmt.Sprintf("%d", playerID)
		playerScoresStr[key] = score
	}

	newElos := CalculateNewElo(previousEloStr, StartingElo, playerScoresStr, eloConstK, eloConstD)

	// Calculate individual components
	absoluteLoserScore := GetAsboluteLoserScore(playerScoresStr)

	// Create match scores with Elo values (foreign key will validate player_id exists)
	for playerID, score := range playerScores {
		playerIDStr := fmt.Sprintf("%d", playerID)
		prevElo := previousElo[playerID]
		newElo := newElos[playerIDStr]

		// elo_pay = -K * WinExpectation
		eloPay := -eloConstK * WinExpectation(prevElo, playerScoresStr, StartingElo, previousEloStr, eloConstD)

		// elo_earn = K * NormalizedScore
		eloEarn := eloConstK * NormalizedScore(score, playerScoresStr, absoluteLoserScore)

		if err := q.UpsertMatchScore(ctx, db.UpsertMatchScoreParams{
			MatchID:  createdMatch.ID,
			PlayerID: playerID,
			Score:    score,
			EloPay:   pgtype.Float8{Float64: eloPay, Valid: true},
			EloEarn:  pgtype.Float8{Float64: eloEarn, Valid: true},
			NewElo:   pgtype.Float8{Float64: newElo, Valid: true},
		}); err != nil {
			return db.Match{}, fmt.Errorf("unable to upsert match score for player %d: %v", playerID, err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return db.Match{}, fmt.Errorf("unable to commit tx: %v", err)
	}

	return createdMatch, nil
}

// sortPlayerIDs sorts player IDs numerically (for consistent locking order)
func sortPlayerIDs(ids []int32) {
	// Simple bubble sort is fine for small slices
	for i := 0; i < len(ids); i++ {
		for j := i + 1; j < len(ids); j++ {
			if ids[i] > ids[j] {
				ids[i], ids[j] = ids[j], ids[i]
			}
		}
	}
}

// func (s *MatchService) ReplaceMatches(ctx context.Context, matchRows []googlesheet.MatchRow) ([]db.Match, error) {
// 	// start a transaction so replace is atomic
// 	tx, err := s.Pool.Begin(ctx)
// 	if err != nil {
// 		return nil, fmt.Errorf("unable to begin tx: %v", err)
// 	}
// 	defer func() {
// 		_ = tx.Rollback(ctx)
// 	}()

// 	q := s.Queries.WithTx(tx)

// 	// delete existing data
// 	if err := q.DeleteAllMatchScores(ctx); err != nil {
// 		return nil, fmt.Errorf("unable to delete match_scores: %v", err)
// 	}
// 	if err := q.DeleteAllMatches(ctx); err != nil {
// 		return nil, fmt.Errorf("unable to delete matches: %v", err)
// 	}

// 	if err := tx.Commit(ctx); err != nil {
// 		return nil, fmt.Errorf("unable to commit delete tx: %v", err)
// 	}

// 	// Track current Elo for each player across matches
// 	// Use player name as key since that's what matchRows use
// 	currentElo := make(map[string]float64)

// 	inserted := make([]db.Match, 0, len(matchRows))

// 	// skip first row as it contains start elo value (fake match)
// 	for _, mr := range matchRows[1:] {
// 		// Use the tracked Elo from previous matches in the batch
// 		// instead of querying the database (which would be empty after deletion)

// 		// Override AddMatch to use our tracked Elo
// 		// Start a new transaction for each match
// 		tx, err := s.Pool.Begin(ctx)
// 		if err != nil {
// 			return nil, fmt.Errorf("unable to begin tx: %v", err)
// 		}

// 		q := s.Queries.WithTx(tx)

// 		// Get Elo settings for this match date
// 		var effectiveDate time.Time
// 		if mr.Date == nil {
// 			effectiveDate = time.Now()
// 		} else {
// 			effectiveDate = *mr.Date
// 		}

// 		dbSettings, err := q.GetEloSettingsForDate(ctx, pgtype.Timestamptz{Time: effectiveDate, Valid: true})
// 		if err != nil {
// 			_ = tx.Rollback(ctx)
// 			return nil, fmt.Errorf("unable to get Elo settings for date %v: %v", effectiveDate, err)
// 		}

// 		eloConstK := dbSettings.EloConstK
// 		eloConstD := dbSettings.EloConstD

// 		// find or create game
// 		game, err := q.GetGameByName(ctx, mr.Game)
// 		if err != nil {
// 			game, err = q.AddGame(ctx, mr.Game)
// 			if err != nil {
// 				_ = tx.Rollback(ctx)
// 				return nil, fmt.Errorf("unable to find or create game '%s': %v", mr.Game, err)
// 			}
// 		}

// 		// prepare date
// 		var dt pgtype.Timestamptz
// 		if mr.Date == nil {
// 			dt = pgtype.Timestamptz{Valid: false}
// 		} else {
// 			dt = pgtype.Timestamptz{Time: *mr.Date, Valid: true}
// 		}

// 		gsRow := pgtype.Int4{Int32: int32(mr.RowNum), Valid: true}

// 		createdMatch, err := q.CreateMatch(ctx, db.CreateMatchParams{
// 			Date:           dt,
// 			GameID:         game.ID,
// 			GoogleSheetRow: gsRow,
// 		})
// 		if err != nil {
// 			_ = tx.Rollback(ctx)
// 			return nil, fmt.Errorf("unable to create match for row %d: %v", mr.RowNum, err)
// 		}

// 		// Build previousElo map using tracked Elo from previous matches
// 		previousElo := make(map[string]float64)
// 		for playerName := range mr.PlayersScore {
// 			if elo, exists := currentElo[playerName]; exists {
// 				previousElo[playerName] = elo
// 			} else {
// 				previousElo[playerName] = StartingElo
// 			}
// 		}

// 		// Calculate new Elos
// 		newElos := CalculateNewElo(previousElo, StartingElo, mr.PlayersScore, eloConstK, eloConstD)

// 		absoluteLoserScore := GetAsboluteLoserScore(mr.PlayersScore)

// 		// create scores with Elo values
// 		for playerName, score := range mr.PlayersScore {
// 			player, err := q.GetPlayerByName(ctx, playerName)
// 			if err != nil {
// 				p, err2 := q.CreatePlayer(ctx, db.CreatePlayerParams{
// 					Name:              playerName,
// 					GeologistName:     pgtype.Text{Valid: false},
// 					GoogleSheetColumn: pgtype.Int4{Valid: false},
// 				})
// 				if err2 != nil {
// 					_ = tx.Rollback(ctx)
// 					return nil, fmt.Errorf("unable to find or create player '%s': %v", playerName, err2)
// 				}
// 				player = p
// 			}

// 			prevElo := previousElo[playerName]
// 			newElo := newElos[playerName]

// 			eloPay := -eloConstK * WinExpectation(prevElo, mr.PlayersScore, StartingElo, previousElo, eloConstD)
// 			eloEarn := eloConstK * NormalizedScore(score, mr.PlayersScore, absoluteLoserScore)

// 			if err := q.UpsertMatchScore(ctx, db.UpsertMatchScoreParams{
// 				MatchID:  createdMatch.ID,
// 				PlayerID: player.ID,
// 				Score:    score,
// 				EloPay:   pgtype.Float8{Float64: eloPay, Valid: true},
// 				EloEarn:  pgtype.Float8{Float64: eloEarn, Valid: true},
// 				NewElo:   pgtype.Float8{Float64: newElo, Valid: true},
// 			}); err != nil {
// 				_ = tx.Rollback(ctx)
// 				return nil, fmt.Errorf("unable to upsert match score for match %d player %s: %v", createdMatch.ID, playerName, err)
// 			}

// 			// Update tracked Elo for next match
// 			currentElo[playerName] = newElo
// 		}

// 		if err := tx.Commit(ctx); err != nil {
// 			return nil, fmt.Errorf("unable to commit tx: %v", err)
// 		}

// 		inserted = append(inserted, createdMatch)
// 	}

// 	return inserted, nil
// }
