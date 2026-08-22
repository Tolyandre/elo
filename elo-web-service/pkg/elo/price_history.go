package elo

import "time"

// This file reconstructs a market's price history by replaying its bets
// through the LMSR. Because a market's liquidity_b is fixed at creation and
// every bet shifts the AMM state vector by exactly its shares on one outcome,
// replaying the bet stream in (placed_at, id) order from the creation state
// q=0 reproduces the marginal price of every outcome after every buy. No
// prices are persisted — the series is derived from bets alone.

// PriceBet is one replay step: the shares bought on an outcome and when.
type PriceBet struct {
	Outcome  string
	Shares   float64
	PlacedAt time.Time
}

// OutcomePrice is the marginal price of one outcome at a point in time.
type OutcomePrice struct {
	OutcomeID string
	Price     float64
}

// PricePoint is the reconstructed price vector right after a bet: the
// marginal price of every outcome, summing to 1.
type PricePoint struct {
	PlacedAt time.Time
	Prices   []OutcomePrice
}

// PriceHistory replays `bets` (they must already be ordered by placed_at, id)
// from the creation state q=0 and returns the price vector after each bet.
// outcomeIDs fixes the vector layout (and its length); bets on unknown
// outcomes are skipped (defensive — the FK guarantees they reference real
// outcome rows of this market). Returns an empty slice for a bet-less market.
func PriceHistory(bets []PriceBet, outcomeIDs []string, liquidityB float64) []PricePoint {
	index := make(map[string]int, len(outcomeIDs))
	for i, id := range outcomeIDs {
		index[id] = i
	}
	q := make([]float64, len(outcomeIDs))
	points := make([]PricePoint, 0, len(bets))
	for _, bet := range bets {
		i, ok := index[bet.Outcome]
		if !ok || bet.Shares <= 0 {
			continue // defensive: replayed shares are always positive
		}
		q[i] += bet.Shares
		prices := MarginalPricesN(q, liquidityB)
		pp := PricePoint{PlacedAt: bet.PlacedAt, Prices: make([]OutcomePrice, len(outcomeIDs))}
		for j, id := range outcomeIDs {
			pp.Prices[j] = OutcomePrice{OutcomeID: id, Price: prices[j]}
		}
		points = append(points, pp)
	}
	return points
}
