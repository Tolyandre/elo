package elo

import "time"

// This file reconstructs a market's price history by replaying its bets
// through the LMSR. Because a market's liquidity_b is fixed at creation and
// every bet shifts the AMM state by exactly its shares, replaying the bet
// stream in (placed_at, id) order from the creation state q=(0,0) reproduces
// the marginal yes-price after every buy — including pre-LMSR markets whose
// shares were backfilled on startup (migrateMarketShares pins the outstanding
// shares so the same replay stays consistent).

// PriceBet is one replay step: the shares bought on an outcome and when.
type PriceBet struct {
	Outcome  string
	Shares   float64
	PlacedAt time.Time
}

// PricePoint is the reconstructed marginal yes-price right after a bet.
type PricePoint struct {
	PlacedAt time.Time
	YesPrice float64
}

// PriceHistory replays `bets` (they must already be ordered by placed_at, id)
// from the creation state q=(0,0) and returns the yes-price after each bet.
// Buying NO lowers the yes-price; equal yes/no share totals keep it at 0.5.
// Returns an empty slice for a bet-less market (no points to chart).
func PriceHistory(bets []PriceBet, liquidityB float64) []PricePoint {
	points := make([]PricePoint, 0, len(bets))
	qYes, qNo := 0.0, 0.0
	for _, bet := range bets {
		if bet.Shares <= 0 {
			continue // defensive: replayed shares are always positive
		}
		if bet.Outcome == "yes" {
			qYes += bet.Shares
		} else {
			qNo += bet.Shares
		}
		yesPrice, _ := MarginalPrices(qYes, qNo, liquidityB)
		points = append(points, PricePoint{PlacedAt: bet.PlacedAt, YesPrice: yesPrice})
	}
	return points
}
