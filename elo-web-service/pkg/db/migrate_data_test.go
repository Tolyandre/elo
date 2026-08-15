package db

import (
	"math"
	"testing"
)

// ammCost mirrors pkg/elo/amm.go's cost function for verifying the replay
// helper: C(q_yes, q_no) = b · ln(e^(q_yes/b) + e^(q_no/b)), log-sum-exp
// stabilized.
func ammCost(qYes, qNo, b float64) float64 {
	uy := qYes / b
	un := qNo / b
	m := math.Max(uy, un)
	return b * (m + math.Log(math.Exp(uy-m)+math.Exp(un-m)))
}

func TestLmsrSharesForAmount_InvertsCost(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name    string
		qYes    float64
		qNo     float64
		b       float64
		outcome string
		amount  float64
	}{
		{name: "fresh market", qYes: 0, qNo: 0, b: 16, outcome: "yes", amount: 1},
		{name: "shifted to no", qYes: 2, qNo: 9.5, b: 16, outcome: "no", amount: 3},
		{name: "large stake", qYes: 5, qNo: 0.5, b: 16, outcome: "yes", amount: 40},
		{name: "small liquidity", qYes: 1, qNo: 1, b: 4, outcome: "no", amount: 2},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			shares := lmsrSharesForAmount(tc.qYes, tc.qNo, tc.b, tc.outcome, tc.amount)
			if shares <= 0 {
				t.Fatalf("shares = %v, want > 0", shares)
			}
			// The implied per-bet price must be a valid probability.
			price := tc.amount / shares
			if price <= 0 || price >= 1 {
				t.Fatalf("implied price = %v, want ∈ (0,1)", price)
			}

			// Buying the solved share count at this state must cost exactly
			// the target amount (the definition of the inverse).
			var cost float64
			if tc.outcome == "yes" {
				cost = ammCost(tc.qYes+shares, tc.qNo, tc.b) - ammCost(tc.qYes, tc.qNo, tc.b)
			} else {
				cost = ammCost(tc.qYes, tc.qNo+shares, tc.b) - ammCost(tc.qYes, tc.qNo, tc.b)
			}
			if math.Abs(cost-tc.amount) > 1e-9 {
				t.Fatalf("cost of %v shares = %v, want %v", shares, cost, tc.amount)
			}
		})
	}
}

func TestLmsrSharesForAmount_PriceBounds(t *testing.T) {
	t.Parallel()

	// Extreme one-sided states must stay in (0,1) thanks to the log-sum-exp
	// stabilization, and the solved shares must remain finite and positive.
	states := [][2]float64{{0, 500}, {500, 0}, {0, 0}, {-0, 0}}
	for _, st := range states {
		for _, outcome := range []string{"yes", "no"} {
			p := lmsrPrice(st[0], st[1], 16, outcome)
			if p <= 0 || p >= 1 || math.IsNaN(p) {
				t.Fatalf("price(%v, %v, %q) = %v, want ∈ (0,1)", st[0], st[1], outcome, p)
			}
			s := lmsrSharesForAmount(st[0], st[1], 16, outcome, 5)
			if s <= 0 || math.IsNaN(s) || math.IsInf(s, 0) {
				t.Fatalf("shares(%v, %v, %q) = %v, want finite > 0", st[0], st[1], outcome, s)
			}
		}
	}
}

// TestReplayPayoutPin checks the invariant the backfill must preserve: after
// pinning, each player's winning-side share total equals their pari-mutuel
// payout amount_win × totalPool/winPool, and the winning shares across all
// players sum to the total pool (zero guarantor residual).
func TestReplayPayoutPin(t *testing.T) {
	t.Parallel()

	const b = 16.0
	// Two players on the winning side with different stakes, one loser.
	type bet struct {
		player  string
		outcome string
		amount  float64
	}
	bets := []bet{
		{"p1", "no", 1}, {"p1", "no", 1}, {"p2", "no", 3},
		{"p1", "yes", 2}, {"p2", "yes", 1},
	}
	winning := "no"

	qYes, qNo := 0.0, 0.0
	shares := make([]float64, len(bets))
	for i, bt := range bets {
		s := lmsrSharesForAmount(qYes, qNo, b, bt.outcome, bt.amount)
		shares[i] = s
		if bt.outcome == "yes" {
			qYes += s
		} else {
			qNo += s
		}
	}

	// Same pinning arithmetic as backfillMarketShares.
	winPool, totalPool := 0.0, 0.0
	amountWin := map[string]float64{}
	replayWin := map[string]float64{}
	for i, bt := range bets {
		totalPool += bt.amount
		if bt.outcome == winning {
			winPool += bt.amount
			amountWin[bt.player] += bt.amount
			replayWin[bt.player] += shares[i]
		}
	}
	payoutRatio := totalPool / winPool
	factor := map[string]float64{}
	for pid, replayed := range replayWin {
		factor[pid] = amountWin[pid] * payoutRatio / replayed
	}
	for i, bt := range bets {
		if bt.outcome == winning {
			shares[i] *= factor[bt.player]
		}
	}

	pinned := map[string]float64{}
	for i, bt := range bets {
		if bt.outcome == winning {
			pinned[bt.player] += shares[i]
		}
	}
	for pid, want := range map[string]float64{
		"p1": 2 * 8.0 / 5.0, // amount_win × totalPool/winPool = 2 × 8/5
		"p2": 3 * 8.0 / 5.0,
	} {
		if got := pinned[pid]; math.Abs(got-want) > 1e-9 {
			t.Fatalf("player %s winning shares = %v, want %v", pid, got, want)
		}
	}
	var winSum float64
	for _, v := range pinned {
		winSum += v
	}
	if math.Abs(winSum-totalPool) > 1e-9 {
		t.Fatalf("winning shares sum = %v, want total pool %v (zero residual)", winSum, totalPool)
	}
}
