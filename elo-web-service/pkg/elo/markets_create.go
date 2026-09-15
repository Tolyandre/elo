package elo

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

// defaultMarketMaxGuarantorLoss mirrors elo_settings.market_default_max_guarantor_loss
// (DEFAULT 16) and covers degenerate settings rows.
const defaultMarketMaxGuarantorLoss = 16

func (s *MarketService) CreateMarket(ctx context.Context, params CreateMarketParams) (db.Market, error) {
	handler, ok := marketTypeHandlers[params.MarketType]
	if !ok {
		return db.Market{}, fmt.Errorf("unknown market_type: %s", params.MarketType)
	}

	// The market is created without guarantors (ADR-20): liquidity_b starts at
	// 0 — the market is untradable until the first guarantee wager arrives.
	// MaxGuarantorLoss caps the combined risk the wagers can turn into
	// liquidity: b = min(L, Σrisk)/ln(n), so a guarantor's maximum loss is the
	// amount they risked. Use the caller's L, else the configured default.
	maxGuarantorLoss := params.MaxGuarantorLoss
	if maxGuarantorLoss <= 0 {
		settingsRow, err := s.Queries.GetEloSettingsForDate(ctx, pgtype.Timestamptz{Time: params.StartsAt, Valid: true})
		if err != nil {
			return db.Market{}, fmt.Errorf("get elo settings for default max guarantor loss: %w", err)
		}
		maxGuarantorLoss = settingsRow.MarketDefaultMaxGuarantorLoss
		if maxGuarantorLoss <= 0 {
			maxGuarantorLoss = defaultMarketMaxGuarantorLoss
		}
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return db.Market{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	q := s.Queries.WithTx(tx)

	market, err := q.CreateMarket(ctx, db.CreateMarketParams{
		ID:               params.ID,
		MarketType:       params.MarketType,
		StartsAt:         pgtype.Timestamptz{Time: params.StartsAt, Valid: true},
		ClosesAt:         pgtype.Timestamptz{Time: params.ClosesAt, Valid: true},
		CreatedBy:        params.CreatedBy,
		LiquidityB:       0,
		MaxGuarantorLoss: maxGuarantorLoss,
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

	if s.Hub != nil {
		s.Hub.PublishSignal(TopicLobbyMarkets, "markets-changed")
	}

	return market, nil
}
