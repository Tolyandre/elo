package elo

import (
	"context"

	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// MarketProbabilityHistory reconstructs the market's per-outcome probability
// series by replaying its timeline (bets + guarantee joins) through the LMSR
// from the creation state q=0, b=0. No probabilities are persisted — see
// price_history.go.
func MarketProbabilityHistory(ctx context.Context, q *db.Queries, marketID id.ID) ([]ProbabilityPoint, error) {
	market, err := q.GetMarket(ctx, marketID)
	if err != nil {
		return nil, err
	}
	outcomes, err := q.ListMarketOutcomes(ctx, marketID)
	if err != nil {
		return nil, err
	}
	betRows, err := q.GetMarketBetsForPriceHistory(ctx, marketID)
	if err != nil {
		return nil, err
	}
	wagerRows, err := q.ListMarketGuaranteeWagers(ctx, marketID)
	if err != nil {
		return nil, err
	}
	outcomeIDs := make([]id.ID, len(outcomes))
	for i, o := range outcomes {
		outcomeIDs[i] = o.ID
	}
	bets := make([]PriceBet, len(betRows))
	for i, r := range betRows {
		bets[i] = PriceBet{Outcome: r.Outcome, Shares: r.Shares, PlacedAt: r.PlacedAt.Time}
	}
	// Both streams arrive ordered (placed_at, id) / (created_at, id); the merge
	// fixes the cross-stream order ProbabilityHistory expects.
	events := mergeTimeline(bets, guaranteeWagersFromDB(wagerRows))
	return ProbabilityHistory(events, outcomeIDs, market.MaxGuarantorLoss), nil
}
