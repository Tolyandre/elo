package elo

import (
	"math"
	"testing"
)

const floatEq = 1e-9

func approxEq(a, b float64) bool { return math.Abs(a-b) < floatEq }

func TestAMMPriceSumsToOne(t *testing.T) {
	cases := []struct{ qY, qN, b float64 }{
		{0, 0, 100},
		{50, 10, 100},
		{10, 50, 100},
		{300, 0, 100},
		{0, 300, 100},
		{123.4, 567.8, 50},
	}
	for _, c := range cases {
		py, pn := MarginalPrices(c.qY, c.qN, c.b)
		if !approxEq(py+pn, 1.0) {
			t.Errorf("prices don't sum to 1: qY=%v qN=%v b=%v → %v+%v=%v", c.qY, c.qN, c.b, py, pn, py+pn)
		}
	}
}

func TestAMMSymmetricStartIsFiftyFifty(t *testing.T) {
	// q_yes == q_no ⇒ equal prices 0.5 / 0.5.
	py, pn := MarginalPrices(0, 0, 100)
	if !approxEq(py, 0.5) || !approxEq(pn, 0.5) {
		t.Fatalf("expected 0.5/0.5 prices at symmetric start, got %v/%v", py, pn)
	}
}

func TestAMMBuyingMovesPriceTowardBoughtSide(t *testing.T) {
	qY, qN, b := 0.0, 0.0, 100.0
	// Buy 10 YES shares → p_yes must rise; effective price (amount/shares) > 0.5
	// (slippage).
	newQY, _, amount := ApplyBet(qY, qN, b, "yes", 10)
	pBefore, _ := MarginalPrices(qY, qN, b)
	pAfter, _ := MarginalPrices(newQY, qN, b)
	if !(pAfter > pBefore) {
		t.Errorf("buying YES did not raise p_yes: %v → %v", pBefore, pAfter)
	}
	if amount <= 0 {
		t.Fatalf("amount must be positive, got %v", amount)
	}
	if eff := amount / 10; eff <= 0.5 {
		t.Errorf("effective price %v should be > 0.5 (slippage), amount=%v", eff, amount)
	}
}

func TestAMMAmountForSharesMatchesCostDelta(t *testing.T) {
	// The quoted amount must satisfy C(q_i+s) - C(q_i) == amount.
	for _, tc := range []struct {
		qY, qN, b, shares float64
		outcome           string
	}{
		{0, 0, 100, 1, "yes"},
		{0, 0, 100, 1, "no"},
		{0, 0, 100, 10, "yes"},
		{40, 15, 100, 3, "yes"},
		{15, 40, 100, 3, "no"},
		{0, 0, 50, 5, "yes"},
	} {
		a := ammAmountForShares(tc.qY, tc.qN, tc.b, tc.outcome, tc.shares)
		costBefore := ammCost(tc.qY, tc.qN, tc.b)
		var costAfter float64
		if tc.outcome == "yes" {
			costAfter = ammCost(tc.qY+tc.shares, tc.qN, tc.b)
		} else {
			costAfter = ammCost(tc.qY, tc.qN+tc.shares, tc.b)
		}
		if !approxEq(costAfter-costBefore, a) {
			t.Errorf("cost mismatch for %+v: ΔC=%v want %v", tc, costAfter-costBefore, a)
		}
	}
}

func TestAMMEffectivePriceGeMarginal(t *testing.T) {
	// A finite buy's effective price (amount/shares, incl. slippage) is ≥ the
	// marginal price quoted just before the buy.
	qY, qN, b := 0.0, 0.0, 100.0
	marginal, _ := MarginalPrices(qY, qN, b)
	_, _, amount := ApplyBet(qY, qN, b, "yes", 5)
	eff := amount / 5
	if eff < marginal-floatEq {
		t.Errorf("effective price %v must be ≥ marginal %v", eff, marginal)
	}
}

func TestAMMSymmetryYesNo(t *testing.T) {
	// From a symmetric state, buying YES and buying NO with the same shares must
	// cost the same amount.
	_, _, aY := ApplyBet(0, 0, 100, "yes", 20)
	_, _, aN := ApplyBet(0, 0, 100, "no", 20)
	if !approxEq(aY, aN) {
		t.Errorf("amounts differ: yes=%v no=%v", aY, aN)
	}
}

func TestAMMZeroSharesIsZero(t *testing.T) {
	if a := ammAmountForShares(0, 0, 100, "yes", 0); a != 0 {
		t.Errorf("zero shares must cost zero, got %v", a)
	}
	nY, nN, a := ApplyBet(10, 20, 100, "yes", 0)
	if a != 0 || nY != 10 || nN != 20 {
		t.Errorf("zero-shares ApplyBet must be a no-op: nY=%v nN=%v a=%v", nY, nN, a)
	}
}
