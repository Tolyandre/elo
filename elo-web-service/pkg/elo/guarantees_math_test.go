package elo

import (
	"math"
	"testing"
)

// --- AMM fee math ------------------------------------------------------------

func TestPriceWithFeeBounded(t *testing.T) {
	// c ≤ 0.25 keeps p_u = p + 4c·p(1−p) within [0,1]; the bound binds exactly
	// at c = 0.25 as p → 1.
	for pi := 0; pi <= 100; pi++ {
		p := float64(pi) / 100
		for ci := 0; ci <= 25; ci++ {
			c := float64(ci) / 100
			pu := PriceWithFee(p, c)
			if pu < 0 || pu > 1+1e-12 {
				t.Fatalf("p_u out of [0,1]: p=%v c=%v p_u=%v", p, c, pu)
			}
		}
	}
	// The surcharge peaks at p = 0.5 where it equals c exactly.
	if pu := PriceWithFee(0.5, 0.05); !approxEq(pu, 0.55) {
		t.Errorf("5%% fee at p=0.5 must cost exactly 0.05 extra, got %v", pu-0.5)
	}
	// At c = 0.25 and p = 0.9 the price stays below 1 (0.99).
	if pu := PriceWithFee(0.9, 0.25); !approxEq(pu, 0.99) {
		t.Errorf("c=0.25 at p=0.9 must give p_u=0.99, got %v", pu)
	}
}

func TestBuyFeeNMatchesNumericIntegral(t *testing.T) {
	// fee = 4c·b·Δp is the closed form of ∫ 4c·p_i(1−p_i) dq_i along a buy
	// (only q_i moves). Compare against a fine numeric integration for several
	// shapes, including n > 2.
	cases := []struct {
		q        []float64
		b, c     float64
		i        int
		shares   float64
		specials []float64 // extra fee rates to check in one pass
	}{
		{q: []float64{0, 0}, b: 23.1, c: 0.05, i: 0, shares: 1},
		{q: []float64{10, 4}, b: 14.6, c: 0.25, i: 1, shares: 7},
		{q: []float64{3, 0, 9}, b: 30, c: 0.12, i: 2, shares: 5},
		{q: []float64{0, 0, 0, 0}, b: 40, c: 0.10, i: 3, shares: 20},
	}
	for _, tc := range cases {
		fee := BuyFeeN(tc.q, tc.b, tc.i, tc.shares, tc.c)
		// Numeric integral: dq steps of shares/200000.
		const steps = 200000
		dq := tc.shares / steps
		num := 0.0
		qq := append([]float64(nil), tc.q...)
		for s := 0; s < steps; s++ {
			p := MarginalProbabilitiesN(qq, tc.b)[tc.i]
			num += 4 * tc.c * p * (1 - p) * dq
			qq[tc.i] += dq
		}
		if math.Abs(fee-num) > 1e-6 {
			t.Errorf("closed form %v != numeric %v (case %v, b=%v, c=%v)", fee, num, tc.q, tc.b, tc.c)
		}
	}
	// Zero fee rate and zero liquidity give zero fee.
	if f := BuyFeeN([]float64{0, 0}, 23, 0, 1, 0); f != 0 {
		t.Errorf("c=0 must charge nothing, got %v", f)
	}
	if f := BuyFeeN([]float64{0, 0}, 0, 0, 1, 0.1); f != 0 {
		t.Errorf("b=0 must charge nothing, got %v", f)
	}
}

func TestMarginalProbabilitiesUniformWithoutLiquidity(t *testing.T) {
	// A market awaiting its first guarantor displays the exact q=0 limit:
	// the uniform vector.
	p := MarginalProbabilitiesN([]float64{0, 0, 0}, 0)
	for i, v := range p {
		if !approxEq(v, 1.0/3) {
			t.Errorf("b=0 must display uniform 1/n, p[%d]=%v", i, v)
		}
	}
}

// --- fee rate / liquidity mapping ---------------------------------------------

func TestMarketFeeRateWeightedMean(t *testing.T) {
	wagers := []GuaranteeWager{
		{RiskAmount: 3, FeeRate: 0.10},
		{RiskAmount: 1, FeeRate: 0.00},
	}
	// (0.10·3 + 0·1)/(3+1) = 0.075 — risk-weighted, so big zero-fee wagers
	// pull the market fee down.
	if c := MarketFeeRate(wagers); !approxEq(c, 0.075) {
		t.Errorf("weighted mean fee = %v, want 0.075", c)
	}
	if c := MarketFeeRate(nil); c != 0 {
		t.Errorf("no wagers must give fee 0, got %v", c)
	}
}

func TestLiquidityBForRiskCapsAtMaxLoss(t *testing.T) {
	// Honest risk: b = min(L, Σrisk)/ln(n); Σrisk past L adds no liquidity.
	if b := liquidityBForRisk(16, 8, 2); !approxEq(b, 8/math.Ln2) {
		t.Errorf("b(Σr=8, L=16, n=2) = %v, want 8/ln2", b)
	}
	if b := liquidityBForRisk(16, 40, 2); !approxEq(b, 16/math.Ln2) {
		t.Errorf("b(Σr=40, L=16, n=2) = %v, want 16/ln2 (capped)", b)
	}
	if b := liquidityBForRisk(16, 0, 2); b != 0 {
		t.Errorf("no risk must give b=0, got %v", b)
	}
}

// --- cappedProportional ---------------------------------------------------------

func TestCappedProportional(t *testing.T) {
	// No caps binding: plain proportional split summing exactly.
	alloc := cappedProportional(10, []float64{1, 3}, []float64{100, 100})
	if !approxEq(alloc[0], 2.5) || !approxEq(alloc[1], 7.5) || !approxEq(alloc[0]+alloc[1], 10) {
		t.Errorf("plain split: %v", alloc)
	}
	// One cap binds: weight 6 over capacity 5 gets fixed at 5, the rest (5)
	// goes to the other wager.
	alloc = cappedProportional(10, []float64{6, 6}, []float64{5, 100})
	if !approxEq(alloc[0], 5) || !approxEq(alloc[1], 5) || !approxEq(alloc[0]+alloc[1], 10) {
		t.Errorf("single cap: %v", alloc)
	}
	// Several water-filling rounds: caps 3, 4 bind in sequence.
	alloc = cappedProportional(15, []float64{5, 5, 5}, []float64{3, 4, 100})
	if !approxEq(alloc[0], 3) || !approxEq(alloc[1], 4) || !approxEq(alloc[2], 8) || !approxEq(alloc[0]+alloc[1]+alloc[2], 15) {
		t.Errorf("multi-round water-filling: %v", alloc)
	}
	// Zero-weight wagers never receive anything even with capacity.
	alloc = cappedProportional(10, []float64{0, 2}, []float64{100, 100})
	if alloc[0] != 0 || !approxEq(alloc[1], 10) {
		t.Errorf("zero weight must not allocate: %v", alloc)
	}
}
