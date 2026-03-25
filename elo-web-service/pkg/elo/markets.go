package elo

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

var ErrBetLimitExceeded = errors.New("ставка превысит лимит бронирования")
var ErrMarketNotOpen = errors.New("рынок не открыт")
var ErrPlayerHasNoLinkedPlayer = errors.New("у пользователя нет привязанного игрока")

type CreateMarketParams struct {
	Title      string
	MarketType string // "match_winner" | "win_streak"
	StartsAt    time.Time
	ClosesAt    time.Time
	CreatedBy   int32

	// match_winner params
	TargetPlayerID     int32
	RequiredPlayerIDs  []int32
	GameID             *int32

	// win_streak params
	// (also uses TargetPlayerID)
	StreakGameID  *int32
	WinsRequired  *int32
	MaxLosses     *int32
}

type IMarketService interface {
	CreateMarket(ctx context.Context, params CreateMarketParams) (db.OutcomeMarket, error)
	CancelMarket(ctx context.Context, marketID int32, adminUserID int32) error
	PlaceBet(ctx context.Context, marketID int32, playerID int32, outcome string, amount float64) error

	// TriggerResolutionForMatch checks open markets and resolves/settles them based on the given match.
	// Must be called within an active transaction (q is transactional).
	TriggerResolutionForMatch(ctx context.Context, q *db.Queries, matchID int32) error

	// UnsettleMarketsFromDate resets markets that were resolved by matches on/after fromDate.
	// Must be called within an active transaction.
	UnsettleMarketsFromDate(ctx context.Context, q *db.Queries, fromDate time.Time) error

	// SettleMarket applies parimutuel payout for the given market and outcome.
	// "cancelled" outcome returns all stakes. Must be called within an active transaction.
	SettleMarket(ctx context.Context, q *db.Queries, marketID int32, outcome string, resolvedAt time.Time, resolutionMatchID *int32) error

	// ExpireOverdueMarkets settles or cancels markets whose closes_at has passed.
	ExpireOverdueMarkets(ctx context.Context) error

	// ScheduleNextExpiry sets a timer for the next market expiry.
	ScheduleNextExpiry(ctx context.Context)
}

type MarketService struct {
	Queries *db.Queries
	Pool    *pgxpool.Pool
	timer   *time.Timer
	timerMu sync.Mutex
}

func NewMarketService(pool *pgxpool.Pool) IMarketService {
	return &MarketService{
		Queries: db.New(pool),
		Pool:    pool,
	}
}

func (s *MarketService) CreateMarket(ctx context.Context, params CreateMarketParams) (db.OutcomeMarket, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return db.OutcomeMarket{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	q := s.Queries.WithTx(tx)

	market, err := q.CreateMarket(ctx, db.CreateMarketParams{
		Title:       params.Title,
		MarketType:  params.MarketType,
		StartsAt:    pgtype.Timestamptz{Time: params.StartsAt, Valid: true},
		ClosesAt:    pgtype.Timestamptz{Time: params.ClosesAt, Valid: true},
		CreatedBy:   params.CreatedBy,
	})
	if err != nil {
		return db.OutcomeMarket{}, fmt.Errorf("insert market: %w", err)
	}

	switch params.MarketType {
	case "match_winner":
		gameID := pgtype.Int4{}
		if params.GameID != nil {
			gameID = pgtype.Int4{Int32: *params.GameID, Valid: true}
		}
		requiredIDs := params.RequiredPlayerIDs
		if requiredIDs == nil {
			requiredIDs = []int32{}
		}
		if err := q.CreateMatchWinnerParams(ctx, db.CreateMatchWinnerParamsParams{
			MarketID:          market.ID,
			TargetPlayerID:    params.TargetPlayerID,
			RequiredPlayerIds: requiredIDs,
			GameID:            gameID,
		}); err != nil {
			return db.OutcomeMarket{}, fmt.Errorf("insert match_winner params: %w", err)
		}

	case "win_streak":
		maxLosses := pgtype.Int4{}
		if params.MaxLosses != nil {
			maxLosses = pgtype.Int4{Int32: *params.MaxLosses, Valid: true}
		}
		if params.StreakGameID == nil || params.WinsRequired == nil {
			return db.OutcomeMarket{}, fmt.Errorf("win_streak requires streak_game_id and wins_required")
		}
		if err := q.CreateWinStreakParams(ctx, db.CreateWinStreakParamsParams{
			MarketID:       market.ID,
			TargetPlayerID: params.TargetPlayerID,
			GameID:         *params.StreakGameID,
			WinsRequired:   *params.WinsRequired,
			MaxLosses:      maxLosses,
		}); err != nil {
			return db.OutcomeMarket{}, fmt.Errorf("insert win_streak params: %w", err)
		}

	default:
		return db.OutcomeMarket{}, fmt.Errorf("unknown market_type: %s", params.MarketType)
	}

	if err := tx.Commit(ctx); err != nil {
		return db.OutcomeMarket{}, fmt.Errorf("commit tx: %w", err)
	}

	// Schedule the next expiry timer after creating a new market
	s.ScheduleNextExpiry(context.Background())

	return market, nil
}

func (s *MarketService) CancelMarket(ctx context.Context, marketID int32, adminUserID int32) error {
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

	if err := s.SettleMarket(ctx, q, marketID, "cancelled", time.Now(), nil); err != nil {
		return fmt.Errorf("settle cancelled: %w", err)
	}

	return tx.Commit(ctx)
}

func (s *MarketService) PlaceBet(ctx context.Context, marketID int32, playerID int32, outcome string, amount float64) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	q := s.Queries.WithTx(tx)

	// Lock player to prevent concurrent reservation races
	if _, err := q.LockPlayerForEloCalculation(ctx, playerID); err != nil {
		return fmt.Errorf("lock player: %w", err)
	}

	// Check market is open
	market, err := q.GetMarketWithPools(ctx, marketID)
	if err != nil {
		return fmt.Errorf("get market: %w", err)
	}
	if market.Status != "open" {
		return ErrMarketNotOpen
	}

	// Check reservation limit
	reserved, err := q.GetPlayerReservedAmount(ctx, playerID)
	if err != nil {
		return fmt.Errorf("get reserved amount: %w", err)
	}

	limit, err := q.GetPlayerBetLimit(ctx, playerID)
	if err != nil {
		return fmt.Errorf("get bet limit: %w", err)
	}

	if reserved+amount > limit {
		return ErrBetLimitExceeded
	}

	if _, err := q.InsertBet(ctx, db.InsertBetParams{
		MarketID: marketID,
		PlayerID: playerID,
		Outcome:  outcome,
		Amount:   amount,
	}); err != nil {
		return fmt.Errorf("insert bet: %w", err)
	}

	return tx.Commit(ctx)
}

// TriggerResolutionForMatch checks all open markets and resolves them if the given match satisfies their conditions.
// Must be called within an active transaction (q is transactional Queries).
func (s *MarketService) TriggerResolutionForMatch(ctx context.Context, q *db.Queries, matchID int32) error {
	// Load match details
	match, err := q.GetMatch(ctx, matchID)
	if err != nil {
		return fmt.Errorf("get match %d: %w", matchID, err)
	}

	// Load match scores
	scores, err := q.GetMatchScoresForMatch(ctx, matchID)
	if err != nil {
		return fmt.Errorf("get scores for match %d: %w", matchID, err)
	}

	// Build participation and winner sets
	participantSet := make(map[int32]bool)
	playerScoreMap := make(map[int32]float64)
	maxScore := -1e18
	for _, s := range scores {
		participantSet[s.PlayerID] = true
		playerScoreMap[s.PlayerID] = s.Score
		if s.Score > maxScore {
			maxScore = s.Score
		}
	}

	matchDate := match.Date.Time

	// --- match_winner markets ---
	mwMarkets, err := q.ListOpenMatchWinnerMarkets(ctx)
	if err != nil {
		return fmt.Errorf("list match_winner markets: %w", err)
	}
	for _, m := range mwMarkets {
		// Check date range
		if matchDate.Before(m.StartsAt.Time) || matchDate.After(m.ClosesAt.Time) {
			continue
		}
		// Check game_id filter
		if m.GameID.Valid && m.GameID.Int32 != match.GameID {
			continue
		}
		// Check required players all participated
		allPresent := true
		for _, reqID := range m.RequiredPlayerIds {
			if !participantSet[reqID] {
				allPresent = false
				break
			}
		}
		if !allPresent {
			continue
		}
		// Check target player participated
		if !participantSet[m.TargetPlayerID] {
			continue
		}
		// Target player won (has max score)?
		resolutionMatchID := matchID
		if playerScoreMap[m.TargetPlayerID] >= maxScore {
			if err := s.SettleMarket(ctx, q, m.ID, "resolved_yes", matchDate, &resolutionMatchID); err != nil {
				return fmt.Errorf("settle match_winner market %d yes: %w", m.ID, err)
			}
		} else {
			if err := s.SettleMarket(ctx, q, m.ID, "resolved_no", matchDate, &resolutionMatchID); err != nil {
				return fmt.Errorf("settle match_winner market %d no: %w", m.ID, err)
			}
		}
	}

	// --- win_streak markets ---
	wsMarkets, err := q.ListOpenWinStreakMarkets(ctx)
	if err != nil {
		return fmt.Errorf("list win_streak markets: %w", err)
	}
	for _, m := range wsMarkets {
		// Only relevant if the match involves the target player in the right game
		if !participantSet[m.TargetPlayerID] || match.GameID != m.GameID {
			continue
		}
		// Tally stats from starts_at to now
		stats, err := q.GetPlayerStreakStats(ctx, db.GetPlayerStreakStatsParams{
			PlayerID: m.TargetPlayerID,
			GameID:   m.GameID,
			Date:     m.StartsAt,
			Date_2:   pgtype.Timestamptz{Time: matchDate, Valid: true},
		})
		if err != nil {
			return fmt.Errorf("streak stats for market %d: %w", m.ID, err)
		}

		resolutionMatchID := matchID
		// Check loss limit (no-condition)
		if m.MaxLosses.Valid && stats.Losses > m.MaxLosses.Int32 {
			if err := s.SettleMarket(ctx, q, m.ID, "resolved_no", matchDate, &resolutionMatchID); err != nil {
				return fmt.Errorf("settle win_streak market %d no (loss limit): %w", m.ID, err)
			}
			continue
		}
		// Check win condition
		if stats.Wins >= m.WinsRequired {
			if err := s.SettleMarket(ctx, q, m.ID, "resolved_yes", matchDate, &resolutionMatchID); err != nil {
				return fmt.Errorf("settle win_streak market %d yes: %w", m.ID, err)
			}
		}
	}

	return nil
}

// UnsettleMarketsFromDate resets markets resolved by matches on/after fromDate.
// Must be called within an active transaction.
func (s *MarketService) UnsettleMarketsFromDate(ctx context.Context, q *db.Queries, fromDate time.Time) error {
	marketIDs, err := q.GetMarketsForUnsettle(ctx, pgtype.Timestamptz{Time: fromDate, Valid: true})
	if err != nil {
		return fmt.Errorf("get markets for unsettle: %w", err)
	}
	for _, marketID := range marketIDs {
		if err := q.DeletePlayerRatingsByMarket(ctx, pgtype.Int4{Int32: marketID, Valid: true}); err != nil {
			return fmt.Errorf("delete player ratings for market %d: %w", marketID, err)
		}
		if err := q.DeleteBetSettlementDetails(ctx, marketID); err != nil {
			return fmt.Errorf("delete settlement details for market %d: %w", marketID, err)
		}
		if err := q.UnsettleMarket(ctx, marketID); err != nil {
			return fmt.Errorf("unsettle market %d: %w", marketID, err)
		}
	}
	return nil
}

// SettleMarket applies parimutuel payout and updates the market status.
// Must be called within an active transaction.
func (s *MarketService) SettleMarket(ctx context.Context, q *db.Queries, marketID int32, outcome string, resolvedAt time.Time, resolutionMatchID *int32) error {
	// Aggregate bets by player and outcome
	rows, err := q.GetBetsAggregatedByOutcome(ctx, marketID)
	if err != nil {
		return fmt.Errorf("get bets for market %d: %w", marketID, err)
	}

	// Build per-player maps
	type playerData struct {
		totalStaked     float64
		winningOutcome  float64 // staked on the winning outcome
	}
	players := make(map[int32]*playerData)
	totalPool := 0.0
	winningPool := 0.0

	// Map "resolved_yes"/"resolved_no" to the bet-side string stored in outcome_bets
	winningSide := ""
	switch outcome {
	case "resolved_yes":
		winningSide = "yes"
	case "resolved_no":
		winningSide = "no"
	}

	for _, row := range rows {
		if _, ok := players[row.PlayerID]; !ok {
			players[row.PlayerID] = &playerData{}
		}
		players[row.PlayerID].totalStaked += row.TotalAmount
		totalPool += row.TotalAmount
		if winningSide != "" && row.Outcome == winningSide {
			players[row.PlayerID].winningOutcome += row.TotalAmount
			winningPool += row.TotalAmount
		}
	}

	// For cancellation: everyone gets staked back
	if outcome == "cancelled" {
		winningPool = totalPool
		for pid := range players {
			players[pid].winningOutcome = players[pid].totalStaked
		}
	}

	// Compute earned for each player
	earned := make(map[int32]float64)
	for pid, pd := range players {
		if winningPool == 0 {
			// Edge case: nobody bet on winning side → return stakes to all
			earned[pid] = pd.totalStaked
		} else {
			earned[pid] = (pd.winningOutcome / winningPool) * totalPool
		}
	}

	// Write settlement records and update player ratings
	allPlayerIDs := make([]int32, 0, len(players))
	for pid := range players {
		allPlayerIDs = append(allPlayerIDs, pid)
	}
	sortPlayerIDs(allPlayerIDs)

	resolvedAtTz := pgtype.Timestamptz{Time: resolvedAt, Valid: true}

	for _, pid := range allPlayerIDs {
		staked := players[pid].totalStaked
		earnedAmt := earned[pid]

		if err := q.InsertBetSettlementDetail(ctx, db.InsertBetSettlementDetailParams{
			MarketID: marketID,
			PlayerID: pid,
			Staked:   staked,
			Earned:   earnedAmt,
		}); err != nil {
			return fmt.Errorf("insert settlement detail for player %d: %w", pid, err)
		}

		// Get current Elo (may be starting_elo if no history)
		var currentElo float64
		latestElo, err := q.GetPlayerLatestGlobalElo(ctx, pid)
		if err != nil {
			// No history - get starting elo from settings
			settings, sErr := q.GetEloSettingsForDate(ctx, resolvedAtTz)
			if sErr != nil {
				return fmt.Errorf("get elo settings: %w", sErr)
			}
			currentElo = settings.StartingElo
		} else {
			currentElo = latestElo
		}

		newRating := currentElo + (earnedAmt - staked)
		if err := q.UpsertPlayerRatingByMarket(ctx, db.UpsertPlayerRatingByMarketParams{
			Date:     resolvedAtTz,
			PlayerID: pid,
			Rating:   newRating,
			MarketID: pgtype.Int4{Int32: marketID, Valid: true},
		}); err != nil {
			return fmt.Errorf("upsert player rating for player %d: %w", pid, err)
		}
	}

	// Update market status
	resMatchID := pgtype.Int4{}
	if resolutionMatchID != nil {
		resMatchID = pgtype.Int4{Int32: *resolutionMatchID, Valid: true}
	}
	if err := q.ResolveMarket(ctx, db.ResolveMarketParams{
		ID:                marketID,
		Status:            outcome,
		ResolvedAt:        resolvedAtTz,
		ResolutionMatchID: resMatchID,
	}); err != nil {
		return fmt.Errorf("resolve market %d: %w", marketID, err)
	}

	// Update bet limits for all participants
	if err := RecalculateBetLimits(ctx, q, allPlayerIDs); err != nil {
		return fmt.Errorf("recalculate bet limits: %w", err)
	}

	return nil
}

// ExpireOverdueMarkets settles or cancels markets whose closes_at has passed.
// Runs in its own transaction.
func (s *MarketService) ExpireOverdueMarkets(ctx context.Context) error {
	// Cancel overdue match_winner markets
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	q := s.Queries.WithTx(tx)

	overdueMatchWinner, err := q.ListOverdueMatchWinnerMarkets(ctx)
	if err != nil {
		return fmt.Errorf("list overdue match_winner markets: %w", err)
	}
	for _, m := range overdueMatchWinner {
		closesAt := m.ClosesAt.Time
		if err := s.SettleMarket(ctx, q, m.ID, "cancelled", closesAt, nil); err != nil {
			return fmt.Errorf("cancel overdue match_winner market %d: %w", m.ID, err)
		}
	}

	// Resolve overdue win_streak markets
	overdueWinStreak, err := q.ListOverdueWinStreakMarkets(ctx)
	if err != nil {
		return fmt.Errorf("list overdue win_streak markets: %w", err)
	}
	for _, m := range overdueWinStreak {
		closesAt := m.ClosesAt.Time
		stats, err := q.GetPlayerStreakStats(ctx, db.GetPlayerStreakStatsParams{
			PlayerID: m.TargetPlayerID,
			GameID:   m.GameID,
			Date:     m.StartsAt,
			Date_2:   m.ClosesAt,
		})
		if err != nil {
			return fmt.Errorf("streak stats for market %d: %w", m.ID, err)
		}

		finalOutcome := "resolved_no"
		if stats.Wins >= m.WinsRequired && (!m.MaxLosses.Valid || stats.Losses <= m.MaxLosses.Int32) {
			finalOutcome = "resolved_yes"
		}
		if err := s.SettleMarket(ctx, q, m.ID, finalOutcome, closesAt, nil); err != nil {
			return fmt.Errorf("settle overdue win_streak market %d: %w", m.ID, err)
		}
	}

	return tx.Commit(ctx)
}

// ScheduleNextExpiry sets a timer for the closest upcoming market expiry.
func (s *MarketService) ScheduleNextExpiry(ctx context.Context) {
	s.timerMu.Lock()
	defer s.timerMu.Unlock()

	if s.timer != nil {
		s.timer.Stop()
		s.timer = nil
	}

	nextExpiry, err := s.Queries.GetNearestMarketExpiry(ctx)
	if err != nil || !nextExpiry.Valid {
		// No open markets
		return
	}

	dur := time.Until(nextExpiry.Time)
	if dur < 0 {
		dur = 0
	}

	bgCtx := context.Background()
	s.timer = time.AfterFunc(dur, func() {
		if err := s.ExpireOverdueMarkets(bgCtx); err != nil {
			log.Printf("ExpireOverdueMarkets error: %v", err)
		}
		s.ScheduleNextExpiry(bgCtx)
	})
}
