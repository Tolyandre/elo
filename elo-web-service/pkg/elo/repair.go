package elo

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/id"
)

// One-time repair for markets touched by the removed price-preserving q
// rescale (ADR-20 as originally written; removed in ADR-22). Rescaling q by
// b_new/b_old multiplied the AMM's cost function while the collected elo and
// the bet rows' shares stayed unscaled, so the b·ln(n) ≤ Σrisk solvency bound
// broke: post-rescale underdog buys were priced near 0 and could amass
// payouts far beyond the guarantors' risk.
//
// The invariant q = Σ bets.shares always holds without rescales, so the
// divergence detects every affected market. Repair (idempotent, runs at
// startup before serving):
//
//  1. recompute every outcome's q from its stored bets;
//  2. keep live markets whose repaired state is still solvent
//     (max_i Q_i − collected ≤ effective risk — the bound that the AMM
//     maintains from now on) — they resume trading at honestly repriced
//     probabilities;
//  3. cancel the rest: the post-rescale bets' shares are liabilities the
//     backing cannot cover, and honouring them at settlement would create elo
//     from nothing. Cancelling refunds every bet (cost + fee), so all
//     participants are made whole.
func (s *MarketService) RepairRescaledMarkets(ctx context.Context) error {
	affected, err := s.Queries.ListMarketsWithDivergedQ(ctx)
	if err != nil {
		return fmt.Errorf("list markets with diverged q: %w", err)
	}
	if len(affected) == 0 {
		return nil
	}
	log.Printf("repairing %d market(s) affected by the removed q rescale", len(affected))

	if err := s.Queries.RecomputeOutcomeQFromBets(ctx); err != nil {
		return fmt.Errorf("recompute amm state from bets: %w", err)
	}

	for _, marketID := range affected {
		cancelled, err := s.cancelMarketIfInsolvent(ctx, marketID)
		if err != nil {
			return fmt.Errorf("repair market %s: %w", marketID, err)
		}
		if cancelled {
			log.Printf("market %s cancelled: rescaled-state bets exceed the guarantors' coverage, all bets refunded", marketID)
		}
	}

	if s.Hub != nil {
		s.Hub.PublishSignal(TopicLobbyMarkets, "markets-changed")
	}
	return nil
}

// cancelMarketIfInsolvent cancels the market (refunding every bet) when its
// repaired state can no longer be covered: max_i Q_i − collected above the
// effective guarantor risk means some outcome's outstanding shares would pay
// more than the collected elo plus the guarantors' worst case. Healthy
// markets are left open. Idempotent: settlement only happens once (the second
// run sees a resolved/cancelled market and skips it).
func (s *MarketService) cancelMarketIfInsolvent(ctx context.Context, marketID id.ID) (bool, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	q := s.Queries.WithTx(tx)

	// Serialize against concurrent bets (PlaceBet locks the same row): a bet
	// that slips in before the commit is refunded by the cancellation below;
	// one after it is rejected by the status check.
	if err := q.LockMarket(ctx, marketID); err != nil {
		return false, fmt.Errorf("lock market: %w", err)
	}
	market, err := q.GetMarket(ctx, marketID)
	if err != nil {
		return false, fmt.Errorf("get market: %w", err)
	}
	if market.Status != "open" && market.Status != "betting_closed" {
		return false, nil // settled meanwhile — nothing to repair
	}

	outcomes, err := q.ListMarketOutcomesWithPools(ctx, marketID)
	if err != nil {
		return false, fmt.Errorf("list market outcomes: %w", err)
	}
	bets, err := q.GetBetsForSettlement(ctx, marketID)
	if err != nil {
		return false, fmt.Errorf("get bets: %w", err)
	}
	collected := 0.0
	for _, b := range bets {
		collected += b.Cost + b.Fee
	}
	maxQ := 0.0
	for _, o := range outcomes {
		if o.Q > maxQ {
			maxQ = o.Q
		}
	}
	wagerRows, err := q.ListMarketGuaranteeWagers(ctx, marketID)
	if err != nil {
		return false, fmt.Errorf("list guarantee wagers: %w", err)
	}
	effective := market.MaxGuarantorLoss
	totalRisk := 0.0
	for _, w := range wagerRows {
		totalRisk += w.RiskAmount
	}
	if totalRisk < effective {
		effective = totalRisk
	}

	// The exact bound the AMM maintains on its own from now on (ADR-22).
	if maxQ-collected <= effective*(1+1e-9)+1e-9 {
		return false, nil
	}

	if err := s.SettleMarket(ctx, q, marketID, OutcomeCancelled, time.Now(), nil); err != nil {
		return false, fmt.Errorf("settle cancelled: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit tx: %w", err)
	}
	return true, nil
}
