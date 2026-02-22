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
	UpdateMatch(ctx context.Context, matchID int32, gameID int32, playerScores map[int32]float64, date time.Time) (db.Match, error)
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

	// Calculate and store Elo using shared logic (inserts scores + Elo)
	err = s.calculateAndStoreEloWithScores(ctx, q, createdMatch.ID, playerScores, previousElo, eloConstK, eloConstD)
	if err != nil {
		return db.Match{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return db.Match{}, fmt.Errorf("unable to commit tx: %v", err)
	}

	return createdMatch, nil
}

// UpdateMatch updates an existing match and recalculates Elo ratings for all affected matches
// Date cannot be null and cannot change more than 3 days
func (s *MatchService) UpdateMatch(ctx context.Context, matchID int32, gameID int32, playerScores map[int32]float64, date time.Time) (db.Match, error) {
	// Start a transaction
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return db.Match{}, fmt.Errorf("unable to begin tx: %v", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := s.Queries.WithTx(tx)

	// Lock and get the existing match
	existingMatch, err := q.GetMatch(ctx, matchID)
	if err != nil {
		return db.Match{}, fmt.Errorf("unable to get match %d: %v", matchID, err)
	}

	// Validate date change
	var oldDate time.Time
	if existingMatch.Date.Valid {
		oldDate = existingMatch.Date.Time
	} else {
		// If old date was null, use a very early date for comparison
		oldDate = time.Date(1900, 1, 1, 0, 0, 0, 0, time.UTC)
	}

	// Check date change constraint (max 3 days)
	dateDiff := date.Sub(oldDate)
	if dateDiff < 0 {
		dateDiff = -dateDiff
	}
	if dateDiff > 3*24*time.Hour {
		return db.Match{}, fmt.Errorf("date change exceeds 3 days limit: old=%v, new=%v", oldDate, date)
	}

	// Determine the recalculation start date (earlier of old and new date)
	recalcStartDate := date
	if existingMatch.Date.Valid && existingMatch.Date.Time.Before(date) {
		recalcStartDate = existingMatch.Date.Time
	}

	// Update the match record
	err = q.UpdateMatch(ctx, db.UpdateMatchParams{
		ID:     matchID,
		Date:   pgtype.Timestamptz{Time: date, Valid: true},
		GameID: gameID,
	})
	if err != nil {
		return db.Match{}, fmt.Errorf("unable to update match: %v", err)
	}

	// Delete old match scores to handle player list changes
	err = q.DeleteMatchScores(ctx, matchID)
	if err != nil {
		return db.Match{}, fmt.Errorf("unable to delete old match scores: %v", err)
	}

	// Insert new match scores (Elo will be calculated in recalculation step)
	for playerID, score := range playerScores {
		err := q.UpsertMatchScore(ctx, db.UpsertMatchScoreParams{
			MatchID:  matchID,
			PlayerID: playerID,
			Score:    score,
			EloPay:   pgtype.Float8{Valid: false}, // Will be recalculated
			EloEarn:  pgtype.Float8{Valid: false}, // Will be recalculated
			NewElo:   pgtype.Float8{Valid: false}, // Will be recalculated
		})
		if err != nil {
			return db.Match{}, fmt.Errorf("unable to insert match score for player %d: %v", playerID, err)
		}
	}

	// Recalculate Elo for all matches from the start date onwards
	err = s.recalculateEloFromDate(ctx, q, recalcStartDate)
	if err != nil {
		return db.Match{}, fmt.Errorf("unable to recalculate Elo: %v", err)
	}

	// Commit the transaction
	if err := tx.Commit(ctx); err != nil {
		return db.Match{}, fmt.Errorf("unable to commit tx: %v", err)
	}

	// Fetch the updated match to return
	updatedMatch, err := s.Queries.GetMatch(ctx, matchID)
	if err != nil {
		return db.Match{}, fmt.Errorf("unable to fetch updated match: %v", matchID)
	}

	return updatedMatch, nil
}

// recalculateEloFromDate recalculates Elo ratings for all matches from the given date onwards
// Must be called within a transaction
func (s *MatchService) recalculateEloFromDate(ctx context.Context, q *db.Queries, startDate time.Time) error {
	// Get all matches from the start date onwards (chronologically ordered)
	matches, err := q.GetMatchesFromDate(ctx, pgtype.Timestamptz{Time: startDate, Valid: true})
	if err != nil {
		return fmt.Errorf("unable to get matches from date %v: %v", startDate, err)
	}

	// Process each match in chronological order
	for _, match := range matches {
		// Get the existing player scores for this match
		matchScores, err := q.GetMatchScoresForMatch(ctx, match.ID)
		if err != nil {
			return fmt.Errorf("unable to get scores for match %d: %v", match.ID, err)
		}

		// Build player scores map
		playerScores := make(map[int32]float64)
		for _, ms := range matchScores {
			playerScores[ms.PlayerID] = ms.Score
		}

		// Get Elo settings for this match date
		var effectiveDate time.Time
		if match.Date.Valid {
			effectiveDate = match.Date.Time
		} else {
			effectiveDate = time.Now()
		}

		settings, err := q.GetEloSettingsForDate(ctx, pgtype.Timestamptz{Time: effectiveDate, Valid: true})
		if err != nil {
			return fmt.Errorf("unable to get Elo settings for match %d date %v: %v", match.ID, effectiveDate, err)
		}

		eloConstK := settings.EloConstK
		eloConstD := settings.EloConstD

		// Lock players in consistent order and get their previous Elo
		previousElo := make(map[int32]float64)
		playerIDs := make([]int32, 0, len(playerScores))
		for playerID := range playerScores {
			playerIDs = append(playerIDs, playerID)
		}
		sortPlayerIDs(playerIDs)

		for _, playerID := range playerIDs {
			// Lock the player
			_, err = q.LockPlayerForEloCalculation(ctx, playerID)
			if err != nil {
				return fmt.Errorf("unable to lock player %d: %v", playerID, err)
			}

			// Get previous Elo (before this match)
			var prevElo pgtype.Float8
			if match.Date.Valid {
				prevElo, err = q.GetPlayerLatestEloBeforeMatch(ctx, db.GetPlayerLatestEloBeforeMatchParams{
					PlayerID: playerID,
					Date:     match.Date,
					ID:       match.ID,
				})
			} else {
				// For null dates, just get the latest Elo excluding this match
				prevElo, err = q.GetPlayerLatestEloBeforeMatch(ctx, db.GetPlayerLatestEloBeforeMatchParams{
					PlayerID: playerID,
					Date:     pgtype.Timestamptz{Time: time.Now(), Valid: true},
					ID:       match.ID,
				})
			}

			if err != nil || !prevElo.Valid {
				// No previous matches, use starting Elo
				previousElo[playerID] = StartingElo
			} else {
				previousElo[playerID] = prevElo.Float64
			}
		}

		// Calculate new Elos using the shared calculation logic
		err = s.calculateAndUpdateElo(ctx, q, match.ID, playerScores, previousElo, eloConstK, eloConstD)
		if err != nil {
			return fmt.Errorf("unable to calculate Elo for match %d: %v", match.ID, err)
		}
	}

	return nil
}

// calculateAndStoreEloWithScores calculates Elo and inserts/updates match_scores with scores and Elo
// Used by AddMatch to insert new match scores
func (s *MatchService) calculateAndStoreEloWithScores(ctx context.Context, q *db.Queries, matchID int32, playerScores map[int32]float64, previousElo map[int32]float64, eloConstK float64, eloConstD float64) error {
	// Convert to string keys for elo calculation functions
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

	// Calculate new Elos
	newElos := CalculateNewElo(previousEloStr, StartingElo, playerScoresStr, eloConstK, eloConstD)
	absoluteLoserScore := GetAsboluteLoserScore(playerScoresStr)

	// Upsert match scores with scores and Elo values
	for playerID, score := range playerScores {
		playerIDStr := fmt.Sprintf("%d", playerID)
		prevElo := previousElo[playerID]
		newElo := newElos[playerIDStr]

		// Calculate components
		eloPay := -eloConstK * WinExpectation(prevElo, playerScoresStr, StartingElo, previousEloStr, eloConstD)
		eloEarn := eloConstK * NormalizedScore(score, playerScoresStr, absoluteLoserScore)

		err := q.UpsertMatchScore(ctx, db.UpsertMatchScoreParams{
			MatchID:  matchID,
			PlayerID: playerID,
			Score:    score,
			EloPay:   pgtype.Float8{Float64: eloPay, Valid: true},
			EloEarn:  pgtype.Float8{Float64: eloEarn, Valid: true},
			NewElo:   pgtype.Float8{Float64: newElo, Valid: true},
		})
		if err != nil {
			return fmt.Errorf("unable to upsert match score for player %d: %v", playerID, err)
		}
	}

	return nil
}

// calculateAndUpdateElo calculates Elo and updates only the Elo fields in match_scores
// Used by UpdateMatch to recalculate Elo without changing scores
func (s *MatchService) calculateAndUpdateElo(ctx context.Context, q *db.Queries, matchID int32, playerScores map[int32]float64, previousElo map[int32]float64, eloConstK float64, eloConstD float64) error {
	// Convert to string keys for elo calculation functions
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

	// Calculate new Elos
	newElos := CalculateNewElo(previousEloStr, StartingElo, playerScoresStr, eloConstK, eloConstD)
	absoluteLoserScore := GetAsboluteLoserScore(playerScoresStr)

	// Update only the Elo fields
	for playerID, score := range playerScores {
		playerIDStr := fmt.Sprintf("%d", playerID)
		prevElo := previousElo[playerID]
		newElo := newElos[playerIDStr]

		// Calculate components
		eloPay := -eloConstK * WinExpectation(prevElo, playerScoresStr, StartingElo, previousEloStr, eloConstD)
		eloEarn := eloConstK * NormalizedScore(score, playerScoresStr, absoluteLoserScore)

		err := q.UpdateMatchScoreElo(ctx, db.UpdateMatchScoreEloParams{
			MatchID:  matchID,
			PlayerID: playerID,
			EloPay:   pgtype.Float8{Float64: eloPay, Valid: true},
			EloEarn:  pgtype.Float8{Float64: eloEarn, Valid: true},
			NewElo:   pgtype.Float8{Float64: newElo, Valid: true},
		})
		if err != nil {
			return fmt.Errorf("unable to update Elo for player %d: %v", playerID, err)
		}
	}

	return nil
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
