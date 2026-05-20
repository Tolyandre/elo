package elo

import (
	"context"
	"fmt"
	"math"
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

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return db.Match{}, fmt.Errorf("unable to begin tx: %v", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := s.Queries.WithTx(tx)

	dt := pgtype.Timestamptz{Time: date, Valid: true}

	// create match (foreign key will validate game_id exists)
	createdMatch, err := q.CreateMatch(ctx, db.CreateMatchParams{
		Date:   dt,
		GameID: gameID,
	})
	if err != nil {
		return db.Match{}, fmt.Errorf("unable to create match: %v", err)
	}

	// Lock players and collect all prior state needed for dual-track settlement
	state, err := s.lockAndGetPrevElos(ctx, q, createdMatch, playerScores)
	if err != nil {
		return db.Match{}, err
	}

	playerIDs := make([]int32, 0, len(playerScores))
	for playerID := range playerScores {
		playerIDs = append(playerIDs, playerID)
	}

	if err := s.EventProcessor.processMatchSettlements(
		ctx, q, createdMatch.ID, gameID, playerScores,
		state, date,
		s.calculateAndStoreEloWithScores,
	); err != nil {
		return db.Match{}, err
	}

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
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return db.Match{}, fmt.Errorf("unable to begin tx: %v", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := s.Queries.WithTx(tx)

	existingMatch, err := q.GetMatch(ctx, matchID)
	if err != nil {
		return db.Match{}, fmt.Errorf("%w: %v", ErrMatchNotFound, err)
	}

	oldDate := existingMatch.Date.Time
	if err := validateMatchDateChange(oldDate, date); err != nil {
		return db.Match{}, err
	}

	recalcStartDate := date
	if existingMatch.Date.Valid && existingMatch.Date.Time.Before(date) {
		recalcStartDate = existingMatch.Date.Time
	}

	err = q.UpdateMatch(ctx, db.UpdateMatchParams{
		ID:     matchID,
		Date:   pgtype.Timestamptz{Time: date, Valid: true},
		GameID: gameID,
	})
	if err != nil {
		return db.Match{}, fmt.Errorf("unable to update match: %v", err)
	}

	// Delete old scores and settlements to handle player list changes.
	// Explicit deletes are required because global_arena_settlement and game_arena_settlement
	// reference matches(id), not match_scores, so there is no cascade from match_scores.
	if err = q.DeleteGlobalArenaSettlementByMatch(ctx, pgtype.Int4{Int32: matchID, Valid: true}); err != nil {
		return db.Match{}, fmt.Errorf("unable to delete global arena settlement for match %d: %v", matchID, err)
	}
	if err = q.DeleteGameArenaSettlementByMatch(ctx, pgtype.Int4{Int32: matchID, Valid: true}); err != nil {
		return db.Match{}, fmt.Errorf("unable to delete game arena settlement for match %d: %v", matchID, err)
	}
	err = q.DeleteMatchScores(ctx, matchID)
	if err != nil {
		return db.Match{}, fmt.Errorf("unable to delete old match scores: %v", err)
	}

	for playerID, score := range playerScores {
		err := q.UpsertMatchScore(ctx, db.UpsertMatchScoreParams{
			MatchID:  matchID,
			PlayerID: playerID,
			Score:    score,
		})
		if err != nil {
			return db.Match{}, fmt.Errorf("unable to insert match score for player %d: %v", playerID, err)
		}
	}

	if err := s.recalculateEloFromDate(ctx, q, recalcStartDate); err != nil {
		return db.Match{}, fmt.Errorf("unable to recalculate Elo: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return db.Match{}, fmt.Errorf("unable to commit tx: %v", err)
	}

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
	if market.Status != "open" && market.Status != "betting_closed" {
		return ErrMarketNotOpen
	}

	createdAt := market.CreatedAt.Time

	if err := q.DeleteGlobalArenaSettlementByMarket(ctx, pgtype.Int4{Int32: marketID, Valid: true}); err != nil {
		return fmt.Errorf("delete global arena settlement for market %d: %w", marketID, err)
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

// lockAndGetPrevElos locks players in sorted order and returns all prior state
// needed to compute dual-track (elo + rating) and league settlements.
func (s *MatchService) lockAndGetPrevElos(ctx context.Context, q *db.Queries, match db.Match, playerScores map[int32]float64) (MatchPrevState, error) {
	settingsRow, err := q.GetEloSettingsForDate(ctx, match.Date)
	if err != nil {
		return MatchPrevState{}, fmt.Errorf("get elo settings: %w", err)
	}
	settings := EloSettingsFromDB(settingsRow)

	state := MatchPrevState{
		Elo:        make(map[int32]float64),
		GameElo:    make(map[int32]float64),
		Rating:     make(map[int32]float64),
		GameRating: make(map[int32]float64),
		League:     make(map[int32]string),
		GameLeague: make(map[int32]string),
		Count6M:    make(map[int32]int),
		Count2M:    make(map[int32]int),
		Settings:   settings,
	}

	playerIDs := make([]int32, 0, len(playerScores))
	for playerID := range playerScores {
		playerIDs = append(playerIDs, playerID)
	}
	sortPlayerIDs(playerIDs)

	matchDate := match.Date
	date6MAgo := pgtype.Timestamptz{Time: match.Date.Time.Add(-6 * 30 * 24 * time.Hour), Valid: true}
	date2MAgo := pgtype.Timestamptz{Time: match.Date.Time.Add(-2 * 30 * 24 * time.Hour), Valid: true}

	for _, playerID := range playerIDs {
		_, err = q.LockPlayerForEloCalculation(ctx, playerID)
		if err != nil {
			return MatchPrevState{}, fmt.Errorf("unable to lock player %d: %v", playerID, err)
		}

		prevGlobalElo, err := q.GetPlayerLatestGlobalEloBeforeMatch(ctx, db.GetPlayerLatestGlobalEloBeforeMatchParams{
			PlayerID: playerID,
			Date:     matchDate,
			MatchID:  pgtype.Int4{Int32: match.ID, Valid: true},
		})
		if err != nil {
			state.Elo[playerID] = settings.StartingElo
		} else {
			state.Elo[playerID] = prevGlobalElo
		}

		prevGameElo, err := q.GetPlayerLatestGameEloBeforeMatch(ctx, db.GetPlayerLatestGameEloBeforeMatchParams{
			PlayerID: playerID,
			GameID:   match.GameID,
			Date:     matchDate,
			MatchID:  pgtype.Int4{Int32: match.ID, Valid: true},
		})
		if err != nil {
			state.GameElo[playerID] = settings.StartingElo
		} else {
			state.GameElo[playerID] = prevGameElo
		}

		prevGlobalRating, err := q.GetPlayerLatestGlobalRatingBeforeMatch(ctx, db.GetPlayerLatestGlobalRatingBeforeMatchParams{
			PlayerID: playerID,
			Date:     matchDate,
			MatchID:  pgtype.Int4{Int32: match.ID, Valid: true},
		})
		if err != nil {
			state.Rating[playerID] = settings.StartingRating
			state.League[playerID] = initialLeague(settings)
		} else {
			state.Rating[playerID] = prevGlobalRating.Rating
			state.League[playerID] = prevGlobalRating.League
		}

		prevGameRating, err := q.GetPlayerLatestGameRatingBeforeMatch(ctx, db.GetPlayerLatestGameRatingBeforeMatchParams{
			PlayerID: playerID,
			GameID:   match.GameID,
			Date:     matchDate,
			MatchID:  pgtype.Int4{Int32: match.ID, Valid: true},
		})
		if err != nil {
			state.GameRating[playerID] = settings.StartingRating
			state.GameLeague[playerID] = initialLeague(settings)
		} else {
			state.GameRating[playerID] = prevGameRating.GameNewRating
			state.GameLeague[playerID] = prevGameRating.League
		}

		// counts before this match = total up to matchDate minus 1 (the match itself)
		count6M, err := q.GetPlayerGlobalMatchCountInPeriod(ctx, db.GetPlayerGlobalMatchCountInPeriodParams{
			PlayerID: playerID,
			Date:     date6MAgo,
			Date_2:   matchDate,
		})
		if err != nil {
			state.Count6M[playerID] = 0
		} else {
			state.Count6M[playerID] = int(count6M)
		}

		count2M, err := q.GetPlayerGlobalMatchCountInPeriod(ctx, db.GetPlayerGlobalMatchCountInPeriodParams{
			PlayerID: playerID,
			Date:     date2MAgo,
			Date_2:   matchDate,
		})
		if err != nil {
			state.Count2M[playerID] = 0
		} else {
			state.Count2M[playerID] = int(count2M)
		}

		// Resolve stale elite: if stored league says 'elite' but current counts
		// (before this match) don't meet thresholds, treat prevLeague as 'amateur'.
		// count6M/count2M here include the current match; subtract 1 to get pre-match counts.
		cnt60Before := state.Count2M[playerID] - 1
		cnt180Before := state.Count6M[playerID] - 1
		if cnt60Before < 0 {
			cnt60Before = 0
		}
		if cnt180Before < 0 {
			cnt180Before = 0
		}
		state.League[playerID] = effectiveLeague(state.League[playerID], cnt60Before, cnt180Before, settings)
	}

	return state, nil
}

// eloCalcResult holds per-player dual-track Elo/rating deltas and new values for one match.
type eloCalcResult struct {
	eloStaked       float64
	eloEarned       float64
	newGlobalElo    float64
	ratingStaked    float64
	ratingEarned    float64
	newGlobalRating float64
	newGlobalLeague string
	gameEloStaked   float64
	gameEloEarned   float64
	newGameElo      float64
	gameRatingStaked float64
	gameRatingEarned float64
	newGameRating   float64
	newGameLeague   string
}

// ratingK returns K for the rating track using a continuous formula based on the gap
// between true_elo and display rating: K(gap) = K_std + (RatingMaxK − K_std) × (1 − e^(−|gap|/τ)).
// At gap=0 (converged) K equals K_std; as gap grows K approaches RatingMaxK.
func ratingK(gap float64, s EloSettings) float64 {
	return s.K + (s.RatingMaxK-s.K)*(1-math.Exp(-math.Abs(gap)/s.RatingKTau))
}

// applyNewbieClamping prevents the rating from decreasing in the newbie league.
// If staked+earned < 0, the player gets +1 instead of a loss.
func applyNewbieClamping(league string, staked, earned float64) (float64, float64) {
	if league == "newbie" && staked+earned < 0 {
		return 0, 1
	}
	return staked, earned
}

// initialLeague returns the league for a player with no prior settlement.
// If starting_rating already meets the newbie promotion threshold, they start as amateur.
func initialLeague(s EloSettings) string {
	if s.StartingRating >= s.NewbieLeagueGoal {
		return "amateur"
	}
	return "newbie"
}

// effectiveLeague accounts for time-based demotion from elite to amateur.
// The stored league in a settlement record is set at write time; if a player's
// match counts have since dropped below the elite thresholds, they are effectively
// in amateur even if their last record says 'elite'.
func effectiveLeague(storedLeague string, cnt60, cnt180 int, s EloSettings) string {
	if storedLeague == "elite" {
		if cnt180 >= s.EliteMatches6M && cnt60 >= s.EliteMatches2M {
			return "elite"
		}
		return "amateur"
	}
	return storedLeague
}

// determineGlobalLeague returns the league a player is in AFTER a global-arena settlement.
func determineGlobalLeague(prev string, newRating float64, count6M, count2M int, s EloSettings) string {
	if prev == "newbie" {
		if newRating >= s.NewbieLeagueGoal {
			return "amateur"
		}
		return "newbie"
	}
	if count6M >= s.EliteMatches6M && count2M >= s.EliteMatches2M {
		return "elite"
	}
	return "amateur"
}

// determineGameLeague returns the league a player is in AFTER a game-arena settlement.
func determineGameLeague(prev string, newRating float64, s EloSettings) string {
	if prev == "newbie" && newRating < s.NewbieLeagueGoal {
		return "newbie"
	}
	return "amateur"
}

// buildEloResults computes the dual-track (elo + rating) settlement for every player in the match.
// Pure calculation — no DB writes.
func buildEloResults(playerScores map[int32]float64, state MatchPrevState) map[int32]eloCalcResult {
	s := state.Settings

	prevEloStr := make(map[string]float64, len(state.Elo))
	prevGameEloStr := make(map[string]float64, len(state.GameElo))
	playerScoresStr := make(map[string]float64, len(playerScores))
	for id, v := range state.Elo {
		prevEloStr[fmt.Sprintf("%d", id)] = v
	}
	for id, v := range state.GameElo {
		prevGameEloStr[fmt.Sprintf("%d", id)] = v
	}
	for id, v := range playerScores {
		playerScoresStr[fmt.Sprintf("%d", id)] = v
	}

	newGlobalElos := CalculateNewElo(prevEloStr, s.StartingElo, playerScoresStr, s.K, s.D, s.WinReward)
	newGameElos := CalculateNewElo(prevGameEloStr, s.StartingElo, playerScoresStr, s.K, s.D, s.WinReward)
	absoluteLoserScore := GetAsboluteLoserScore(playerScoresStr)

	results := make(map[int32]eloCalcResult, len(playerScores))
	for id, score := range playerScores {
		idStr := fmt.Sprintf("%d", id)

		// Global elo track
		eloStaked := -s.K * WinExpectation(state.Elo[id], playerScoresStr, s.StartingElo, prevEloStr, s.D)
		eloEarned := s.K * NormalizedScore(score, playerScoresStr, absoluteLoserScore, s.WinReward)

		// Global rating track: player's own rating replaces their elo in WinExpectation;
		// K scales with gap between true elo and display rating.
		globalGap := state.Elo[id] - state.Rating[id]
		kR := ratingK(globalGap, s)
		dR := s.D
		prevEloForRating := make(map[string]float64, len(prevEloStr))
		for k, v := range prevEloStr {
			prevEloForRating[k] = v
		}
		prevEloForRating[idStr] = state.Rating[id]

		ratingStakedRaw := -kR * WinExpectation(state.Rating[id], playerScoresStr, s.StartingElo, prevEloForRating, dR)
		ratingEarnedRaw := kR * NormalizedScore(score, playerScoresStr, absoluteLoserScore, s.WinReward)
		ratingStaked, ratingEarned := applyNewbieClamping(state.League[id], ratingStakedRaw, ratingEarnedRaw)
		newGlobalRating := state.Rating[id] + ratingStaked + ratingEarned
		newGlobalLeague := determineGlobalLeague(state.League[id], newGlobalRating, state.Count6M[id], state.Count2M[id], s)

		// Game elo track
		gameEloStaked := -s.K * WinExpectation(state.GameElo[id], playerScoresStr, s.StartingElo, prevGameEloStr, s.D)
		gameEloEarned := s.K * NormalizedScore(score, playerScoresStr, absoluteLoserScore, s.WinReward)

		// Game rating track: K scales with gap between true game elo and display game rating.
		gameGap := state.GameElo[id] - state.GameRating[id]
		kGR := ratingK(gameGap, s)
		dGR := s.D
		prevGameEloForRating := make(map[string]float64, len(prevGameEloStr))
		for k, v := range prevGameEloStr {
			prevGameEloForRating[k] = v
		}
		prevGameEloForRating[idStr] = state.GameRating[id]

		gameRatingStakedRaw := -kGR * WinExpectation(state.GameRating[id], playerScoresStr, s.StartingElo, prevGameEloForRating, dGR)
		gameRatingEarnedRaw := kGR * NormalizedScore(score, playerScoresStr, absoluteLoserScore, s.WinReward)
		gameRatingStaked, gameRatingEarned := applyNewbieClamping(state.GameLeague[id], gameRatingStakedRaw, gameRatingEarnedRaw)
		newGameRating := state.GameRating[id] + gameRatingStaked + gameRatingEarned
		newGameLeague := determineGameLeague(state.GameLeague[id], newGameRating, s)

		results[id] = eloCalcResult{
			eloStaked:        eloStaked,
			eloEarned:        eloEarned,
			newGlobalElo:     newGlobalElos[idStr],
			ratingStaked:     ratingStaked,
			ratingEarned:     ratingEarned,
			newGlobalRating:  newGlobalRating,
			newGlobalLeague:  newGlobalLeague,
			gameEloStaked:    gameEloStaked,
			gameEloEarned:    gameEloEarned,
			newGameElo:       newGameElos[idStr],
			gameRatingStaked: gameRatingStaked,
			gameRatingEarned: gameRatingEarned,
			newGameRating:    newGameRating,
			newGameLeague:    newGameLeague,
		}
	}
	return results
}

// calculateAndStoreEloWithScores inserts match_scores then upserts both settlement tables.
// Used by AddMatch to write scores and Elo for a brand-new match.
func (s *MatchService) calculateAndStoreEloWithScores(ctx context.Context, q *db.Queries, matchID int32, gameID int32, playerScores map[int32]float64, state MatchPrevState) error {
	results := buildEloResults(playerScores, state)

	for playerID, score := range playerScores {
		r := results[playerID]
		if err := q.UpsertMatchScore(ctx, db.UpsertMatchScoreParams{
			MatchID:  matchID,
			PlayerID: playerID,
			Score:    score,
		}); err != nil {
			return fmt.Errorf("unable to upsert match score for player %d: %v", playerID, err)
		}
		if err := q.UpsertGlobalArenaSettlementByMatch(ctx, db.UpsertGlobalArenaSettlementByMatchParams{
			MatchID:      pgtype.Int4{Int32: matchID, Valid: true},
			PlayerID:     playerID,
			NewRating:    r.newGlobalRating,
			NewElo:       r.newGlobalElo,
			EloStaked:    r.eloStaked,
			EloEarned:    r.eloEarned,
			RatingStaked: r.ratingStaked,
			RatingEarned: r.ratingEarned,
			League:       r.newGlobalLeague,
		}); err != nil {
			return fmt.Errorf("unable to upsert global arena settlement for player %d: %v", playerID, err)
		}
		if err := q.UpsertGameArenaSettlementByMatch(ctx, db.UpsertGameArenaSettlementByMatchParams{
			MatchID:      pgtype.Int4{Int32: matchID, Valid: true},
			GameID:       gameID,
			PlayerID:     playerID,
			NewRating:    r.newGameRating,
			NewElo:       r.newGameElo,
			EloStaked:    r.gameEloStaked,
			EloEarned:    r.gameEloEarned,
			RatingStaked: r.gameRatingStaked,
			RatingEarned: r.gameRatingEarned,
			League:       r.newGameLeague,
		}); err != nil {
			return fmt.Errorf("unable to upsert game arena settlement for player %d: %v", playerID, err)
		}
	}

	return nil
}

// calculateAndUpdateElo upserts settlement records without touching match_scores.
// Used by recalculation paths where scores already exist.
func (s *MatchService) calculateAndUpdateElo(ctx context.Context, q *db.Queries, matchID int32, gameID int32, playerScores map[int32]float64, state MatchPrevState) error {
	results := buildEloResults(playerScores, state)

	for playerID := range playerScores {
		r := results[playerID]
		if err := q.UpsertGlobalArenaSettlementByMatch(ctx, db.UpsertGlobalArenaSettlementByMatchParams{
			MatchID:      pgtype.Int4{Int32: matchID, Valid: true},
			PlayerID:     playerID,
			NewRating:    r.newGlobalRating,
			NewElo:       r.newGlobalElo,
			EloStaked:    r.eloStaked,
			EloEarned:    r.eloEarned,
			RatingStaked: r.ratingStaked,
			RatingEarned: r.ratingEarned,
			League:       r.newGlobalLeague,
		}); err != nil {
			return fmt.Errorf("unable to upsert global arena settlement for player %d: %v", playerID, err)
		}
		if err := q.UpsertGameArenaSettlementByMatch(ctx, db.UpsertGameArenaSettlementByMatchParams{
			MatchID:      pgtype.Int4{Int32: matchID, Valid: true},
			GameID:       gameID,
			PlayerID:     playerID,
			NewRating:    r.newGameRating,
			NewElo:       r.newGameElo,
			EloStaked:    r.gameEloStaked,
			EloEarned:    r.gameEloEarned,
			RatingStaked: r.gameRatingStaked,
			RatingEarned: r.gameRatingEarned,
			League:       r.newGameLeague,
		}); err != nil {
			return fmt.Errorf("unable to upsert game arena settlement for player %d: %v", playerID, err)
		}
	}

	return nil
}

// sortPlayerIDs sorts player IDs numerically (for consistent locking order)
func sortPlayerIDs(ids []int32) { slices.Sort(ids) }
