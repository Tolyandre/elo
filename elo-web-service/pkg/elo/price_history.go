package elo

import (
	"time"

	"github.com/tolyandre/elo-web-service/pkg/id"
)

// This file reconstructs a market's probability history by replaying its bets
// through the LMSR. Because a market's liquidity_b is fixed at creation and
// every bet shifts the AMM state vector by exactly its shares on one outcome,
// replaying the bet stream in (placed_at, id) order from the creation state
// q=0 reproduces the probability of every outcome after every buy. No
// probabilities are persisted — the series is derived from bets alone.

// PriceBet is one replay step: the shares bought on an outcome and when.
type PriceBet struct {
	Outcome  id.ID
	Shares   float64
	PlacedAt time.Time
}

// OutcomeProbability is the probability (LMSR marginal price) of one outcome
// at a point in time.
type OutcomeProbability struct {
	OutcomeID   id.ID
	Probability float64
}

// ProbabilityPoint is the reconstructed probability vector right after a bet:
// the probability of every outcome, summing to 1.
type ProbabilityPoint struct {
	PlacedAt      time.Time
	Probabilities []OutcomeProbability
}

// ProbabilityHistory replays `bets` (they must already be ordered by placed_at, id)
// from the creation state q=0 and returns the probability vector after each bet.
// outcomeIDs fixes the vector layout (and its length); bets on unknown
// outcomes are skipped (defensive — the FK guarantees they reference real
// outcome rows of this market). Returns an empty slice for a bet-less market.
func ProbabilityHistory(bets []PriceBet, outcomeIDs []id.ID, liquidityB float64) []ProbabilityPoint {
	index := make(map[id.ID]int, len(outcomeIDs))
	for i, oid := range outcomeIDs {
		index[oid] = i
	}
	q := make([]float64, len(outcomeIDs))
	points := make([]ProbabilityPoint, 0, len(bets))
	for _, bet := range bets {
		i, ok := index[bet.Outcome]
		if !ok || bet.Shares <= 0 {
			continue // defensive: replayed shares are always positive
		}
		q[i] += bet.Shares
		probabilities := MarginalProbabilitiesN(q, liquidityB)
		pp := ProbabilityPoint{PlacedAt: bet.PlacedAt, Probabilities: make([]OutcomeProbability, len(outcomeIDs))}
		for j, oid := range outcomeIDs {
			pp.Probabilities[j] = OutcomeProbability{OutcomeID: oid, Probability: probabilities[j]}
		}
		points = append(points, pp)
	}
	return points
}
