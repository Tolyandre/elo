package elo

import (
	"math"
	"testing"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/id"
)

// timelineMaxLoss matches the founding wager of priceBets (risk = b·ln(3)) so
// liquidityBForRisk reproduces b = 100.
var timelineMaxLoss = 100.0 * math.Log(3)

func priceBets(outcomeIDs [3]id.ID, bets ...[2]any) []TimelineEvent {
	// Each entry is {outcome index into outcomeIDs, shares} placed one hour
	// apart, preceded by a founding guarantee wager whose risk yields exactly
	// b = 100 for the 3-outcome market (risk = b·ln(3), L = risk).
	base := time.Date(2026, time.August, 15, 12, 0, 0, 0, time.UTC)
	events := []TimelineEvent{{
		Kind:       TimelineGuarantee,
		At:         base.Add(-time.Hour),
		RiskAmount: timelineMaxLoss,
	}}
	for i, b := range bets {
		events = append(events, TimelineEvent{
			Kind:     TimelineBet,
			At:       base.Add(time.Duration(i) * time.Hour),
			Outcome:  outcomeIDs[b[0].(int)],
			Shares:   b[1].(float64),
		})
	}
	return events
}

var threeOutcomes = [3]id.ID{"o1", "o2", "o3"}

func priceOf(t *testing.T, p ProbabilityPoint, outcomeID id.ID) float64 {
	t.Helper()
	for _, op := range p.Probabilities {
		if op.OutcomeID == outcomeID {
			return op.Probability
		}
	}
	t.Fatalf("outcome %q missing from point probabilities %v", outcomeID, p.Probabilities)
	return 0
}

func TestProbabilityHistoryEmpty(t *testing.T) {
	if pts := ProbabilityHistory(nil, threeOutcomes[:], timelineMaxLoss); len(pts) != 0 {
		t.Fatalf("expected no points for an event-less market, got %d", len(pts))
	}
}

func TestProbabilityHistorySingleBet(t *testing.T) {
	pts := ProbabilityHistory(priceBets(threeOutcomes, [2]any{0, 10.0}), threeOutcomes[:], timelineMaxLoss)
	if len(pts) != 2 {
		t.Fatalf("expected 2 points (guarantee + bet), got %d", len(pts))
	}
	// The founding guarantee yields the uniform starting point.
	for _, oid := range threeOutcomes[:] {
		if !approxEq(priceOf(t, pts[0], oid), 1.0/3) {
			t.Errorf("founding guarantee must leave uniform probabilities, o(%s)=%v", oid, priceOf(t, pts[0], oid))
		}
	}
	if priceOf(t, pts[1], "o1") <= 1.0/3 {
		t.Errorf("an o1 buy must push its probability above 1/3, got %v", priceOf(t, pts[1], "o1"))
	}
	// The point must equal the probability PlaceBet would have broadcast.
	live := MarginalProbabilitiesN([]float64{10, 0, 0}, 100)
	if !approxEq(priceOf(t, pts[1], "o1"), live[0]) {
		t.Errorf("replayed probability %v != live probability %v", priceOf(t, pts[1], "o1"), live[0])
	}
	// Every point carries the full probability vector, summing to 1.
	if !approxEq(sum([]float64{priceOf(t, pts[1], "o1"), priceOf(t, pts[1], "o2"), priceOf(t, pts[1], "o3")}), 1.0) {
		t.Errorf("point probabilities must sum to 1")
	}
}

func TestProbabilityHistoryBuyingOutcomeLowersOthers(t *testing.T) {
	pts := ProbabilityHistory(priceBets(threeOutcomes, [2]any{1, 10.0}), threeOutcomes[:], timelineMaxLoss)
	if !(priceOf(t, pts[1], "o2") > 1.0/3) {
		t.Errorf("an o2 buy must raise o2 above 1/3, got %v", priceOf(t, pts[1], "o2"))
	}
	for _, oid := range []id.ID{"o1", "o3"} {
		if !(priceOf(t, pts[1], oid) < 1.0/3) {
			t.Errorf("an o2 buy must lower %s below 1/3, got %v", oid, priceOf(t, pts[1], oid))
		}
	}
}

func TestProbabilityHistorySymmetricBetsStayUniform(t *testing.T) {
	pts := ProbabilityHistory(priceBets(threeOutcomes,
		[2]any{0, 7.0},
		[2]any{1, 3.0},
		[2]any{1, 4.0},
		[2]any{2, 7.0},
	), threeOutcomes[:], timelineMaxLoss)
	if len(pts) != 5 {
		t.Fatalf("expected 5 points (guarantee + 4 bets), got %d", len(pts))
	}
	for _, id := range threeOutcomes[:] {
		if !approxEq(priceOf(t, pts[4], id), 1.0/3) {
			t.Errorf("equal share totals must give uniform probabilities, o(%s)=%v", id, priceOf(t, pts[4], id))
		}
	}
}

func TestProbabilityHistoryMatchesLiveState(t *testing.T) {
	// The last replayed point must equal the market's current live probability for
	// the same q state — this is what keeps the chart consistent with the SSE
	// stream it gets appended to.
	events := priceBets(threeOutcomes,
		[2]any{0, 5.0},
		[2]any{1, 2.0},
		[2]any{0, 1.0},
		[2]any{2, 9.0},
	)
	pts := ProbabilityHistory(events, threeOutcomes[:], timelineMaxLoss)
	q := []float64{0, 0, 0}
	for _, ev := range events {
		if ev.Kind != TimelineBet {
			continue
		}
		for i, id := range threeOutcomes {
			if ev.Outcome == id {
				q[i] += ev.Shares
			}
		}
	}
	live := MarginalProbabilitiesN(q, 100)
	for i, id := range threeOutcomes {
		if !approxEq(priceOf(t, pts[len(pts)-1], id), live[i]) {
			t.Errorf("last replayed probability for %s: %v != live %v", id, priceOf(t, pts[len(pts)-1], id), live[i])
		}
	}
}

func TestProbabilityHistorySkipsNonPositiveSharesAndUnknownOutcomes(t *testing.T) {
	pts := ProbabilityHistory(priceBets(threeOutcomes,
		[2]any{0, 10.0},
		[2]any{1, 0.0},
		[2]any{0, 5.0},
	), threeOutcomes[:], timelineMaxLoss)
	// Also a bet referencing an outcome outside the market's set is skipped.
	pts = append(pts, ProbabilityHistory([]TimelineEvent{{Kind: TimelineBet, At: time.Now(), Outcome: "unknown", Shares: 3}}, threeOutcomes[:], timelineMaxLoss)...)
	// priceBets prepends a guarantee point, so 1 + 2 valid bets.
	if len(pts) != 3 {
		t.Fatalf("expected zero-shares and unknown-outcome bets to be skipped, got %d points", len(pts))
	}
}

func TestProbabilityHistoryGuaranteeJoinPreservesPrices(t *testing.T) {
	// A mid-market guarantee join must not move any probability: the replay
	// rescales q together with b. The join also caps at L: the second wager's
	// risk pushes Σrisk past L, so b grows only to L/ln(3).
	base := time.Date(2026, time.August, 15, 12, 0, 0, 0, time.UTC)
	events := []TimelineEvent{
		{Kind: TimelineGuarantee, At: base, RiskAmount: 50},
		{Kind: TimelineBet, At: base.Add(time.Hour), Outcome: "o1", Shares: 12},
		{Kind: TimelineGuarantee, At: base.Add(2 * time.Hour), RiskAmount: 30},
		{Kind: TimelineBet, At: base.Add(3 * time.Hour), Outcome: "o2", Shares: 2},
	}
	L := 70.0 // first wager 50 + second 30 ⇒ capped at 70
	pts := ProbabilityHistory(events, threeOutcomes[:], L)
	if len(pts) != 4 {
		t.Fatalf("expected 4 points, got %d", len(pts))
	}
	before := priceOf(t, pts[1], "o1") // after the o1 buy
	after := priceOf(t, pts[2], "o1")  // after the guarantee join
	if !approxEq(before, after) {
		t.Errorf("guarantee join must preserve probabilities: before %v, after %v", before, after)
	}
	// The final live state the replay reaches must match MarginalProbabilitiesN
	// at b = L/ln(3) with the rescaled q: the first bet's 12 shares were
	// rescaled by b_new/b_old = (70/ln3)/(50/ln3) = 70/50 when the second
	// wager pushed Σrisk past L.
	q := []float64{12 * 70 / 50.0, 2, 0}
	bFinal := liquidityBForRisk(L, 80, 3)
	live := MarginalProbabilitiesN(q, bFinal)
	for i, oid := range threeOutcomes {
		if !approxEq(priceOf(t, pts[3], oid), live[i]) {
			t.Errorf("final replayed probability for %s: %v != live %v", oid, priceOf(t, pts[3], oid), live[i])
		}
	}
}

