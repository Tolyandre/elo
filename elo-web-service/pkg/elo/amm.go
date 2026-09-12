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
// bounded by b · ln(n) per market with n outcomes. Since guarantees became
// voluntary (ADR-20), b is dynamic — b = min(max_guarantor_loss, Σ risk)/ln(n)
// — and grows as guarantor wagers arrive. A market with no guarantors yet has
// b = 0: bets are rejected and prices display the uniform 1/n vector (the exact
// q=0 limit of the LMSR). Raising b while rescaling q ← q·(b_new/b_old)
// preserves all probabilities (the cost function scales by b_new/b_old, and
// settlement never reads it), so liquidity can be injected mid-market without
// moving prices.
//
// Guarantors charge a maker fee c (the risk-weighted mean of their wager fee
// rates, capped at 0.25 each). The buyer's marginal price becomes
//
//	p_u = p + 4c·p·(1−p)
//
// — a variance-proportional fee (the schedule Kalshi uses in production): the
// surcharge peaks at c for p = 0.5 and vanishes at p → 0/1, and c ≤ 0.25 keeps
// p_u ≤ 1. Because a buy moves only one q component, the total fee for buying
// s shares has the closed form 4c·b·Δp_i (amm.BuyFeeN).

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
// A market without guarantors (b = 0) has not traded yet, so its q is provably
// the zero vector and the exact limit prices are uniform 1/n — returned so
// callers can display an "awaiting guarantors" market sensibly.
// Exported for the API layer.
func MarginalProbabilitiesN(q []float64, b float64) []float64 {
	probabilities := make([]float64, len(q))
	if len(q) == 0 {
		return probabilities
	}
	if b <= 0 {
		for i := range probabilities {
			probabilities[i] = 1 / float64(len(q))
		}
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

// BuyFeeN returns the maker fee charged for buying `shares` of outcome i at
// fee rate c (the market's risk-weighted mean of guarantor fee rates). The
// buyer's marginal price is p_u = p + 4c·p(1−p); since a buy moves only q_i and
// dp_i/dq_i = p_i(1−p_i)/b along that path, integrating the surcharge over the
// buy gives the closed form fee = 4c·b·(p_i(q + shares·e_i) − p_i(q)) for any
// number of outcomes. Zero for non-positive shares, b or c.
func BuyFeeN(q []float64, b float64, i int, shares float64, feeRate float64) float64 {
	if len(q) == 0 || i < 0 || i >= len(q) || shares <= 0 || b <= 0 || feeRate <= 0 {
		return 0
	}
	before := MarginalProbabilitiesN(q, b)[i]
	after := append([]float64(nil), q...)
	after[i] += shares
	afterP := MarginalProbabilitiesN(after, b)[i]
	return 4 * feeRate * b * (afterP - before)
}

// PriceWithFee returns the buyer's marginal price including the maker fee:
// p_u = p + 4c·p(1−p). c ≤ 0.25 guarantees p_u ≤ 1 (binding only as p → 1).
func PriceWithFee(p, feeRate float64) float64 {
	return p + 4*feeRate*p*(1-p)
}
