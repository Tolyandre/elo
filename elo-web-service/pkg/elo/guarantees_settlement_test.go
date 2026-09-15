package elo

import (
	"math"
	"testing"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/id"
)

// --- settleGuarantors -----------------------------------------------------------

func wagerAt(pid id.ID, risk, fee float64, at time.Time) GuaranteeWager {
	return GuaranteeWager{ID: id.ID(string(pid) + "-w"), PlayerID: pid, RiskAmount: risk, FeeRate: fee, CreatedAt: at}
}

func betAt(pid id.ID, fee float64, at time.Time) betRecord {
	return betRecord{PlayerID: pid, Fee: fee, PlacedAt: at}
}

var gBase = time.Date(2026, time.September, 1, 12, 0, 0, 0, time.UTC)

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
	shares := settleGuarantors(bets, []GuaranteeWager{early, late}, 16, 0)
	if !approxEq(shares["p2"], 1.0) || !approxEq(shares["p1"], 0) {
		t.Errorf("fee after both joins must go to the fee-charging wager: %v", shares)
	}

	// A fee charged between the joins (before the late wager): the late wager
	// must not retro-earn it. Only the zero-fee wager was active, so the fee is
	// attributed by the conservation fallback — over all wagers by fee·risk,
	// i.e. again to the fee-charging wager. The property that matters (and is
	// tested here) is exact conservation either way.
	bets = []betRecord{betAt("buyer", 1.0, gBase.Add(time.Hour))}
	shares = settleGuarantors(bets, []GuaranteeWager{early, late}, 16, 0)
	if !approxEq(shares["p1"]+shares["p2"], 1.0) {
		t.Errorf("fee pool must be fully attributed: %v", shares)
	}

	// Two fee-charging wagers, one early one late: a bet between the joins
	// attributes only to the early one despite the late one's higher weight.
	earlyFee := wagerAt("p1", 4, 0.05, gBase)
	lateFee := wagerAt("p2", 4, 0.20, gBase.Add(2*time.Hour))
	bets = []betRecord{
		betAt("buyer", 1.0, gBase.Add(time.Hour)),   // between: only p1 active
		betAt("buyer", 3.0, gBase.Add(3*time.Hour)), // after: weights 0.2 vs 0.8
	}
	shares = settleGuarantors(bets, []GuaranteeWager{earlyFee, lateFee}, 16, 0)
	// Between: 1.0 → p1. After: 3.0 split 1:4 → 0.6 p1, 2.4 p2.
	if !approxEq(shares["p1"], 1.6) || !approxEq(shares["p2"], 2.4) {
		t.Errorf("time-windowed fee attribution: want p1=1.6 p2=2.4, got %v", shares)
	}
}

func TestSettleGuarantorsSurplusProRataByRisk(t *testing.T) {
	// Degenerate surplus (no bet events ever sampled): the split falls back
	// to plain pro-rata by risk regardless of fees (fees only shape the fee
	// pool and the deficit waterfall).
	wagers := []GuaranteeWager{
		wagerAt("p1", 3, 0.10, gBase),
		wagerAt("p2", 1, 0.00, gBase),
	}
	shares := settleGuarantors(nil, wagers, 16, 8)
	if !approxEq(shares["p1"], 6) || !approxEq(shares["p2"], 2) {
		t.Errorf("surplus must be pro-rata by risk: %v", shares)
	}
}

// betOn is a betRecord with a real outcome/shares/cost body for accrual
// replays (betAt only carries fees).
func betOn(outcome string, shares, cost float64, at time.Time) betRecord {
	return betRecord{PlayerID: id.ID("buyer"), Outcome: id.ID(outcome), Shares: shares, Cost: cost, PlacedAt: at}
}

func TestSettleGuarantorsExposureAccrualSequenceOnly(t *testing.T) {
	// ADR-23 worked example: equal risks, two bets, the first one creating
	// real liability while only G1 was active. The accrual is sequence-only —
	// wall-clock gaps between events are irrelevant.
	g1 := wagerAt("g1", 8, 0, gBase)
	g2 := wagerAt("g2", 8, 0, gBase.Add(2*time.Hour)) // joins after bet 1
	bets := []betRecord{
		// Active {G1}: q=[A]=2, collected 1.1 → V_raw = 0.9 > floor 0.8 → G1 +0.9.
		betOn("A", 2, 1.10, gBase.Add(time.Hour)),
		// Active {G1, G2}: q=[A,B]=2, collected 2.4 → V_raw < 0, floor 1.6 → +0.8 each.
		betOn("B", 2, 1.30, gBase.Add(3*time.Hour)),
	}
	shares := settleGuarantors(bets, []GuaranteeWager{g1, g2}, 16, 0.4)
	if !approxEq(shares["g1"], 0.272) || !approxEq(shares["g2"], 0.128) {
		t.Errorf("exposure accrual split: want g1=0.272 g2=0.128, got %v", shares)
	}

	// The identical sequence at different wall-clock times must split
	// identically.
	spacedWagers := []GuaranteeWager{
		wagerAt("g1", 8, 0, gBase),
		wagerAt("g2", 8, 0, gBase.Add(100*time.Hour)),
	}
	spacedBets := []betRecord{
		betOn("A", 2, 1.10, gBase.Add(50*time.Hour)),
		betOn("B", 2, 1.30, gBase.Add(200*time.Hour)),
	}
	spaced := settleGuarantors(spacedBets, spacedWagers, 16, 0.4)
	if !approxEq(spaced["g1"], shares["g1"]) || !approxEq(spaced["g2"], shares["g2"]) {
		t.Errorf("accrual must be sequence-only: %v vs %v", spaced, shares)
	}
}

func TestSettleGuarantorsStandbyFloorSplitsByBackedTrades(t *testing.T) {
	// A saturated market (every buy ≈ 1.00, V_raw ≈ 0): the standby floor
	// pays a per-trade royalty ∝ active risk share. The dev-market shape:
	// a thin early guarantor backing 2 trades alone, a deep late one present
	// for 3 more.
	thin := wagerAt("thin", 0.1, 0, gBase)
	deep := wagerAt("deep", 4, 0, gBase.Add(time.Hour))
	bets := []betRecord{
		betOn("ilya", 1, 1, gBase.Add(10*time.Minute)),
		betOn("ilya", 1, 1, gBase.Add(20*time.Minute)),
		// deep joins after these two:
		betOn("ilya", 1, 1, gBase.Add(2*time.Hour)),
		betOn("ilya", 1, 1, gBase.Add(3*time.Hour)),
		betOn("ilya", 1, 1, gBase.Add(4*time.Hour)),
	}
	// Envelope 0.1 while thin is alone (floor 0.01/trade), 4.1 afterwards
	// (floor 0.41/trade at 0.1/4.1 vs 4/4.1 shares): thin = 2·0.01 +
	// 3·0.41·(0.1/4.1) = 0.05; deep = 3·0.41·(4/4.1) = 1.2.
	shares := settleGuarantors(bets, []GuaranteeWager{thin, deep}, 16, 13)
	if !approxEq(shares["thin"], 13*0.05/1.25) || !approxEq(shares["deep"], 13*1.2/1.25) {
		t.Errorf("standby-only split: want thin=%.4f deep=%.4f, got %v", 13*0.05/1.25, 13*1.2/1.25, shares)
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
	shares := settleGuarantors(nil, []GuaranteeWager{highFeeSmallRisk, midFee, zeroFee}, 16, -8)
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
	// remaining risk: deficit 17 exhausts p1 (2) and p2 (6), leaving 9 for p3
	// (within its 10 risk — deficits beyond Σrisk are the insolvency case
	// covered by TestSettleGuarantorsInsolventDeficitDropped).
	shares = settleGuarantors(nil, []GuaranteeWager{highFeeSmallRisk, midFee, zeroFee}, 16, -17)
	if !approxEq(shares["p1"], -2) || !approxEq(shares["p2"], -6) || !approxEq(shares["p3"], -9) {
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
	shares := settleGuarantors(bets, wagers, 16, residual)
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
	if shares := settleGuarantors(nil, nil, 16, 5); shares != nil {
		t.Errorf("no wagers must yield nil, got %v", shares)
	}
}

// TestGuarantorLossBoundedByRisk replays a saturated market — the dev-market
// shape (market Cf2zAhhjiGU9n1zyfD2JD): one zero-fee guarantor risking 1 on a
// 3-outcome market, 35 one-share buys of the leader, plus a dust-cost underdog
// buy — through settlement and asserts the margin-of-error invariant the FP
// epsilons must respect: a wager's loss never exceeds its risk beyond
// capSlack, whatever the bet stream's float dust does.
func TestGuarantorLossBoundedByRisk(t *testing.T) {
	b := liquidityBForRisk(16, 1, 3)
	q := []float64{0, 0, 0}
	wagers := []GuaranteeWager{wagerAt(id.ID("0196-sat-guarantor"), 1, 0, gBase)}

	bets := make([]betRecord, 0, 36)
	placed := gBase
	for range 35 {
		var amount float64
		q, amount = ApplyBetN(q, b, 0, 1)
		bets = append(bets, betRecord{
			PlayerID: id.ID("0196-sat-buyer"),
			Outcome:  id.ID("0196-sat-leader"),
			Cost:     amount,
			Shares:   1,
			PlacedAt: placed,
		})
		placed = placed.Add(time.Second)
	}
	// The ~0-cost underdog share (the buy this fix re-enabled).
	var dust float64
	q, dust = ApplyBetN(q, b, 1, 1)
	if dust <= 0 || dust > 1e-15 {
		t.Fatalf("underdog cost = %v, want the tiny true cost", dust)
	}
	bets = append(bets, betRecord{
		PlayerID: id.ID("0196-sat-underdog"),
		Outcome:  id.ID("0196-sat-underdog-outcome"),
		Cost:     dust,
		Shares:   1,
		PlacedAt: placed,
	})

	// The leader wins: paid = 35 shares, collected = Σ costs.
	collected := 0.0
	for _, bet := range bets {
		collected += bet.Cost
	}
	residual := collected - 35
	shares := settleGuarantors(bets, wagers, 16, residual)

	var loss float64
	for _, share := range shares {
		loss += math.Min(share, 0)
	}
	if loss > 1+capSlack(1) {
		t.Errorf("guarantor loss %.17g exceeds the 1 risk beyond the capSlack margin", -loss)
	}
	if residual > 0 {
		t.Errorf("a fully-bought leader market must be at deficit or break-even, got surplus %v", residual)
	}
}

// TestSettleGuarantorsInsolventDeficitDropped covers the state left behind by
// the removed q rescale (ADR-22): the deficit exceeds the combined risk, so
// the waterfall cannot cover it. The wagers must pay at most their risk (the
// old code parked the whole uncovered remainder on the largest cap,
// bankrupting that guarantor) and the remainder is dropped — the guarantor
// pot lands at exactly −Σrisk.
func TestSettleGuarantorsInsolventDeficitDropped(t *testing.T) {
	wagers := []GuaranteeWager{
		wagerAt(id.ID("p-insolv-1"), 0.1, 0, gBase),
		wagerAt(id.ID("p-insolv-2"), 4, 0, gBase),
	}
	shares := settleGuarantors(nil, wagers, 16, -118.6)

	total := 0.0
	for _, w := range wagers {
		if got := shares[w.PlayerID]; got < -w.RiskAmount-capSlack(w.RiskAmount) {
			t.Errorf("wager %s charged %.6f beyond its risk %.6f", w.PlayerID, -got, w.RiskAmount)
		}
		total += shares[w.PlayerID]
	}
	if !approxEq(total, -4.1) {
		t.Errorf("insolvent guarantor pot = %.6f, want exactly −Σrisk = −4.1", total)
	}
}
