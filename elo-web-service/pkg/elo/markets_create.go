package elo

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

func (s *MarketService) CreateMarket(ctx context.Context, params CreateMarketParams) (db.Market, error) {
	// The market is created without guarantors (ADR-20): liquidity_b starts at
	// 0 — the market is untradable until the first guarantee wager arrives.
	// Every wagered elo then converts to liquidity: b = Σrisk/ln(n) (ADR-34
	// removed the L cap), so a guarantor's maximum loss stays the amount they
	// risked.

	market, err := runInTxResult(ctx, s.Pool, func(q *db.Queries) (db.Market, error) {
		return createMarketTx(ctx, q, params)
	})
	if err != nil {
		return db.Market{}, err
	}

	s.ScheduleNextExpiry(context.Background())

	if s.Hub != nil {
		s.Hub.PublishSignal(TopicLobbyMarkets, "markets-changed")
	}

	return market, nil
}

// createMarketTx inserts the market row and its type-specific params/outcomes
// against the caller's transactional queries. Markets are created without
// guarantors (ADR-20): liquidity_b starts at 0 — the market is untradable
// until the first guarantee wager arrives. Every wagered elo then converts to
// liquidity: b = Σrisk/ln(n) (ADR-34 removed the L cap), so a guarantor's
// maximum loss stays the amount they risked.
//
// A tournament_winner market has no deadline of its own — it resolves when
// the tournament completes and is refunded when it is cancelled. Infinity
// keeps the NOT NULL column happy while making the expiry scheduler never
// pick the market up; the API reports closes_at = null for the type.
func createMarketTx(ctx context.Context, q *db.Queries, params CreateMarketParams) (db.Market, error) {
	handler, ok := marketTypeHandlers[params.MarketType]
	if !ok {
		return db.Market{}, fmt.Errorf("unknown market_type: %s", params.MarketType)
	}
	closesAt := pgtype.Timestamptz{Time: params.ClosesAt, Valid: true}
	if params.MarketType == "tournament_winner" {
		closesAt = pgtype.Timestamptz{InfinityModifier: pgtype.Infinity, Valid: true}
	}

	// The owning tenant must exist (ADR-36): the market settles into its main
	// arena. A missing tenant maps to the handler's 404.
	if _, err := q.GetTenantByID(ctx, params.TenantID); err != nil {
		return db.Market{}, fmt.Errorf("get tenant: %w", err)
	}

	market, err := q.CreateMarket(ctx, db.CreateMarketParams{
		ID:         params.ID,
		TenantID:   params.TenantID,
		MarketType: params.MarketType,
		StartsAt:   pgtype.Timestamptz{Time: params.StartsAt, Valid: true},
		ClosesAt:   closesAt,
		CreatedBy:  params.CreatedBy,
		LiquidityB: 0,
	})
	if err != nil {
		return db.Market{}, fmt.Errorf("insert market: %w", err)
	}

	if err := handler.CreateParams(ctx, q, market.ID, params); err != nil {
		return db.Market{}, fmt.Errorf("create %s params: %w", params.MarketType, err)
	}
	return market, nil
}
