package elo

import (
	"testing"
	"time"
)

func priceBets(outcomeIDs [3]string, bets ...[2]any) []PriceBet {
	// Each entry is {outcome index into outcomeIDs, shares} placed one hour apart.
	out := make([]PriceBet, 0, len(bets))
	base := time.Date(2026, time.August, 15, 12, 0, 0, 0, time.UTC)
	for i, b := range bets {
		out = append(out, PriceBet{
			Outcome:  outcomeIDs[b[0].(int)],
			Shares:   b[1].(float64),
			PlacedAt: base.Add(time.Duration(i) * time.Hour),
		})
	}
	return out
}

var threeOutcomes = [3]string{"o1", "o2", "o3"}

func priceOf(t *testing.T, p PricePoint, outcomeID string) float64 {
	t.Helper()
	for _, op := range p.Prices {
		if op.OutcomeID == outcomeID {
			return op.Price
		}
	}
	t.Fatalf("outcome %q missing from point prices %v", outcomeID, p.Prices)
	return 0
}

func TestPriceHistoryEmpty(t *testing.T) {
	if pts := PriceHistory(nil, threeOutcomes[:], 100); len(pts) != 0 {
		t.Fatalf("expected no points for a bet-less market, got %d", len(pts))
	}
}

func TestPriceHistorySingleBet(t *testing.T) {
	pts := PriceHistory(priceBets(threeOutcomes, [2]any{0, 10.0}), threeOutcomes[:], 100)
	if len(pts) != 1 {
		t.Fatalf("expected 1 point, got %d", len(pts))
	}
	if priceOf(t, pts[0], "o1") <= 1.0/3 {
		t.Errorf("an o1 buy must push its price above 1/3, got %v", priceOf(t, pts[0], "o1"))
	}
	// The point must equal the price PlaceBet would have broadcast.
	live := MarginalPricesN([]float64{10, 0, 0}, 100)
	if !approxEq(priceOf(t, pts[0], "o1"), live[0]) {
		t.Errorf("replayed price %v != live price %v", priceOf(t, pts[0], "o1"), live[0])
	}
	// Every point carries the full price vector, summing to 1.
	if !approxEq(sum([]float64{priceOf(t, pts[0], "o1"), priceOf(t, pts[0], "o2"), priceOf(t, pts[0], "o3")}), 1.0) {
		t.Errorf("point prices must sum to 1")
	}
}

func TestPriceHistoryBuyingOutcomeLowersOthers(t *testing.T) {
	pts := PriceHistory(priceBets(threeOutcomes, [2]any{1, 10.0}), threeOutcomes[:], 100)
	if !(priceOf(t, pts[0], "o2") > 1.0/3) {
		t.Errorf("an o2 buy must raise o2 above 1/3, got %v", priceOf(t, pts[0], "o2"))
	}
	for _, id := range []string{"o1", "o3"} {
		if !(priceOf(t, pts[0], id) < 1.0/3) {
			t.Errorf("an o2 buy must lower %s below 1/3, got %v", id, priceOf(t, pts[0], id))
		}
	}
}

func TestPriceHistorySymmetricBetsStayUniform(t *testing.T) {
	pts := PriceHistory(priceBets(threeOutcomes,
		[2]any{0, 7.0},
		[2]any{1, 3.0},
		[2]any{1, 4.0},
		[2]any{2, 7.0},
	), threeOutcomes[:], 100)
	if len(pts) != 4 {
		t.Fatalf("expected 4 points, got %d", len(pts))
	}
	for _, id := range threeOutcomes[:] {
		if !approxEq(priceOf(t, pts[3], id), 1.0/3) {
			t.Errorf("equal share totals must give uniform prices, o(%s)=%v", id, priceOf(t, pts[3], id))
		}
	}
}

func TestPriceHistoryMatchesLiveState(t *testing.T) {
	// The last replayed point must equal the market's current live price for
	// the same q state — this is what keeps the chart consistent with the SSE
	// stream it gets appended to.
	bets := priceBets(threeOutcomes,
		[2]any{0, 5.0},
		[2]any{1, 2.0},
		[2]any{0, 1.0},
		[2]any{2, 9.0},
	)
	pts := PriceHistory(bets, threeOutcomes[:], 100)
	q := []float64{0, 0, 0}
	for _, b := range bets {
		for i, id := range threeOutcomes {
			if b.Outcome == id {
				q[i] += b.Shares
			}
		}
	}
	live := MarginalPricesN(q, 100)
	for i, id := range threeOutcomes {
		if !approxEq(priceOf(t, pts[len(pts)-1], id), live[i]) {
			t.Errorf("last replayed price for %s: %v != live %v", id, priceOf(t, pts[len(pts)-1], id), live[i])
		}
	}
}

func TestPriceHistorySkipsNonPositiveSharesAndUnknownOutcomes(t *testing.T) {
	pts := PriceHistory(priceBets(threeOutcomes,
		[2]any{0, 10.0},
		[2]any{1, 0.0},
		[2]any{0, 5.0},
	), threeOutcomes[:], 100)
	// Also a bet referencing an outcome outside the market's set is skipped.
	pts = append(pts, PriceHistory([]PriceBet{{Outcome: "unknown", Shares: 3, PlacedAt: time.Now()}}, threeOutcomes[:], 100)...)
	if len(pts) != 2 {
		t.Fatalf("expected zero-shares and unknown-outcome bets to be skipped, got %d points", len(pts))
	}
}
