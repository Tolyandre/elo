package elo

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/api/shortid"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

type CreateMarketParams struct {
	ID         string
	MarketType string
	StartsAt   time.Time
	ClosesAt   time.Time
	CreatedBy  string

	// Fixed-odds / LMSR fields.
	LiquidityB         float64  // <=0 ⇒ resolved from elo_settings.market_default_liquidity_b
	GuarantorPlayerIDs []string // players who absorb the market's settlement residual

	MatchWinner *MatchWinnerCreateParams // set when MarketType == "match_winner"
	WinStreak   *WinStreakCreateParams   // set when MarketType == "win_streak"
}

type IMarketService interface {
	CreateMarket(ctx context.Context, params CreateMarketParams) (db.Market, error)
	PlaceBet(ctx context.Context, id string, marketID string, playerID string, outcome string, shares float64, expectedPrice float64) (PlaceBetOutcome, error)

	// TriggerResolutionForMatch checks open markets and resolves/settles them based on the given match.
	// Must be called within an active transaction (q is transactional).
	TriggerResolutionForMatch(ctx context.Context, q *db.Queries, matchID string) error

	// UnsettleMarketsFromDate resets markets that were resolved by matches on/after fromDate.
	// Must be called within an active transaction.
	UnsettleMarketsFromDate(ctx context.Context, q *db.Queries, fromDate time.Time) error

	// SettleMarket pays out the winning side (each winning share pays 1) and
	// redistributes the settlement residual across the market's guarantors, keeping
	// elo strictly conserved (zero-sum across buyers + guarantors).
	// OutcomeCancelled refunds all spent elo. Must be called within an active transaction.
	SettleMarket(ctx context.Context, q *db.Queries, marketID string, outcome MarketOutcome, resolvedAt time.Time, resolutionMatchID *string) error

	// ExpireOverdueMarkets settles or cancels markets whose closes_at has passed.
	ExpireOverdueMarkets(ctx context.Context) error

	// ExpireMarketsAtDate settles markets whose closes_at <= date.
	// Used by the sequential event processor to integrate time-based expiry into
	// the settlement order. Must be called within an active transaction.
	ExpireMarketsAtDate(ctx context.Context, q *db.Queries, date time.Time) error

	// LockMarketBetting stops new bets from being placed on an open market.
	// This is a user event: betting_closed_at is persisted and never cleared
	// during recalculation. Returns ErrMarketNotOpen if the market is not 'open'.
	LockMarketBetting(ctx context.Context, marketID string) error

	// ScheduleNextExpiry sets a timer for the next market expiry.
	ScheduleNextExpiry(ctx context.Context)

	// --- read-side queries used by the market handlers ---------------------

	ListMarkets(ctx context.Context) ([]db.ListMarketsRow, error)
	GetMarket(ctx context.Context, id string) (db.GetMarketRow, error)
	ListMarketOutcomesWithPools(ctx context.Context, marketID string) ([]db.ListMarketOutcomesWithPoolsRow, error)
	ListAllMarketOutcomesWithPools(ctx context.Context) ([]db.ListAllMarketOutcomesWithPoolsRow, error)
	GetSettlementDetails(ctx context.Context, marketID *string) ([]db.GetSettlementDetailsRow, error)
	GetMarketGuarantorPayouts(ctx context.Context, marketID string) ([]db.GetMarketGuarantorPayoutsRow, error)
	ListMarketsByResolutionMatch(ctx context.Context, resolutionMatchID *string) ([]db.ListMarketsByResolutionMatchRow, error)
	GetPlayerBetsAggregatedForMarket(ctx context.Context, arg db.GetPlayerBetsAggregatedForMarketParams) ([]db.GetPlayerBetsAggregatedForMarketRow, error)
	GetPlayerBetsForMarket(ctx context.Context, arg db.GetPlayerBetsForMarketParams) ([]db.GetPlayerBetsForMarketRow, error)
	ListMarketGuarantors(ctx context.Context, marketID string) ([]db.ListMarketGuarantorsRow, error)
	GetPlayerReservedAmount(ctx context.Context, playerID string) (float64, error)
	GetPlayerBetLimit(ctx context.Context, playerID string) (float64, error)
	GetMarketPriceHistory(ctx context.Context, marketID string) ([]PricePoint, error)
}

type MarketService struct {
	Queries *db.Queries
	Pool    *pgxpool.Pool
	Hub     *MarketsHub // optional; when set, PlaceBet broadcasts new prices
	timer   *time.Timer
	timerMu sync.Mutex
}

func NewMarketService(pool *pgxpool.Pool) IMarketService {
	return &MarketService{
		Queries: db.New(pool),
		Pool:    pool,
	}
}

// NewMarketServiceWithHub wires the SSE hub so PlaceBet broadcasts live price
// updates to connected clients.
func NewMarketServiceWithHub(pool *pgxpool.Pool, hub *MarketsHub) IMarketService {
	return &MarketService{
		Queries: db.New(pool),
		Pool:    pool,
		Hub:     hub,
	}
}

// --- read-side queries. These delegate to *db.Queries so the market handlers
// go through the service boundary instead of holding *db.Queries directly. ---

func (s *MarketService) ListMarkets(ctx context.Context) ([]db.ListMarketsRow, error) {
	return s.Queries.ListMarkets(ctx)
}

func (s *MarketService) GetMarket(ctx context.Context, id string) (db.GetMarketRow, error) {
	return s.Queries.GetMarket(ctx, id)
}

func (s *MarketService) ListMarketOutcomesWithPools(ctx context.Context, marketID string) ([]db.ListMarketOutcomesWithPoolsRow, error) {
	return s.Queries.ListMarketOutcomesWithPools(ctx, marketID)
}

func (s *MarketService) ListAllMarketOutcomesWithPools(ctx context.Context) ([]db.ListAllMarketOutcomesWithPoolsRow, error) {
	return s.Queries.ListAllMarketOutcomesWithPools(ctx)
}

func (s *MarketService) GetSettlementDetails(ctx context.Context, marketID *string) ([]db.GetSettlementDetailsRow, error) {
	return s.Queries.GetSettlementDetails(ctx, marketID)
}

func (s *MarketService) GetMarketGuarantorPayouts(ctx context.Context, marketID string) ([]db.GetMarketGuarantorPayoutsRow, error) {
	return s.Queries.GetMarketGuarantorPayouts(ctx, marketID)
}

func (s *MarketService) ListMarketsByResolutionMatch(ctx context.Context, resolutionMatchID *string) ([]db.ListMarketsByResolutionMatchRow, error) {
	return s.Queries.ListMarketsByResolutionMatch(ctx, resolutionMatchID)
}

func (s *MarketService) GetPlayerBetsAggregatedForMarket(ctx context.Context, arg db.GetPlayerBetsAggregatedForMarketParams) ([]db.GetPlayerBetsAggregatedForMarketRow, error) {
	return s.Queries.GetPlayerBetsAggregatedForMarket(ctx, arg)
}

func (s *MarketService) GetPlayerBetsForMarket(ctx context.Context, arg db.GetPlayerBetsForMarketParams) ([]db.GetPlayerBetsForMarketRow, error) {
	return s.Queries.GetPlayerBetsForMarket(ctx, arg)
}

func (s *MarketService) ListMarketGuarantors(ctx context.Context, marketID string) ([]db.ListMarketGuarantorsRow, error) {
	return s.Queries.ListMarketGuarantors(ctx, marketID)
}

func (s *MarketService) GetPlayerReservedAmount(ctx context.Context, playerID string) (float64, error) {
	return s.Queries.GetPlayerReservedAmount(ctx, playerID)
}

func (s *MarketService) GetPlayerBetLimit(ctx context.Context, playerID string) (float64, error) {
	return s.Queries.GetPlayerBetLimit(ctx, playerID)
}

// GetMarketPriceHistory reconstructs the market's per-outcome price series by
// replaying its bet stream through the LMSR from the creation state q=0. No
// prices are persisted — see price_history.go.
func (s *MarketService) GetMarketPriceHistory(ctx context.Context, marketID string) ([]PricePoint, error) {
	market, err := s.Queries.GetMarket(ctx, marketID)
	if err != nil {
		return nil, err
	}
	outcomes, err := s.Queries.ListMarketOutcomes(ctx, marketID)
	if err != nil {
		return nil, err
	}
	rows, err := s.Queries.GetMarketBetsForPriceHistory(ctx, marketID)
	if err != nil {
		return nil, err
	}
	outcomeIDs := make([]string, len(outcomes))
	for i, o := range outcomes {
		outcomeIDs[i] = o.ID
	}
	bets := make([]PriceBet, len(rows))
	for i, r := range rows {
		bets[i] = PriceBet{Outcome: r.Outcome, Shares: r.Shares, PlacedAt: r.PlacedAt.Time}
	}
	// rows come back ordered by (placed_at, id) — the order PriceHistory expects.
	return PriceHistory(bets, outcomeIDs, market.LiquidityB), nil
}

func (s *MarketService) CreateMarket(ctx context.Context, params CreateMarketParams) (db.Market, error) {
	handler, ok := marketTypeHandlers[params.MarketType]
	if !ok {
		return db.Market{}, fmt.Errorf("unknown market_type: %s", params.MarketType)
	}
	// Guarantors are the zero-sum counterparty: without at least one, the fixed-odds
	// settlement residual (deficit or surplus) would have nowhere to go and elo
	// would not be conserved. The UI prefills the creator's player.
	if len(params.GuarantorPlayerIDs) == 0 {
		return db.Market{}, ErrMarketNeedsGuarantor
	}

	// Resolve the LMSR liquidity parameter: use the caller's value, else the
	// configured default. b must be > 0 (it bounds guarantor loss at b·ln 2).
	liquidityB := params.LiquidityB
	if liquidityB <= 0 {
		settingsRow, err := s.Queries.GetEloSettingsForDate(ctx, pgtype.Timestamptz{Time: params.StartsAt, Valid: true})
		if err != nil {
			return db.Market{}, fmt.Errorf("get elo settings for default liquidity: %w", err)
		}
		liquidityB = settingsRow.MarketDefaultLiquidityB
		if liquidityB <= 0 {
			liquidityB = 100
		}
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return db.Market{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	q := s.Queries.WithTx(tx)

	market, err := q.CreateMarket(ctx, db.CreateMarketParams{
		ID:         params.ID,
		MarketType: params.MarketType,
		StartsAt:   pgtype.Timestamptz{Time: params.StartsAt, Valid: true},
		ClosesAt:   pgtype.Timestamptz{Time: params.ClosesAt, Valid: true},
		CreatedBy:  params.CreatedBy,
		LiquidityB: liquidityB,
	})
	if err != nil {
		return db.Market{}, fmt.Errorf("insert market: %w", err)
	}

	if err := handler.CreateParams(ctx, q, market.ID, params); err != nil {
		return db.Market{}, fmt.Errorf("create %s params: %w", params.MarketType, err)
	}

	if len(params.GuarantorPlayerIDs) > 0 {
		if err := q.CreateMarketGuarantors(ctx, db.CreateMarketGuarantorsParams{
			MarketID:  market.ID,
			PlayerIds: params.GuarantorPlayerIDs,
		}); err != nil {
			return db.Market{}, fmt.Errorf("insert guarantors: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return db.Market{}, fmt.Errorf("commit tx: %w", err)
	}

	s.ScheduleNextExpiry(context.Background())

	if s.Hub != nil {
		s.Hub.BroadcastLobby([]byte(`{"type":"markets-changed"}`))
	}

	return market, nil
}

// PriceTolerance is the maximum allowed difference between the expected price
// the buyer saw (and sends with the bet) and the live marginal price at bet
// time. Covers UI rounding and SSE propagation latency, but rejects the buy
// once other participants have moved the market.
const PriceTolerance = 0.01

// PlaceBetOutcome is returned to the buyer: the shares received and the effective
// price paid per share (amount / shares).
type PlaceBetOutcome struct {
	Shares float64
	Price  float64
}

func (s *MarketService) PlaceBet(ctx context.Context, id string, marketID string, playerID string, outcome string, shares float64, expectedPrice float64) (PlaceBetOutcome, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return PlaceBetOutcome{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	q := s.Queries.WithTx(tx)

	if _, err := q.LockPlayerForEloCalculation(ctx, playerID); err != nil {
		return PlaceBetOutcome{}, fmt.Errorf("lock player: %w", err)
	}

	market, err := q.GetMarket(ctx, marketID)
	if err != nil {
		return PlaceBetOutcome{}, fmt.Errorf("get market: %w", err)
	}
	if market.Status != "open" {
		return PlaceBetOutcome{}, ErrMarketNotOpen
	}

	// The outcome rows fix the AMM q-vector layout; the bet's outcome must be
	// one of them.
	outcomes, err := q.ListMarketOutcomesWithPools(ctx, marketID)
	if err != nil {
		return PlaceBetOutcome{}, fmt.Errorf("list market outcomes: %w", err)
	}
	outcomeIdx := -1
	qVec := make([]float64, len(outcomes))
	for i, o := range outcomes {
		qVec[i] = o.Q
		if o.ID == outcome {
			outcomeIdx = i
		}
	}
	if outcomeIdx < 0 {
		return PlaceBetOutcome{}, ErrMarketOutcomeNotFound
	}

	// The buyer must confirm the price they saw: reject if the live marginal
	// price of the outcome has drifted away beyond PriceTolerance since the
	// client loaded it.
	currentPrice := MarginalPricesN(qVec, market.LiquidityB)[outcomeIdx]
	if math.Abs(currentPrice-expectedPrice) > PriceTolerance {
		return PlaceBetOutcome{}, ErrPriceChanged
	}

	// A guarantor may also buy on their own market (the creator's player is
	// prefilled as guarantor): at settlement they get separate buyer and
	// guarantor rows (ADR-10).

	// Shares-driven buy per ADR-10: the buyer asks for `shares` tokens (the UI
	// always buys 1) and pays the AMM cost amount = C(q+shares·e_i) − C(q).
	// `amount` is what is reserved against the buyer's bet_limit.
	newQ, amount := ApplyBetN(qVec, market.LiquidityB, outcomeIdx, shares)

	reserved, err := q.GetPlayerReservedAmount(ctx, playerID)
	if err != nil {
		return PlaceBetOutcome{}, fmt.Errorf("get reserved amount: %w", err)
	}
	limit, err := q.GetPlayerBetLimit(ctx, playerID)
	if err != nil {
		return PlaceBetOutcome{}, fmt.Errorf("get bet limit: %w", err)
	}
	if reserved+amount > limit {
		return PlaceBetOutcome{}, ErrBetLimitExceeded
	}

	if _, err := q.InsertBet(ctx, db.InsertBetParams{
		ID:       id,
		MarketID: marketID,
		PlayerID: playerID,
		Outcome:  outcome,
		Cost:     amount,
		Shares:   shares,
	}); err != nil {
		return PlaceBetOutcome{}, fmt.Errorf("insert bet: %w", err)
	}

	if err := q.UpdateMarketOutcomeQ(ctx, db.UpdateMarketOutcomeQParams{
		MarketID: marketID,
		ID:       outcome,
		Q:        newQ[outcomeIdx],
	}); err != nil {
		return PlaceBetOutcome{}, fmt.Errorf("update amm state: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return PlaceBetOutcome{}, fmt.Errorf("commit tx: %w", err)
	}

	if s.Hub != nil {
		live := make([]LiveOutcome, len(outcomes))
		prices := MarginalPricesN(newQ, market.LiquidityB)
		for i, o := range outcomes {
			pool := o.Pool
			if i == outcomeIdx {
				pool += amount
			}
			// SSE frames bypass the idcodec middleware (it only rewrites
			// buffered application/json responses), so the short id encoding
			// every other payload uses is applied here, at construction.
			live[i] = LiveOutcome{ID: shortid.FromCanonical(o.ID), Price: prices[i], Shares: newQ[i], Pool: pool}
		}
		s.broadcastPrices(marketID, live)
	}

	price := 0.0
	if shares > 0 {
		price = amount / shares
	}
	return PlaceBetOutcome{Shares: shares, Price: price}, nil
}

// LiveOutcome is one outcome's live state in the SSE prices payload.
type LiveOutcome struct {
	ID     string  `json:"id"`
	Price  float64 `json:"price"`
	Shares float64 `json:"shares"`
	Pool   float64 `json:"pool"`
}

// broadcastPrices fans the new per-outcome LMSR prices + share counts + pools
// out to the market's SSE subscribers and signals the markets-list lobby.
func (s *MarketService) broadcastPrices(marketID string, outcomes []LiveOutcome) {
	payload, err := json.Marshal(marketsSSEEvent{
		Type: "prices",
		Data: pricesPayload{Outcomes: outcomes},
	})
	if err != nil {
		return
	}
	s.Hub.Broadcast(marketID, payload)
	s.Hub.BroadcastLobby([]byte(`{"type":"markets-changed"}`))
}

type marketsSSEEvent struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

type pricesPayload struct {
	Outcomes []LiveOutcome `json:"outcomes"`
}

// TriggerResolutionForMatch checks all open markets and resolves them if the given match satisfies their conditions.
// Must be called within an active transaction (q is transactional Queries).
func (s *MarketService) TriggerResolutionForMatch(ctx context.Context, q *db.Queries, matchID string) error {
	match, err := q.GetMatch(ctx, matchID)
	if err != nil {
		return fmt.Errorf("get match %s: %w", matchID, err)
	}

	scores, err := q.GetMatchScoresForMatch(ctx, matchID)
	if err != nil {
		return fmt.Errorf("get scores for match %s: %w", matchID, err)
	}

	participantSet := make(map[string]bool)
	playerScoreMap := make(map[string]float64)
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
		if err := q.DeleteGlobalArenaSettlementByMarket(ctx, &marketID); err != nil {
			return fmt.Errorf("delete global arena settlement for market %s: %w", marketID, err)
		}
		if err := q.UnsettleMarket(ctx, marketID); err != nil {
			return fmt.Errorf("unsettle market %s: %w", marketID, err)
		}
	}
	return nil
}

// SettleMarket pays the winning side (each winning share pays 1) and redistributes
// the settlement residual across the market's guarantors, keeping elo strictly
// conserved (zero-sum across buyers + guarantors).
// OutcomeCancelled refunds all spent elo. Must be called within an active transaction.
func (s *MarketService) SettleMarket(ctx context.Context, q *db.Queries, marketID string, outcome MarketOutcome, resolvedAt time.Time, resolutionMatchID *string) error {
	bets, err := q.GetBetsForSettlement(ctx, marketID)
	if err != nil {
		return fmt.Errorf("get bets for market %s: %w", marketID, err)
	}
	guarantors, err := q.ListMarketGuarantors(ctx, marketID)
	if err != nil {
		return fmt.Errorf("get guarantors for market %s: %w", marketID, err)
	}

	isCancelled := outcome == OutcomeCancelled
	winningSide := string(outcome) // "yes", "no", "player_42", etc.

	// Per-player buy P&L. staked is the elo spent (positive magnitude); earned is
	// the payout (shares × 1 for the winning side, or the stake refunded on cancel).
	// Losers earn 0.
	type playerData struct {
		staked float64
		earned float64
	}
	players := make(map[string]*playerData)
	totalCollected := 0.0
	totalPaid := 0.0
	for _, b := range bets {
		pd := players[b.PlayerID]
		if pd == nil {
			pd = &playerData{}
			players[b.PlayerID] = pd
		}
		pd.staked += b.Cost
		totalCollected += b.Cost
		if isCancelled {
			pd.earned += b.Cost // refund of elo spent
		} else if b.Outcome == winningSide {
			pd.earned += b.Shares // each winning share pays 1
			totalPaid += b.Shares
		}
	}

	// Guarantor residual = collected − paid. Split equally across guarantors,
	// assigning the FP remainder to the last guarantor so the shares sum to the
	// residual exactly (strict conservation).
	guarantorSet := make(map[string]bool, len(guarantors))
	guarantorIDs := make([]string, 0, len(guarantors))
	for _, g := range guarantors {
		if !guarantorSet[g.PlayerID] {
			guarantorSet[g.PlayerID] = true
			guarantorIDs = append(guarantorIDs, g.PlayerID)
		}
	}
	sortPlayerIDs(guarantorIDs)
	shares := make(map[string]float64, len(guarantorIDs))
	if !isCancelled && len(guarantorIDs) > 0 {
		residual := totalCollected - totalPaid // +surplus / −deficit
		n := len(guarantorIDs)
		perShare := residual / float64(n)
		for i := 0; i < n-1; i++ {
			shares[guarantorIDs[i]] = perShare
		}
		shares[guarantorIDs[n-1]] = residual - perShare*float64(n-1)
	}

	// A player may be both buyer and guarantor (the creator's player is prefilled
	// as guarantor, and guarantors may buy). They get one settlement row per role
	// (UNIQUE (market_id, player_id, discriminator), ADR-10): the 'market' row
	// carries the buy P&L, the 'market_guarantor' row carries their residual
	// share — so the value change per bet and the guarantor payout/surcharge are
	// individually visible. Pure guarantors keep the 'market_guarantor'
	// discriminator for the guarantor-payout rollup.
	allPlayerIDSet := make(map[string]bool, len(players)+len(guarantorIDs))
	for pid := range players {
		allPlayerIDSet[pid] = true
	}
	for _, pid := range guarantorIDs {
		allPlayerIDSet[pid] = true
	}
	allPlayerIDs := make([]string, 0, len(allPlayerIDSet))
	for pid := range allPlayerIDSet {
		allPlayerIDs = append(allPlayerIDs, pid)
	}
	sortPlayerIDs(allPlayerIDs)

	resolvedAtTz := pgtype.Timestamptz{Time: resolvedAt, Valid: true}

	settingsRow, err := q.GetEloSettingsForDate(ctx, resolvedAtTz)
	if err != nil {
		return fmt.Errorf("get elo settings: %w", err)
	}
	settings := EloSettingsFromDB(settingsRow)

	date6MAgo := pgtype.Timestamptz{Time: resolvedAt.Add(-6 * 30 * 24 * time.Hour), Valid: true}
	date2MAgo := pgtype.Timestamptz{Time: resolvedAt.Add(-2 * 30 * 24 * time.Hour), Valid: true}

	// One settlement row per role per player over buyers ∪ guarantors: elo spent
	// as negative staked, payout (winning shares × 1, or refund on cancel) as
	// earned for the 'market' row; the guarantor residual share (deficit as
	// staked, surplus as earned) for the 'market_guarantor' row. Both rows of a
	// buyer∩guarantor player share the same total-based *_after balances so the
	// latest-at-date elo/rating read stays correct whichever row the id tie-break
	// picks — hence the balances are read once, before either row is written.
	for _, pid := range allPlayerIDs {
		var buyerStaked, buyerEarned float64
		if pd := players[pid]; pd != nil {
			buyerStaked = -pd.staked
			buyerEarned = pd.earned
		}
		var guarantorStaked, guarantorEarned float64
		if share := shares[pid]; share != 0 {
			guarantorStaked = math.Min(share, 0)
			guarantorEarned = math.Max(share, 0)
		}
		totalStaked := buyerStaked + guarantorStaked
		totalEarned := buyerEarned + guarantorEarned

		if buyerStaked == 0 && buyerEarned == 0 && guarantorStaked == 0 && guarantorEarned == 0 {
			continue
		}

		balances, err := s.readMarketSettlementBalances(ctx, q, pid, resolvedAtTz, settings, date6MAgo, date2MAgo)
		if err != nil {
			return fmt.Errorf("read balances for %s: %w", pid, err)
		}
		newElo := balances.currentElo + totalStaked + totalEarned
		newRating := balances.currentRating + totalStaked + totalEarned
		newLeague := determineGlobalLeague(balances.prevLeague, newRating, newElo, balances.count6M, balances.count2M, settings)

		if buyerStaked != 0 || buyerEarned != 0 {
			if err := s.upsertMarketSettlement(ctx, q, pid, marketID, "market",
				buyerStaked, buyerEarned, newElo, newRating, newLeague, resolvedAtTz); err != nil {
				return fmt.Errorf("upsert settlement for %s: %w", pid, err)
			}
		}
		if guarantorStaked != 0 || guarantorEarned != 0 {
			if err := s.upsertMarketSettlement(ctx, q, pid, marketID, "market_guarantor",
				guarantorStaked, guarantorEarned, newElo, newRating, newLeague, resolvedAtTz); err != nil {
				return fmt.Errorf("upsert guarantor settlement for %s: %w", pid, err)
			}
		}
	}

	var resMatchID *string
	if resolutionMatchID != nil {
		resMatchID = resolutionMatchID
	}
	// Cancelled markets carry no winning outcome: cancellation is encoded by
	// the status column and resolution_outcome stays NULL.
	var resolutionOutcome *string
	if !isCancelled {
		resolutionOutcome = &winningSide
	}
	if err := q.ResolveMarket(ctx, db.ResolveMarketParams{
		ID:                marketID,
		Status:            statusForOutcome(outcome),
		ResolvedAt:        resolvedAtTz,
		ResolutionMatchID: resMatchID,
		ResolutionOutcome: resolutionOutcome,
	}); err != nil {
		return fmt.Errorf("resolve market %s: %w", marketID, err)
	}

	if err := RecalculateBetLimits(ctx, q, allPlayerIDs); err != nil {
		return fmt.Errorf("recalculate bet limits: %w", err)
	}

	return nil
}

// marketSettlementBalances is the pre-market state one settlement row pair is
// computed from.
type marketSettlementBalances struct {
	currentElo    float64
	currentRating float64
	prevLeague    string
	count6M       int
	count2M       int
}

// readMarketSettlementBalances reads the player's pre-market elo/rating/league
// state. Called once per player before any of their rows are written, so the
// second role row cannot observe the first one (they share the settlement date).
func (s *MarketService) readMarketSettlementBalances(
	ctx context.Context, q *db.Queries, playerID string,
	resolvedAtTz pgtype.Timestamptz, settings EloSettings, date6MAgo, date2MAgo pgtype.Timestamptz,
) (marketSettlementBalances, error) {
	var b marketSettlementBalances
	latestElo, err := q.GetPlayerLatestGlobalEloAtDate(ctx, db.GetPlayerLatestGlobalEloAtDateParams{
		PlayerID: playerID,
		Date:     resolvedAtTz,
	})
	if err != nil {
		b.currentElo = settings.StartingElo
	} else {
		b.currentElo = latestElo
	}

	var storedLeague string
	latestRating, err := q.GetPlayerLatestGlobalRatingAtDate(ctx, db.GetPlayerLatestGlobalRatingAtDateParams{
		PlayerID: playerID,
		Date:     resolvedAtTz,
	})
	if err != nil {
		b.currentRating = settings.StartingRatingGlobal
		storedLeague = initialLeagueForStarting(settings.StartingRatingGlobal, settings.StartingElo, settings)
	} else {
		b.currentRating = latestRating.Rating
		storedLeague = latestRating.League
	}

	count6M, _ := q.GetPlayerGlobalMatchCountInPeriod(ctx, db.GetPlayerGlobalMatchCountInPeriodParams{
		PlayerID: playerID,
		Date:     date6MAgo,
		Date_2:   resolvedAtTz,
	})
	count2M, _ := q.GetPlayerGlobalMatchCountInPeriod(ctx, db.GetPlayerGlobalMatchCountInPeriodParams{
		PlayerID: playerID,
		Date:     date2MAgo,
		Date_2:   resolvedAtTz,
	})
	b.count6M = int(count6M)
	b.count2M = int(count2M)
	b.prevLeague = effectiveLeague(storedLeague, b.count2M, b.count6M, settings)
	return b, nil
}

// upsertMarketSettlement persists one role's settlement row. eloStaked (≤ 0) and
// eloEarned (≥ 0) are that role's delta (buyer P&L or guarantor residual share)
// and feed the display + zero-sum invariant; newElo/newRating/newLeague are the
// player's post-market balances (computed by the caller from the total delta
// across both roles) and must be identical on both rows of a buyer∩guarantor
// player. The rating track mirrors the elo track (markets apply no newbie
// scaling).
func (s *MarketService) upsertMarketSettlement(
	ctx context.Context, q *db.Queries, playerID, marketID, discriminator string,
	eloStaked, eloEarned, newElo, newRating float64, newLeague string,
	resolvedAtTz pgtype.Timestamptz,
) error {
	return q.UpsertGlobalArenaSettlementByMarket(ctx, db.UpsertGlobalArenaSettlementByMarketParams{
		ID:            newSettlementID(),
		PlayerID:      playerID,
		Date:          resolvedAtTz,
		RatingAfter:   newRating,
		EloAfter:      newElo,
		MarketID:      &marketID,
		Discriminator: discriminator,
		EloStaked:     eloStaked,
		EloEarned:     eloEarned,
		RatingStaked:  eloStaked,
		RatingEarned:  eloEarned,
		League:        newLeague,
	})
}

// LockMarketBetting stops accepting new bets on an open market (user event).
// betting_closed_at is stored permanently and never cleared during recalculation.
func (s *MarketService) LockMarketBetting(ctx context.Context, marketID string) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	q := s.Queries.WithTx(tx)

	market, err := q.GetMarket(ctx, marketID)
	if err != nil {
		return fmt.Errorf("get market: %w", err)
	}
	if market.Status != "open" {
		return ErrMarketNotOpen
	}

	if err := q.LockMarketBetting(ctx, marketID); err != nil {
		return fmt.Errorf("lock market betting: %w", err)
	}

	return tx.Commit(ctx)
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
