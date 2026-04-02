package elo

import (
	"context"
	"fmt"
	"slices"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

type MatchService struct {
	Queries        *db.Queries
	Pool           *pgxpool.Pool
	MarketService  IMarketService
	EventProcessor *EventProcessor
}

func NewMatchService(pool *pgxpool.Pool, marketService IMarketService) IMatchService {
	return &MatchService{
		Queries:        db.New(pool),
		Pool:           pool,
		MarketService:  marketService,
		EventProcessor: &EventProcessor{MarketService: marketService},
	}
}

type IMatchService interface {
	AddMatch(ctx context.Context, gameID int32, playerScores map[int32]float64, date time.Time) (db.Match, error)
	UpdateMatch(ctx context.Context, matchID int32, gameID int32, playerScores map[int32]float64, date time.Time) (db.Match, error)
	RecalculateAllGameElo(ctx context.Context) error

	// DeleteMarketAndRecalculate hard-deletes an open market and recalculates
	// Elo from the market's created_at date. Returns ErrMarketNotOpen if the
	// market is already resolved or cancelled.
	DeleteMarketAndRecalculate(ctx context.Context, marketID int32) error
}

// AddMatch adds a single match with Elo calculations
// Validates that game_id and all player_ids exist via foreign key constraints
func (s *MatchService) AddMatch(ctx context.Context, gameID int32, playerScores map[int32]float64, date time.Time) (db.Match, error) {
	if len(playerScores) < 2 {
		return db.Match{}, ErrTooFewPlayers
	}

	// start a transaction
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return db.Match{}, fmt.Errorf("unable to begin tx: %v", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := s.Queries.WithTx(tx)

	dt := pgtype.Timestamptz{Time: date, Valid: true}

	// Get Elo settings for the match date
	settingsRow, err := q.GetEloSettingsForDate(ctx, pgtype.Timestamptz{Time: date, Valid: true})
	if err != nil {
		return db.Match{}, fmt.Errorf("unable to get Elo settings for date %v: %v", date, err)
	}
	settings := EloSettingsFromDB(settingsRow)

	// create match (foreign key will validate game_id exists)
	createdMatch, err := q.CreateMatch(ctx, db.CreateMatchParams{
		Date:   dt,
		GameID: gameID,
	})
	if err != nil {
		return db.Match{}, fmt.Errorf("unable to create match: %v", err)
	}

	// Get latest Elo for each player
	// IMPORTANT: Lock players in a consistent order (sorted by ID) to prevent deadlocks
	previousElo := make(map[int32]float64)
	previousGameElo := make(map[int32]float64)

	// Sort player IDs to lock in consistent order
	playerIDs := make([]int32, 0, len(playerScores))
	for playerID := range playerScores {
		playerIDs = append(playerIDs, playerID)
	}
	// Sort numerically to ensure consistent locking order
	sortPlayerIDs(playerIDs)

	for _, playerID := range playerIDs {
		// Lock the player row to prevent concurrent Elo calculations
		_, err = q.LockPlayerForEloCalculation(ctx, playerID)
		if err != nil {
			return db.Match{}, fmt.Errorf("unable to lock player %d for Elo calculation (player may not exist): %v", playerID, err)
		}

		// Get latest global Elo for this player
		latestGlobalElo, err := q.GetPlayerLatestGlobalElo(ctx, playerID)
		if err != nil {
			previousElo[playerID] = settings.StartingElo
		} else {
			previousElo[playerID] = latestGlobalElo
		}

		// Get latest game Elo for this player
		latestGameElo, err := q.GetPlayerLatestGameElo(ctx, db.GetPlayerLatestGameEloParams{
			PlayerID: playerID,
			GameID:   gameID,
		})
		if err != nil {
			previousGameElo[playerID] = settings.StartingElo
		} else {
			previousGameElo[playerID] = latestGameElo
		}
	}

	// Apply all settlements: rating, game_elo, market resolution, time-based expiry
	if err := s.EventProcessor.processMatchSettlements(
		ctx, q, createdMatch.ID, gameID, playerScores,
		previousElo, previousGameElo, settings, date,
		s.calculateAndStoreEloWithScores,
	); err != nil {
		return db.Match{}, err
	}

	// Update bet limits for match participants
	if err := RecalculateBetLimits(ctx, q, playerIDs); err != nil {
		return db.Match{}, fmt.Errorf("recalculate bet limits: %v", err)
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
		return db.Match{}, fmt.Errorf("%w: %v", ErrMatchNotFound, err)
	}

	// Validate date change
	oldDate := existingMatch.Date.Time
	if err := validateMatchDateChange(oldDate, date); err != nil {
		return db.Match{}, err
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
			MatchID:     matchID,
			PlayerID:    playerID,
			Score:       score,
			RatingPay:   0, // Will be recalculated
			RatingEarn:  0, // Will be recalculated
			GameEloPay:  0, // Will be recalculated
			GameEloEarn: 0, // Will be recalculated
			GameNewElo:  0, // Will be recalculated
		})
		if err != nil {
			return db.Match{}, fmt.Errorf("unable to insert match score for player %d: %v", playerID, err)
		}
	}

	// Recalculate all settlements from the start date
	if err := s.recalculateEloFromDate(ctx, q, recalcStartDate); err != nil {
		return db.Match{}, fmt.Errorf("unable to recalculate Elo: %w", err)
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

// RecalculateAllGameElo recalculates game Elo for all matches from the beginning of time.
// Used as a one-time backfill after the game Elo columns were added.
func (s *MatchService) RecalculateAllGameElo(ctx context.Context) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("unable to begin tx: %v", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := s.Queries.WithTx(tx)

	if err := s.recalculateEloFromDate(ctx, q, time.Time{}); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// DeleteMarketAndRecalculate hard-deletes an open market and recalculates Elo
// from the market's created_at date. Everything runs in a single transaction.
func (s *MatchService) DeleteMarketAndRecalculate(ctx context.Context, marketID int32) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	q := s.Queries.WithTx(tx)

	market, err := q.GetMarketWithPools(ctx, marketID)
	if err != nil {
		return fmt.Errorf("get market: %w", err)
	}
	if market.Status != "open" {
		return ErrMarketNotOpen
	}

	createdAt := market.CreatedAt.Time

	if err := q.DeletePlayerRatingsByMarket(ctx, pgtype.Int4{Int32: marketID, Valid: true}); err != nil {
		return fmt.Errorf("delete player ratings for market %d: %w", marketID, err)
	}

	if err := q.DeleteMarket(ctx, marketID); err != nil {
		return fmt.Errorf("delete market %d: %w", marketID, err)
	}

	if err := s.recalculateEloFromDate(ctx, q, createdAt); err != nil {
		return fmt.Errorf("recalculate elo from %v: %w", createdAt, err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}

	s.MarketService.ScheduleNextExpiry(context.Background())
	return nil
}

// recalculateEloFromDate delegates to EventProcessor.RecalculateFrom.
// Must be called within a transaction.
func (s *MatchService) recalculateEloFromDate(ctx context.Context, q *db.Queries, startDate time.Time) error {
	return s.EventProcessor.RecalculateFrom(ctx, q, startDate, s.calculateAndUpdateElo, s.lockAndGetPrevElos)
}

// lockAndGetPrevElos locks players in sorted order and returns their previous global and game Elo,
// along with the Elo settings for the match date.
func (s *MatchService) lockAndGetPrevElos(ctx context.Context, q *db.Queries, match db.Match, playerScores map[int32]float64) (map[int32]float64, map[int32]float64, EloSettings, error) {
	settingsRow, err := q.GetEloSettingsForDate(ctx, match.Date)
	if err != nil {
		return nil, nil, EloSettings{}, fmt.Errorf("get elo settings: %w", err)
	}
	settings := EloSettingsFromDB(settingsRow)

	previousElo := make(map[int32]float64)
	previousGameElo := make(map[int32]float64)
	playerIDs := make([]int32, 0, len(playerScores))
	for playerID := range playerScores {
		playerIDs = append(playerIDs, playerID)
	}
	sortPlayerIDs(playerIDs)

	for _, playerID := range playerIDs {
		_, err = q.LockPlayerForEloCalculation(ctx, playerID)
		if err != nil {
			return nil, nil, EloSettings{}, fmt.Errorf("unable to lock player %d: %v", playerID, err)
		}

		prevGlobalElo, err := q.GetPlayerLatestGlobalEloBeforeMatch(ctx, db.GetPlayerLatestGlobalEloBeforeMatchParams{
			PlayerID: playerID,
			Date:     match.Date,
			MatchID:  pgtype.Int4{Int32: match.ID, Valid: true},
		})
		if err != nil {
			previousElo[playerID] = settings.StartingElo
		} else {
			previousElo[playerID] = prevGlobalElo
		}

		prevGameElo, err := q.GetPlayerLatestGameEloBeforeMatch(ctx, db.GetPlayerLatestGameEloBeforeMatchParams{
			PlayerID: playerID,
			GameID:   match.GameID,
			Date:     match.Date,
			ID:       match.ID,
		})
		if err != nil {
			previousGameElo[playerID] = settings.StartingElo
		} else {
			previousGameElo[playerID] = prevGameElo
		}
	}

	return previousElo, previousGameElo, settings, nil
}

// eloCalcResult holds the per-player Elo deltas and new ratings for one match.
type eloCalcResult struct {
	ratingPay   float64
	ratingEarn  float64
	gameEloPay  float64
	gameEloEarn float64
	newGlobalElo float64
	newGameElo  float64
}

// buildEloResults converts int-keyed player maps to string keys, runs CalculateNewElo for global and
// game ratings, then returns a per-player eloCalcResult map. Pure calculation, no DB writes.
func buildEloResults(
	playerScores map[int32]float64,
	previousElo map[int32]float64,
	previousGameElo map[int32]float64,
	settings EloSettings,
) map[int32]eloCalcResult {
	previousEloStr := make(map[string]float64, len(previousElo))
	previousGameEloStr := make(map[string]float64, len(previousGameElo))
	playerScoresStr := make(map[string]float64, len(playerScores))
	for id, v := range previousElo {
		previousEloStr[fmt.Sprintf("%d", id)] = v
	}
	for id, v := range previousGameElo {
		previousGameEloStr[fmt.Sprintf("%d", id)] = v
	}
	for id, v := range playerScores {
		playerScoresStr[fmt.Sprintf("%d", id)] = v
	}

	newGlobalElos := CalculateNewElo(previousEloStr, settings.StartingElo, playerScoresStr, settings.K, settings.D, settings.WinReward)
	newGameElos := CalculateNewElo(previousGameEloStr, settings.StartingElo, playerScoresStr, settings.K, settings.D, settings.WinReward)
	absoluteLoserScore := GetAsboluteLoserScore(playerScoresStr)

	results := make(map[int32]eloCalcResult, len(playerScores))
	for id, score := range playerScores {
		idStr := fmt.Sprintf("%d", id)
		results[id] = eloCalcResult{
			ratingPay:    -settings.K * WinExpectation(previousElo[id], playerScoresStr, settings.StartingElo, previousEloStr, settings.D),
			ratingEarn:   settings.K * NormalizedScore(score, playerScoresStr, absoluteLoserScore, settings.WinReward),
			gameEloPay:   -settings.K * WinExpectation(previousGameElo[id], playerScoresStr, settings.StartingElo, previousGameEloStr, settings.D),
			gameEloEarn:  settings.K * NormalizedScore(score, playerScoresStr, absoluteLoserScore, settings.WinReward),
			newGlobalElo: newGlobalElos[idStr],
			newGameElo:   newGameElos[idStr],
		}
	}
	return results
}

// calculateAndStoreEloWithScores calculates Elo and inserts match_scores with scores and Elo.
// Used by AddMatch to insert new match scores.
func (s *MatchService) calculateAndStoreEloWithScores(ctx context.Context, q *db.Queries, matchID int32, gameID int32, playerScores map[int32]float64, previousElo map[int32]float64, previousGameElo map[int32]float64, settings EloSettings) error {
	results := buildEloResults(playerScores, previousElo, previousGameElo, settings)

	for playerID, score := range playerScores {
		r := results[playerID]
		if err := q.UpsertMatchScore(ctx, db.UpsertMatchScoreParams{
			MatchID:     matchID,
			PlayerID:    playerID,
			Score:       score,
			RatingPay:   r.ratingPay,
			RatingEarn:  r.ratingEarn,
			GameEloPay:  r.gameEloPay,
			GameEloEarn: r.gameEloEarn,
			GameNewElo:  r.newGameElo,
		}); err != nil {
			return fmt.Errorf("unable to upsert match score for player %d: %v", playerID, err)
		}
		if err := q.UpsertPlayerRatingByMatch(ctx, db.UpsertPlayerRatingByMatchParams{
			MatchID:  pgtype.Int4{Int32: matchID, Valid: true},
			PlayerID: playerID,
			Rating:   r.newGlobalElo,
		}); err != nil {
			return fmt.Errorf("unable to upsert player rating for player %d: %v", playerID, err)
		}
	}

	return nil
}

// calculateAndUpdateElo calculates Elo and updates only the Elo fields in match_scores.
// Used by recalculation to update Elo without changing scores.
func (s *MatchService) calculateAndUpdateElo(ctx context.Context, q *db.Queries, matchID int32, gameID int32, playerScores map[int32]float64, previousElo map[int32]float64, previousGameElo map[int32]float64, settings EloSettings) error {
	results := buildEloResults(playerScores, previousElo, previousGameElo, settings)

	for playerID := range playerScores {
		r := results[playerID]
		if err := q.UpdateMatchScoreRating(ctx, db.UpdateMatchScoreRatingParams{
			MatchID:    matchID,
			PlayerID:   playerID,
			RatingPay:  r.ratingPay,
			RatingEarn: r.ratingEarn,
		}); err != nil {
			return fmt.Errorf("unable to update rating for player %d: %v", playerID, err)
		}
		if err := q.UpdateMatchScoreGameElo(ctx, db.UpdateMatchScoreGameEloParams{
			MatchID:     matchID,
			PlayerID:    playerID,
			GameEloPay:  r.gameEloPay,
			GameEloEarn: r.gameEloEarn,
			GameNewElo:  r.newGameElo,
		}); err != nil {
			return fmt.Errorf("unable to update game Elo for player %d: %v", playerID, err)
		}
		if err := q.UpsertPlayerRatingByMatch(ctx, db.UpsertPlayerRatingByMatchParams{
			MatchID:  pgtype.Int4{Int32: matchID, Valid: true},
			PlayerID: playerID,
			Rating:   r.newGlobalElo,
		}); err != nil {
			return fmt.Errorf("unable to upsert player rating for player %d: %v", playerID, err)
		}
	}

	return nil
}

// sortPlayerIDs sorts player IDs numerically (for consistent locking order)
func sortPlayerIDs(ids []int32) { slices.Sort(ids) }
