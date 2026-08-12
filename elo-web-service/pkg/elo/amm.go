package elo

import "math"

// This file implements a binary-outcome LMSR (Logarithmic Market Scoring Rule)
// automatic market maker — the Polymarket-style pricing engine for share markets.
// Each outcome has a live price in (0,1); a purchase is shares-driven: the buyer
// asks for `shares` tokens of an outcome and pays the AMM cost. At resolution
// every winning share pays 1.
//
// Math (outcome ∈ {yes, no}, liquidity parameter b > 0, outstanding shares q_yes/q_no):
//
//	C(q_yes, q_no) = b · ln(e^(q_yes/b) + e^(q_no/b))           // market cost
//	price_i        = e^(q_i/b) / (e^(q_yes/b) + e^(q_no/b))     // p_yes + p_no = 1
//
// Buying `shares` of outcome i shifts q_i by exactly `shares` and costs
// amount = C(q_i+shares, q_k) − C(q_i, q_k), computed directly (no inversion).
// The displayed price is the marginal price_i (it moves with every purchase);
// the buyer's effective price is amount/shares.
//
// Guarantors are the zero-sum counterparty: their combined worst-case loss is
// bounded by b · ln(2) per market.

// ammPrice returns the instantaneous price (probability) of `outcome` in (0,1).
// Uses the log-sum-exp / softmax stabilization so large q/b cannot overflow.
func ammPrice(qYes, qNo, b float64, outcome string) float64 {
	uy := qYes / b
	un := qNo / b
	m := math.Max(uy, un)
	ey := math.Exp(uy - m)
	en := math.Exp(un - m)
	denom := ey + en
	if outcome == "yes" {
		return ey / denom
	}
	return en / denom
}

// ammCost returns the LMSR market cost C(q_yes, q_no).
func ammCost(qYes, qNo, b float64) float64 {
	uy := qYes / b
	un := qNo / b
	m := math.Max(uy, un)
	return b * (m + math.Log(math.Exp(uy-m)+math.Exp(un-m)))
}

// MarginalPrices returns the live (yes, no) outcome prices in (0,1) the UI shows
// for a market, derived from its current LMSR state. They sum to 1.
// Exported for the API layer.
func MarginalPrices(qYes, qNo, b float64) (yes, no float64) {
	return ammPrice(qYes, qNo, b, "yes"), ammPrice(qYes, qNo, b, "no")
}

// ammAmountForShares returns the elo cost of buying `shares` tokens on
// `outcome`, given current AMM state: amount = C(q_i+shares, q_k) − C(q_i, q_k).
//
// Returns 0 for non-positive shares or non-positive b (callers must validate
// liquidity at market creation).
func ammAmountForShares(qYes, qNo, b float64, outcome string, shares float64) float64 {
	if shares <= 0 || b <= 0 {
		return 0
	}
	var costAfter float64
	if outcome == "yes" {
		costAfter = ammCost(qYes+shares, qNo, b)
	} else {
		costAfter = ammCost(qYes, qNo+shares, b)
	}
	return costAfter - ammCost(qYes, qNo, b)
}

// ApplyBet is the single buy primitive: given current AMM state and the
// `shares` to buy on `outcome`, it returns the updated (q_yes, q_no) and the
// elo `amount` the purchase costs. The caller persists the bet with amount
// (= elo spent) + shares and writes the new q_yes/q_no back onto the market.
func ApplyBet(qYes, qNo, b float64, outcome string, shares float64) (newQYes, newQNo, amount float64) {
	amount = ammAmountForShares(qYes, qNo, b, outcome, shares)
	if outcome == "yes" {
		newQYes = qYes + shares
		newQNo = qNo
	} else {
		newQYes = qYes
		newQNo = qNo + shares
	}
	return newQYes, newQNo, amount
}
