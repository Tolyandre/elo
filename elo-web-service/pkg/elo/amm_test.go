package elo

import (
	"math"
	"testing"
)

const floatEq = 1e-9

func approxEq(a, b float64) bool { return math.Abs(a-b) < floatEq }

func sum(q []float64) float64 {
	s := 0.0
	for _, v := range q {
		s += v
	}
	return s
}

func TestAMMPricesSumToOne(t *testing.T) {
	cases := [][]float64{
		{0, 0},
		{50, 10},
		{10, 50},
		{300, 0},
		{0, 300},
		{123.4, 567.8},
		{1, 2, 3, 4, 5},
		{0, 0, 0, 0, 500},
	}
	for _, q := range cases {
		for _, b := range []float64{100, 16, 4} {
			prices := MarginalProbabilitiesN(q, b)
			if len(prices) != len(q) {
				t.Fatalf("prices length %d, want %d", len(prices), len(q))
			}
			if !approxEq(sum(prices), 1.0) {
				t.Errorf("prices don't sum to 1: q=%v b=%v → sum=%v", q, b, sum(prices))
			}
		}
	}
}

func TestAMMSymmetricStartIsUniform(t *testing.T) {
	// All-equal q ⇒ equal prices 1/n.
	for _, n := range []int{2, 3, 5} {
		q := make([]float64, n)
		prices := MarginalProbabilitiesN(q, 100)
		for _, p := range prices {
			if !approxEq(p, 1.0/float64(n)) {
				t.Fatalf("expected uniform 1/%d prices at symmetric start, got %v", n, prices)
			}
		}
	}
}

func TestAMMBinaryMatchesLegacyYesNo(t *testing.T) {
	// The n=2 vector form must reproduce the historical binary LMSR exactly.
	qY, qN, b := 12.0, 7.0, 16.0
	legacy := func(outcome string) float64 {
		uy, un := qY/b, qN/b
		m := math.Max(uy, un)
		ey, en := math.Exp(uy-m), math.Exp(un-m)
		if outcome == "yes" {
			return ey / (ey + en)
		}
		return en / (ey + en)
	}
	prices := MarginalProbabilitiesN([]float64{qY, qN}, b)
	if !approxEq(prices[0], legacy("yes")) || !approxEq(prices[1], legacy("no")) {
		t.Fatalf("n=2 prices %v disagree with legacy yes/no (%v/%v)", prices, legacy("yes"), legacy("no"))
	}
}

func TestAMMBuyingMovesPriceTowardBoughtOutcome(t *testing.T) {
	q := []float64{0, 0, 0}
	b := 100.0
	// Buy 10 shares of outcome 1 → its price must rise; effective price
	// (amount/shares) > marginal 1/3 (slippage).
	newQ, amount := ApplyBetN(q, b, 1, 10)
	pricesBefore := MarginalProbabilitiesN(q, b)
	pricesAfter := MarginalProbabilitiesN(newQ, b)
	if !(pricesAfter[1] > pricesBefore[1]) {
		t.Errorf("buying outcome 1 did not raise its price: %v → %v", pricesBefore[1], pricesAfter[1])
	}
	if amount <= 0 {
		t.Fatalf("amount must be positive, got %v", amount)
	}
	if eff := amount / 10; eff <= pricesBefore[1] {
		t.Errorf("effective price %v should exceed the pre-trade marginal %v", eff, pricesBefore[1])
	}
	// Other outcomes get cheaper (probability mass moved away).
	if !(pricesAfter[0] < pricesBefore[0]) {
		t.Errorf("buying outcome 1 should lower outcome 0's price: %v → %v", pricesBefore[0], pricesAfter[0])
	}
}

func TestAMMAmountMatchesCostDelta(t *testing.T) {
	// The quoted amount must satisfy C(q + shares·e_i) − C(q) == amount.
	for _, tc := range []struct {
		q      []float64
		b      float64
		i      int
		shares float64
	}{
		{[]float64{0, 0}, 100, 0, 1},
		{[]float64{0, 0}, 100, 1, 1},
		{[]float64{0, 0, 0, 0}, 100, 2, 10},
		{[]float64{40, 15, 3}, 100, 0, 3},
		{[]float64{15, 40, 3}, 100, 1, 3},
		{[]float64{0, 0}, 50, 0, 5},
	} {
		newQ, amount := ApplyBetN(tc.q, tc.b, tc.i, tc.shares)
		want := ammCostN(newQ, tc.b) - ammCostN(tc.q, tc.b)
		if !approxEq(want, amount) {
			t.Errorf("cost mismatch for %+v: ΔC=%v want %v", tc, want, amount)
		}
		if !approxEq(newQ[tc.i], tc.q[tc.i]+tc.shares) {
			t.Errorf("q_i not shifted by shares: %v", newQ)
		}
	}
}

func TestAMMInputNotMutated(t *testing.T) {
	q := []float64{1, 2, 3}
	newQ, _ := ApplyBetN(q, 16, 0, 5)
	if !approxEq(q[0], 1) || !approxEq(newQ[0], 6) {
		t.Fatalf("ApplyBetN must not mutate its input: q=%v newQ=%v", q, newQ)
	}
}

func TestAMMSymmetryAcrossOutcomes(t *testing.T) {
	// From a symmetric state, buying the same shares on any outcome must cost
	// the same amount.
	q := []float64{0, 0, 0, 0}
	amounts := make([]float64, len(q))
	for i := range q {
		_, amounts[i] = ApplyBetN(q, 100, i, 20)
	}
	for i := 1; i < len(amounts); i++ {
		if !approxEq(amounts[0], amounts[i]) {
			t.Fatalf("amounts differ across outcomes: %v", amounts)
		}
	}
}

func TestAMMLargeStateStaysStable(t *testing.T) {
	// Extreme one-sided states must stay in (0,1) thanks to log-sum-exp
	// stabilization.
	q := []float64{0, 500, 0}
	prices := MarginalProbabilitiesN(q, 16)
	for i, p := range prices {
		if p <= 0 || p >= 1 || math.IsNaN(p) {
			t.Fatalf("price[%d] = %v, want ∈ (0,1)", i, p)
		}
	}
	if !approxEq(prices[1], 1.0-1e-12) && prices[1] <= 0.999999999999 {
		t.Fatalf("dominant outcome price should approach 1: %v", prices[1])
	}
}

func TestAMMZeroSharesIsZero(t *testing.T) {
	q := []float64{10, 20, 30}
	newQ, amount := ApplyBetN(q, 100, 1, 0)
	if amount != 0 || !approxEq(sum(newQ), sum(q)) {
		t.Fatalf("zero-shares ApplyBetN must be a no-op: newQ=%v a=%v", newQ, amount)
	}
}

// TestAMMSaturatedMarketCosts reproduces the dev-market failure (market
// Cf2zAhhjiGU9n1zyfD2JD): a sole guarantor risking 1 on a 3-outcome market
// (b = 1/ln 3) after 34 one-share buys of one outcome. The leader's
// probability rounds to exactly 1.0 in float64, and the old C(q+s·e_i)−C(q)
// difference cancelled the underdog cost (true value ~1e-16) to exactly 0,
// tripping the bets cost > 0 constraint.
func TestAMMSaturatedMarketCosts(t *testing.T) {
	b := liquidityBForRisk(16, 1, 3)
	q := []float64{34.000000000000014, 0, 0}

	p := MarginalProbabilitiesN(q, b)
	if p[0] != 1 {
		t.Fatalf("leader probability = %v, want the float64 saturation to exactly 1", p[0])
	}
	if p[1] <= 0 || p[2] <= 0 {
		t.Fatalf("underdog probabilities = %v/%v, want positive dust", p[1], p[2])
	}

	// The 1.00 leader still charges ~1 per share (a hair under, at float dust).
	if _, cost := ApplyBetN(q, b, 0, 1); !approxEq(cost, 1) || cost <= 0 {
		t.Fatalf("leader share cost = %v, want ~1", cost)
	}

	// The ~0.00 underdog charges its true dust cost — not the cancelled 0 —
	// and it matches the closed form b·log1p((e^{1/b}−1)·p_i).
	_, cost := ApplyBetN(q, b, 1, 1)
	if cost <= 0 || cost > 1e-15 {
		t.Fatalf("underdog share cost = %v, want the true cost in (0, 1e-15]", cost)
	}
	want := b * math.Log1p(math.Expm1(1/b)*p[1])
	if rel := math.Abs(cost-want) / want; rel > 1e-9 {
		t.Fatalf("underdog cost %v disagrees with closed form %v (rel %v)", cost, want, rel)
	}

	// A bulk underdog buy that crosses the leader stays on the ~1-per-share
	// band past the crossover (34 dust shares + the price walk above 0.5).
	if _, cost := ApplyBetN(q, b, 1, 40); cost <= 5 || cost >= 7 {
		t.Fatalf("40-share underdog buy cost = %v, want ~6 (crossover price walk)", cost)
	}
}

// TestAMMExtremeGapCostFloor: past a q gap of ~745·b even the stable
// formulation underflows to 0; the minBetCost floor keeps the cost positive
// so the bet row stays insertable.
func TestAMMExtremeGapCostFloor(t *testing.T) {
	if _, cost := ApplyBetN([]float64{0, 1000, 0}, 1, 0, 1); cost != minBetCost {
		t.Fatalf("underflowed underdog cost = %v, want the %v floor", cost, minBetCost)
	}
}

// TestAMMTinyLiquidity covers a guarantor risking 0.00001: b = 1e-5/ln 3, so
// one share moves q/b by ~110k — the market saturates after a single buy and
// e^{anything/b} is far past the exp overflow boundary. All costs must stay
// exact and positive.
func TestAMMTinyLiquidity(t *testing.T) {
	const risk = 0.00001
	b := liquidityBForRisk(16, risk, 3)
	if !approxEq(b, risk/math.Log(3)) {
		t.Fatalf("b = %v, want risk/ln 3", b)
	}

	// First share: b·ln((e^{1/b}+2)/3) = 1 − b·ln 3 once e^{−1/b} underflows.
	q0 := []float64{0, 0, 0}
	_, cost := ApplyBetN(q0, b, 0, 1)
	if !approxEq(cost, 1-b*math.Log(3)) {
		t.Fatalf("first share cost = %v, want 1 − b·ln3 = %v", cost, 1-b*math.Log(3))
	}

	// After it, prices are float64-exact [1, 0, 0] — the closed [0,1]
	// expected_probability interval keeps the market tradable.
	q1 := []float64{1, 0, 0}
	p := MarginalProbabilitiesN(q1, b)
	if p[0] != 1 || p[1] != 0 || p[2] != 0 {
		t.Fatalf("saturated prices = %v, want exactly [1, 0, 0]", p)
	}

	// The leader keeps charging exactly 1/share (the corrections e^{−1/b}
	// underflow to 0, so only b·(1/b) rounding remains).
	if _, cost := ApplyBetN(q1, b, 0, 1); !approxEq(cost, 1) {
		t.Fatalf("leader share cost = %v, want ~1", cost)
	}
	// The underdog share costs b·ln 2 — the doubled-leader log-ratio — far
	// above the dust floor and never zero.
	if _, cost := ApplyBetN(q1, b, 1, 1); !approxEq(cost, b*math.Log(2)) {
		t.Fatalf("underdog share cost = %v, want b·ln2 = %v", cost, b*math.Log(2))
	}
}
