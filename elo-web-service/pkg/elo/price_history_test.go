package elo

import (
	"testing"
	"time"
)

func priceBets(bets ...[2]any) []PriceBet {
	// Each entry is {outcome, shares} placed one hour apart.
	out := make([]PriceBet, 0, len(bets))
	base := time.Date(2026, time.August, 15, 12, 0, 0, 0, time.UTC)
	for i, b := range bets {
		out = append(out, PriceBet{
			Outcome:  b[0].(string),
			Shares:   b[1].(float64),
			PlacedAt: base.Add(time.Duration(i) * time.Hour),
		})
	}
	return out
}

func TestPriceHistoryEmpty(t *testing.T) {
	if pts := PriceHistory(nil, 100); len(pts) != 0 {
		t.Fatalf("expected no points for a bet-less market, got %d", len(pts))
	}
}

func TestPriceHistorySingleBet(t *testing.T) {
	pts := PriceHistory(priceBets([2]any{"yes", 10.0}), 100)
	if len(pts) != 1 {
		t.Fatalf("expected 1 point, got %d", len(pts))
	}
	if pts[0].YesPrice <= 0.5 {
		t.Errorf("a YES buy must push the yes-price above 0.5, got %v", pts[0].YesPrice)
	}
	// The point must equal the price PlaceBet would have broadcast.
	yes, _ := MarginalPrices(10, 0, 100)
	if !approxEq(pts[0].YesPrice, yes) {
		t.Errorf("replayed price %v != live price %v", pts[0].YesPrice, yes)
	}
}

func TestPriceHistoryNoBetPushesYesDown(t *testing.T) {
	pts := PriceHistory(priceBets([2]any{"no", 10.0}), 100)
	if len(pts) != 1 {
		t.Fatalf("expected 1 point, got %d", len(pts))
	}
	if pts[0].YesPrice >= 0.5 {
		t.Errorf("a NO buy must push the yes-price below 0.5, got %v", pts[0].YesPrice)
	}
}

func TestPriceHistorySymmetricBetsStayAtHalf(t *testing.T) {
	pts := PriceHistory(priceBets(
		[2]any{"yes", 7.0},
		[2]any{"no", 3.0},
		[2]any{"no", 4.0},
	), 100)
	if len(pts) != 3 {
		t.Fatalf("expected 3 points, got %d", len(pts))
	}
	if !approxEq(pts[2].YesPrice, 0.5) {
		t.Errorf("equal yes/no share totals must give 0.5, got %v", pts[2].YesPrice)
	}
}

func TestPriceHistoryMatchesLiveState(t *testing.T) {
	// The last replayed point must equal the market's current live price for
	// the same q state — this is what keeps the chart consistent with the SSE
	// stream it gets appended to.
	bets := priceBets(
		[2]any{"yes", 5.0},
		[2]any{"no", 2.0},
		[2]any{"yes", 1.0},
		[2]any{"no", 9.0},
	)
	pts := PriceHistory(bets, 100)
	qYes, qNo := 0.0, 0.0
	for _, b := range bets {
		if b.Outcome == "yes" {
			qYes += b.Shares
		} else {
			qNo += b.Shares
		}
	}
	yesLive, _ := MarginalPrices(qYes, qNo, 100)
	if !approxEq(pts[len(pts)-1].YesPrice, yesLive) {
		t.Errorf("last replayed price %v != live price %v", pts[len(pts)-1].YesPrice, yesLive)
	}
}

func TestPriceHistorySkipsNonPositiveShares(t *testing.T) {
	pts := PriceHistory(priceBets(
		[2]any{"yes", 10.0},
		[2]any{"no", 0.0},
		[2]any{"yes", 5.0},
	), 100)
	if len(pts) != 2 {
		t.Fatalf("expected zero-shares bets to be skipped, got %d points", len(pts))
	}
}
