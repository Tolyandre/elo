package elo

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

type CreateMarketParams struct {
	ID         id.ID
	MarketType string
	StartsAt   time.Time
	ClosesAt   time.Time
	CreatedBy  id.ID

	// Fixed-odds / LMSR fields. Markets are created without guarantors (ADR-20):
	// liquidity_b starts at 0 and grows as guarantee wagers arrive, bounded by
	// MaxGuarantorLoss.
	MaxGuarantorLoss float64 // <=0 ⇒ derived from elo_settings.market_default_max_guarantor_loss

	MatchWinner *MatchWinnerCreateParams // set when MarketType == "match_winner"
	WinStreak   *WinStreakCreateParams   // set when MarketType == "win_streak"
}

// IMarketService is the write/business side of the markets domain. The API
// layer's read-side queries go through *db.Queries directly (see api.MarketQueries).
type IMarketService interface {
	CreateMarket(ctx context.Context, params CreateMarketParams) (db.Market, error)
	PlaceBet(ctx context.Context, betID id.ID, marketID id.ID, playerID id.ID, outcome id.ID, shares float64, expectedProbability float64) (PlaceBetOutcome, error)

	// JoinAsGuarantee adds the player's voluntary guarantor wager (risk amount
	// + maker fee rate) to an open market and grows the market's liquidity.
	// Prices are NOT preserved: with q fixed, raising b moves them toward the
	// uniform 1/n vector — the honest repricing of the same order flow against
	// deeper backing (ADR-22 removed the price-preserving q rescale, whose
	// inflated q broke settlement solvency). Wagers are immutable.
	JoinAsGuarantee(ctx context.Context, guaranteeID id.ID, marketID id.ID, playerID id.ID, riskAmount, feeRate float64) (GuaranteeOutcome, error)

	// TriggerResolutionForMatch checks open markets and resolves/settles them based on the given match.
	// Must be called within an active transaction (q is transactional).
	TriggerResolutionForMatch(ctx context.Context, q *db.Queries, matchID id.ID) error

	// UnsettleMarketsFromDate resets markets that were resolved by matches on/after fromDate.
	// Must be called within an active transaction.
	UnsettleMarketsFromDate(ctx context.Context, q *db.Queries, fromDate time.Time) error

	// SettleMarket pays out the winning side (each winning share pays 1) and
	// redistributes the settlement residual across the market's guarantors, keeping
	// elo strictly conserved (zero-sum across buyers + guarantors).
	// OutcomeCancelled refunds all spent elo. Must be called within an active transaction.
	SettleMarket(ctx context.Context, q *db.Queries, marketID id.ID, outcome MarketOutcome, resolvedAt time.Time, resolutionMatchID *id.ID) error

	// ExpireOverdueMarkets settles or cancels markets whose closes_at has passed.
	ExpireOverdueMarkets(ctx context.Context) error

	// ExpireMarketsAtDate settles markets whose closes_at <= date.
	// Used by the sequential event processor to integrate time-based expiry into
	// the settlement order. Must be called within an active transaction.
	ExpireMarketsAtDate(ctx context.Context, q *db.Queries, date time.Time) error

	// LockMarketBetting stops new bets from being placed on an open market.
	// This is a user event: betting_closed_at is persisted and never cleared
	// during recalculation. Returns ErrMarketNotOpen if the market is not 'open'.
	LockMarketBetting(ctx context.Context, marketID id.ID) error

	// ScheduleNextExpiry sets a timer for the next market expiry.
	ScheduleNextExpiry(ctx context.Context)
}

type MarketService struct {
	Queries *db.Queries
	Pool    *pgxpool.Pool
	Hub     *Hub // optional; when set, PlaceBet broadcasts new prices
	timer   *time.Timer
	timerMu sync.Mutex
}

func NewMarketService(pool *pgxpool.Pool) *MarketService {
	return &MarketService{
		Queries: db.New(pool),
		Pool:    pool,
	}
}

// NewMarketServiceWithHub wires the SSE hub so PlaceBet broadcasts live price
// updates to connected clients.
func NewMarketServiceWithHub(pool *pgxpool.Pool, hub *Hub) *MarketService {
	return &MarketService{
		Queries: db.New(pool),
		Pool:    pool,
		Hub:     hub,
	}
}

// LiveOutcome is one outcome's live state in the SSE probabilities payload:
// the probability (LMSR marginal price), outstanding shares and elo pool.
type LiveOutcome struct {
	ID          string  `json:"id"`
	Probability float64 `json:"probability"`
	Shares      float64 `json:"shares"`
	Pool        float64 `json:"pool"`
}

// broadcastProbabilities fans the new per-outcome probabilities + share counts
// + pools out to the market's SSE subscribers and signals the markets-list
// lobby.
func (s *MarketService) broadcastProbabilities(marketID id.ID, outcomes []LiveOutcome) {
	payload, err := json.Marshal(SSEEvent{
		Type: "probabilities",
		Data: ProbabilitiesPayload{Outcomes: outcomes},
	})
	if err != nil {
		return
	}
	s.Hub.Broadcast(MarketTopic(marketID), payload)
	s.Hub.PublishSignal(TopicLobbyMarkets, "markets-changed")
}

// ProbabilitiesPayload is the data part of the "probabilities" SSE event,
// shared by the PlaceBet broadcast and the MarketEvents connect frame.
type ProbabilitiesPayload struct {
	Outcomes []LiveOutcome `json:"outcomes"`
}
