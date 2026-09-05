package elo

import "math"

// This file implements an n-outcome LMSR (Logarithmic Market Scoring Rule)
// automatic market maker — the Polymarket-style pricing engine for share
// markets. Each of the market's mutually-exclusive outcomes has a live
// probability in (0,1); a purchase is shares-driven: the buyer asks for
// `shares` tokens of an outcome and pays the AMM cost. At resolution every
// winning share pays 1.
//
// Math (outcomes 0..n-1, liquidity parameter b > 0, outstanding shares vector
// q with q_i shares of outcome i):
//
//	C(q)            = b · ln(Σ_i e^(q_i/b))             // market cost
//	probability_i   = e^(q_i/b) / Σ_j e^(q_j/b)         // Σ_i probability_i = 1
//
// Buying `shares` of outcome i shifts q_i by exactly `shares` and costs
// amount = C(q + shares·e_i) − C(q), computed directly (no inversion).
// Probability and cost are distinct quantities: the probability is what the
// charts show and what moves with every purchase, while the buyer pays the
// cost amount (per share: amount/shares) — equal to the probability only in
// the infinitesimal limit, and noticeably above it for small liquidity b.
//
// A binary market is the n=2 special case, so the historical q_yes/q_no state
// maps onto the first two vector components.
//
// Guarantors are the zero-sum counterparty: their combined worst-case loss is
// bounded by b · ln(n) per market with n outcomes.

// ammCostN returns the LMSR market cost C(q) = b·ln(Σ e^(q_i/b)).
// Uses log-sum-exp stabilization so large q/b cannot overflow.
func ammCostN(q []float64, b float64) float64 {
	if len(q) == 0 || b <= 0 {
		return 0
	}
	m := q[0] / b
	for _, qi := range q[1:] {
		if v := qi / b; v > m {
			m = v
		}
	}
	sum := 0.0
	for _, qi := range q {
		sum += math.Exp(qi/b - m)
	}
	return b * (m + math.Log(sum))
}

// buyCostN returns the elo cost of buying `shares` of outcome i at the current
// q: C(q + shares·e_i) − C(q).
func buyCostN(q []float64, b float64, i int, shares float64) float64 {
	after := append([]float64(nil), q...)
	if i < 0 || i >= len(after) {
		return 0
	}
	after[i] += shares
	return ammCostN(after, b) - ammCostN(q, b)
}

// MarginalProbabilitiesN returns the live probabilities of all outcomes in
// (0,1), derived from the market's current LMSR state. They sum to 1.
// Exported for the API layer.
func MarginalProbabilitiesN(q []float64, b float64) []float64 {
	probabilities := make([]float64, len(q))
	if len(q) == 0 || b <= 0 {
		return probabilities
	}
	m := q[0] / b
	for _, qi := range q[1:] {
		if v := qi / b; v > m {
			m = v
		}
	}
	denom := 0.0
	exp := make([]float64, len(q))
	for i, qi := range q {
		exp[i] = math.Exp(qi/b - m)
		denom += exp[i]
	}
	if denom == 0 {
		return probabilities
	}
	for i := range q {
		probabilities[i] = exp[i] / denom
	}
	return probabilities
}

// ApplyBetN is the single buy primitive: given the current AMM state and the
// `shares` to buy on outcome i, it returns the updated q vector (a copy; the
// input is not mutated) and the elo `amount` the purchase costs:
// amount = C(q + shares·e_i) − C(q).
//
// Returns a zero amount for non-positive shares or non-positive b (callers
// must validate liquidity at market creation). The caller persists the bet
// with amount (= elo spent) + shares and writes the new q_i back onto the
// outcome row.
func ApplyBetN(q []float64, b float64, i int, shares float64) ([]float64, float64) {
	if len(q) == 0 || i < 0 || i >= len(q) || shares <= 0 || b <= 0 {
		return append([]float64(nil), q...), 0
	}
	newQ := append([]float64(nil), q...)
	newQ[i] += shares
	return newQ, buyCostN(q, b, i, shares)
}
