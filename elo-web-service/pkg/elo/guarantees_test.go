package elo

import (
	"math"
	"testing"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/id"
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

// --- settleGuarantors -----------------------------------------------------------

func wagerAt(pid id.ID, risk, fee float64, at time.Time) GuaranteeWager {
	return GuaranteeWager{ID: id.ID(string(pid) + "-w"), PlayerID: pid, RiskAmount: risk, FeeRate: fee, CreatedAt: at}
}

func betAt(pid id.ID, fee float64, at time.Time) betRecord {
	return betRecord{PlayerID: pid, Fee: fee, PlacedAt: at}
}

var gBase = time.Date(2026, time.September, 1, 12, 0, 0, 0, time.UTC)

func TestSettleGuarantorsEqualZeroFeeMatchesLegacySplit(t *testing.T) {
	// The ADR-20 migration shape: equal risks, zero fees. The guarantor result
	// must reduce to the legacy equal split of the residual (replay safety for
	// pre-existing markets).
	wagers := []GuaranteeWager{
		wagerAt("p1", 8, 0, gBase),
		wagerAt("p2", 8, 0, gBase),
		wagerAt("p3", 8, 0, gBase),
	}
	shares := settleGuarantors(nil, wagers, 6) // surplus 6
	if len(shares) != 3 {
		t.Fatalf("expected 3 guarantors, got %d", len(shares))
	}
	for pid, s := range shares {
		if !approxEq(s, 2) {
			t.Errorf("equal zero-fee wagers must split the surplus equally: %s got %v", pid, s)
		}
	}
	shares = settleGuarantors(nil, wagers, -6) // deficit 6
	for pid, s := range shares {
		if !approxEq(s, -2) {
			t.Errorf("equal zero-fee wagers must split the deficit equally: %s got %v", pid, s)
		}
	}
}

func TestSettleGuarantorsFeePoolTimeWindow(t *testing.T) {
	// Two wagers: an early zero-fee one and a late 10% one. A bet fee charged
	// between the two joins belongs entirely to the early wager's window —
	// active weights are all zero (zero fee), so the fallback spreads it by
	// fee·risk over ALL wagers... but with only zero-fee active wagers the
	// fallback gives the late fee-charging wager everything, which is the
	// documented conservation fallback for timestamp inversions. The normal
	// case (bet after both joins) splits by fee·risk.
	early := wagerAt("p1", 4, 0, gBase)
	late := wagerAt("p2", 4, 0.10, gBase.Add(2*time.Hour))
	bets := []betRecord{
		betAt("buyer", 1.0, gBase.Add(3*time.Hour)), // after both: weights 0 vs 0.4
	}
	shares := settleGuarantors(bets, []GuaranteeWager{early, late}, 0)
	if !approxEq(shares["p2"], 1.0) || !approxEq(shares["p1"], 0) {
		t.Errorf("fee after both joins must go to the fee-charging wager: %v", shares)
	}

	// A fee charged between the joins (before the late wager): the late wager
	// must not retro-earn it. Only the zero-fee wager was active, so the fee is
	// attributed by the conservation fallback — over all wagers by fee·risk,
	// i.e. again to the fee-charging wager. The property that matters (and is
	// tested here) is exact conservation either way.
	bets = []betRecord{betAt("buyer", 1.0, gBase.Add(time.Hour))}
	shares = settleGuarantors(bets, []GuaranteeWager{early, late}, 0)
	if !approxEq(shares["p1"]+shares["p2"], 1.0) {
		t.Errorf("fee pool must be fully attributed: %v", shares)
	}

	// Two fee-charging wagers, one early one late: a bet between the joins
	// attributes only to the early one despite the late one's higher weight.
	earlyFee := wagerAt("p1", 4, 0.05, gBase)
	lateFee := wagerAt("p2", 4, 0.20, gBase.Add(2*time.Hour))
	bets = []betRecord{
		betAt("buyer", 1.0, gBase.Add(time.Hour)),  // between: only p1 active
		betAt("buyer", 3.0, gBase.Add(3*time.Hour)), // after: weights 0.2 vs 0.8
	}
	shares = settleGuarantors(bets, []GuaranteeWager{earlyFee, lateFee}, 0)
	// Between: 1.0 → p1. After: 3.0 split 1:4 → 0.6 p1, 2.4 p2.
	if !approxEq(shares["p1"], 1.6) || !approxEq(shares["p2"], 2.4) {
		t.Errorf("time-windowed fee attribution: want p1=1.6 p2=2.4, got %v", shares)
	}
}

func TestSettleGuarantorsSurplusProRataByRisk(t *testing.T) {
	// Equity surplus is split pro-rata by risk regardless of fees (fees only
	// shape the fee pool and the deficit waterfall).
	wagers := []GuaranteeWager{
		wagerAt("p1", 3, 0.10, gBase),
		wagerAt("p2", 1, 0.00, gBase),
	}
	shares := settleGuarantors(nil, wagers, 8)
	if !approxEq(shares["p1"], 6) || !approxEq(shares["p2"], 2) {
		t.Errorf("surplus must be pro-rata by risk: %v", shares)
	}
}

func TestSettleGuarantorsDeficitWaterfall(t *testing.T) {
	// Deficit: fee-charging wagers pay first weighted fee·risk, capped at
	// their risk; zero-fee wagers are the senior tranche and cover the rest.
	highFeeSmallRisk := wagerAt("p1", 2, 0.25, gBase) // weight 0.5
	midFee := wagerAt("p2", 6, 0.05, gBase)           // weight 0.3
	zeroFee := wagerAt("p3", 10, 0.00, gBase)         // senior
	// Deficit 8: tier1 = weights {0.5, 0.3, 0} over {p1, p2}: proportional would
	// be 5 and 3 — p1 caps at its risk 2, so the remaining 6 goes to p2 (exactly
	// p2's risk).
	shares := settleGuarantors(nil, []GuaranteeWager{highFeeSmallRisk, midFee, zeroFee}, -8)
	if !approxEq(shares["p1"], -2) {
		t.Errorf("high-fee wager must pay exactly its risk: %v", shares["p1"])
	}
	if !approxEq(shares["p2"], -6) {
		t.Errorf("remaining tier-1 deficit must stay fee-weighted: %v", shares["p2"])
	}
	if shares["p3"] != 0 {
		t.Errorf("senior tranche must not pay while fee-charging capacity remains: %v", shares["p3"])
	}

	// A deficit beyond tier 1 spills to the zero-fee senior tranche pro-rata by
	// remaining risk: deficit 20 exhausts p1 (2) and p2 (6), leaving 12 for p3.
	shares = settleGuarantors(nil, []GuaranteeWager{highFeeSmallRisk, midFee, zeroFee}, -20)
	if !approxEq(shares["p1"], -2) || !approxEq(shares["p2"], -6) || !approxEq(shares["p3"], -12) {
		t.Errorf("waterfall spill to senior: %v", shares)
	}
}

func TestSettleGuarantorsCombinesPotsExactly(t *testing.T) {
	// Fee pool + equity residual + deficit waterfall combined, with several
	// wagers per player: per-player nets must sum to feePool + residual
	// exactly (strict zero-sum conservation).
	wagers := []GuaranteeWager{
		wagerAt("p1", 4, 0.10, gBase),
		wagerAt("p2", 6, 0.00, gBase),
		wagerAt("p1", 2, 0.20, gBase.Add(time.Hour)),
	}
	bets := []betRecord{
		betAt("b", 0.9, gBase.Add(30*time.Minute)),
		betAt("b", 1.6, gBase.Add(2*time.Hour)),
	}
	feePool := 0.9 + 1.6
	residual := -5.0
	shares := settleGuarantors(bets, wagers, residual)
	var total float64
	for _, s := range shares {
		total += s
	}
	if math.Abs(total-(feePool+residual)) > 1e-9 {
		t.Errorf("shares %v sum to %v, want exactly %v", shares, total, feePool+residual)
	}
	// Same player's two wagers aggregate into one net.
	if _, ok := shares["p1"]; !ok {
		t.Errorf("p1 must have an aggregated entry: %v", shares)
	}
}

func TestSettleGuarantorsEmptyWagers(t *testing.T) {
	if shares := settleGuarantors(nil, nil, 5); shares != nil {
		t.Errorf("no wagers must yield nil, got %v", shares)
	}
}
