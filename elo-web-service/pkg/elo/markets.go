package elo

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/db"
)


type CreateMarketParams struct {
	MarketType string
	StartsAt   time.Time
	ClosesAt   time.Time
	CreatedBy  int32

	MatchWinner *MatchWinnerCreateParams // set when MarketType == "match_winner"
	WinStreak   *WinStreakCreateParams   // set when MarketType == "win_streak"
}

type IMarketService interface {
	CreateMarket(ctx context.Context, params CreateMarketParams) (db.Market, error)
	PlaceBet(ctx context.Context, marketID int32, playerID int32, outcome string, amount float64) error

	// TriggerResolutionForMatch checks open markets and resolves/settles them based on the given match.
	// Must be called within an active transaction (q is transactional).
	TriggerResolutionForMatch(ctx context.Context, q *db.Queries, matchID int32) error

	// UnsettleMarketsFromDate resets markets that were resolved by matches on/after fromDate.
	// Must be called within an active transaction.
	UnsettleMarketsFromDate(ctx context.Context, q *db.Queries, fromDate time.Time) error

	// SettleMarket applies parimutuel payout for the given market and outcome.
	// OutcomeCancelled returns all stakes. Must be called within an active transaction.
	SettleMarket(ctx context.Context, q *db.Queries, marketID int32, outcome MarketOutcome, resolvedAt time.Time, resolutionMatchID *int32) error

	// ExpireOverdueMarkets settles or cancels markets whose closes_at has passed.
	ExpireOverdueMarkets(ctx context.Context) error

	// ExpireMarketsAtDate settles markets whose closes_at <= date.
	// Used by the sequential event processor to integrate time-based expiry into
	// the settlement order. Must be called within an active transaction.
	ExpireMarketsAtDate(ctx context.Context, q *db.Queries, date time.Time) error

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

func (s *MarketService) CreateMarket(ctx context.Context, params CreateMarketParams) (db.Market, error) {
	handler, ok := marketTypeHandlers[params.MarketType]
	if !ok {
		return db.Market{}, fmt.Errorf("unknown market_type: %s", params.MarketType)
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return db.Market{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	q := s.Queries.WithTx(tx)

	market, err := q.CreateMarket(ctx, db.CreateMarketParams{
		MarketType: params.MarketType,
		StartsAt:   pgtype.Timestamptz{Time: params.StartsAt, Valid: true},
		ClosesAt:   pgtype.Timestamptz{Time: params.ClosesAt, Valid: true},
		CreatedBy:  params.CreatedBy,
	})
	if err != nil {
		return db.Market{}, fmt.Errorf("insert market: %w", err)
	}

	if err := handler.CreateParams(ctx, q, market.ID, params); err != nil {
		return db.Market{}, fmt.Errorf("create %s params: %w", params.MarketType, err)
	}

	if err := tx.Commit(ctx); err != nil {
		return db.Market{}, fmt.Errorf("commit tx: %w", err)
	}

	s.ScheduleNextExpiry(context.Background())

	return market, nil
}

func (s *MarketService) PlaceBet(ctx context.Context, marketID int32, playerID int32, outcome string, amount float64) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	q := s.Queries.WithTx(tx)

	if _, err := q.LockPlayerForEloCalculation(ctx, playerID); err != nil {
		return fmt.Errorf("lock player: %w", err)
	}

	market, err := q.GetMarketWithPools(ctx, marketID)
	if err != nil {
		return fmt.Errorf("get market: %w", err)
	}
	if market.Status != "open" {
		return ErrMarketNotOpen
	}

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
	match, err := q.GetMatch(ctx, matchID)
	if err != nil {
		return fmt.Errorf("get match %d: %w", matchID, err)
	}

	scores, err := q.GetMatchScoresForMatch(ctx, matchID)
	if err != nil {
		return fmt.Errorf("get scores for match %d: %w", matchID, err)
	}

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

	matchInfo := MatchInfo{
		Match:          match,
		ParticipantSet: participantSet,
		PlayerScoreMap: playerScoreMap,
		MaxScore:       maxScore,
	}

	settle := s.SettleMarket

	for marketType, handler := range marketTypeHandlers {
		if err := handler.ResolutionTrigger().OnMatch(ctx, q, matchInfo, settle); err != nil {
			return fmt.Errorf("resolve %s markets: %w", marketType, err)
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
func (s *MarketService) SettleMarket(ctx context.Context, q *db.Queries, marketID int32, outcome MarketOutcome, resolvedAt time.Time, resolutionMatchID *int32) error {
	rows, err := q.GetBetsAggregatedByOutcome(ctx, marketID)
	if err != nil {
		return fmt.Errorf("get bets for market %d: %w", marketID, err)
	}

	type playerData struct {
		totalStaked    float64
		winningOutcome float64
	}
	players := make(map[int32]*playerData)
	totalPool := 0.0
	winningPool := 0.0

	isCancelled := outcome == OutcomeCancelled
	winningSide := string(outcome) // "yes", "no", "player_42", etc.

	for _, row := range rows {
		if _, ok := players[row.PlayerID]; !ok {
			players[row.PlayerID] = &playerData{}
		}
		players[row.PlayerID].totalStaked += row.TotalAmount
		totalPool += row.TotalAmount
		if !isCancelled && row.Outcome == winningSide {
			players[row.PlayerID].winningOutcome += row.TotalAmount
			winningPool += row.TotalAmount
		}
	}

	if isCancelled {
		winningPool = totalPool
		for pid := range players {
			players[pid].winningOutcome = players[pid].totalStaked
		}
	}

	earned := make(map[int32]float64)
	for pid, pd := range players {
		if winningPool == 0 {
			earned[pid] = pd.totalStaked
		} else {
			earned[pid] = (pd.winningOutcome / winningPool) * totalPool
		}
	}

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

		var currentElo float64
		latestElo, err := q.GetPlayerLatestGlobalEloAtDate(ctx, db.GetPlayerLatestGlobalEloAtDateParams{
			PlayerID: pid,
			Date:     resolvedAtTz,
		})
		if err != nil {
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

	resMatchID := pgtype.Int4{}
	if resolutionMatchID != nil {
		resMatchID = pgtype.Int4{Int32: *resolutionMatchID, Valid: true}
	}
	resolutionOutcome := pgtype.Text{}
	if !isCancelled {
		resolutionOutcome = pgtype.Text{String: winningSide, Valid: true}
	}
	if err := q.ResolveMarket(ctx, db.ResolveMarketParams{
		ID:                marketID,
		Status:            statusForOutcome(outcome),
		ResolvedAt:        resolvedAtTz,
		ResolutionMatchID: resMatchID,
		ResolutionOutcome: resolutionOutcome,
	}); err != nil {
		return fmt.Errorf("resolve market %d: %w", marketID, err)
	}

	if err := RecalculateBetLimits(ctx, q, allPlayerIDs); err != nil {
		return fmt.Errorf("recalculate bet limits: %w", err)
	}

	return nil
}

// ExpireMarketsAtDate settles markets whose closes_at <= date.
// Must be called within an active transaction.
func (s *MarketService) ExpireMarketsAtDate(ctx context.Context, q *db.Queries, date time.Time) error {
	for marketType, handler := range marketTypeHandlers {
		if err := handler.ResolutionTrigger().OnTimeExpiry(ctx, q, date, s.SettleMarket); err != nil {
			return fmt.Errorf("expire %s markets at date: %w", marketType, err)
		}
	}
	return nil
}

// ExpireOverdueMarkets settles or cancels markets whose closes_at has passed.
// Runs in its own transaction.
func (s *MarketService) ExpireOverdueMarkets(ctx context.Context) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	q := s.Queries.WithTx(tx)

	for marketType, handler := range marketTypeHandlers {
		if err := handler.ResolutionTrigger().OnOverdue(ctx, q, s.SettleMarket); err != nil {
			return fmt.Errorf("expire %s markets: %w", marketType, err)
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
