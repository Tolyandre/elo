package elo

import "math"

// This file implements an n-outcome LMSR (Logarithmic Market Scoring Rule)
// automatic market maker — the Polymarket-style pricing engine for share
// markets. Each of the market's mutually-exclusive outcomes has a live price
// in (0,1); a purchase is shares-driven: the buyer asks for `shares` tokens of
// an outcome and pays the AMM cost. At resolution every winning share pays 1.
//
// Math (outcomes 0..n-1, liquidity parameter b > 0, outstanding shares vector
// q with q_i shares of outcome i):
//
//	C(q)     = b · ln(Σ_i e^(q_i/b))                    // market cost
//	price_i  = e^(q_i/b) / Σ_j e^(q_j/b)                // Σ_i price_i = 1
//
// Buying `shares` of outcome i shifts q_i by exactly `shares` and costs
// amount = C(q + shares·e_i) − C(q), computed directly (no inversion).
// The displayed price is the marginal price_i (it moves with every purchase);
// the buyer's effective price is amount/shares.
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

// ammPriceN returns the instantaneous price (probability) of outcome i in
// (0,1): e^(q_i/b) / Σ_j e^(q_j/b), log-sum-exp stabilized.
func ammPriceN(q []float64, b float64, i int) float64 {
	if len(q) == 0 || b <= 0 || i < 0 || i >= len(q) {
		return 0
	}
	m := q[0] / b
	for _, qi := range q[1:] {
		if v := qi / b; v > m {
			m = v
		}
	}
	denom := 0.0
	for _, qi := range q {
		denom += math.Exp(qi/b - m)
	}
	if denom == 0 {
		return 0
	}
	return math.Exp(q[i]/b-m) / denom
}

// MarginalPricesN returns the live prices of all outcomes in (0,1) the UI
// shows for a market, derived from its current LMSR state. They sum to 1.
// Exported for the API layer.
func MarginalPricesN(q []float64, b float64) []float64 {
	prices := make([]float64, len(q))
	if len(q) == 0 || b <= 0 {
		return prices
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
		return prices
	}
	for i := range q {
		prices[i] = exp[i] / denom
	}
	return prices
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
	return newQ, ammCostN(newQ, b) - ammCostN(q, b)
}
