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
			prices := MarginalPricesN(q, b)
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
		prices := MarginalPricesN(q, 100)
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
	prices := MarginalPricesN([]float64{qY, qN}, b)
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
	pricesBefore := MarginalPricesN(q, b)
	pricesAfter := MarginalPricesN(newQ, b)
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
	prices := MarginalPricesN(q, 16)
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
