package elo

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/db"
)

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
