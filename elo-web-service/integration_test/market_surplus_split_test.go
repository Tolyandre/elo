//go:build integration

package integration_test

import (
	"context"
	"math"
	"testing"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/elo"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

// TestMarketSurplusSplit_ExposureAccrual verifies the ADR-23 surplus split
// end-to-end: two equal-risk guarantors joining around a bet — the first
// guarantor alone backed the first trade's created liability, so he must earn
// more than half of the settlement surplus even though the risks are equal.
// The expected shares are derived in the test from the stored bet costs via
// the same replay settleGuarantors performs.
func TestMarketSurplusSplit_ExposureAccrual(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	playerA := createTestPlayer(t, pool, "SplA")
	playerB := createTestPlayer(t, pool, "SplB")
	playerC := createTestPlayer(t, pool, "SplC") // wins the match → "other" wins the market
	buyerA := createTestPlayer(t, pool, "SplBuyerA")
	buyerB := createTestPlayer(t, pool, "SplBuyerB")
	g1 := createTestPlayer(t, pool, "SplG1")
	g2 := createTestPlayer(t, pool, "SplG2")
	gameID := createTestGame(t, pool, "SplGame")
	adminID := createTestAdmin(t, pool)

	matchSvc := newMatchService(pool)
	marketSvc := elo.NewMarketService(pool)

	// Warm-up match, then fund everyone above its recalculation.
	if _, err := matchSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{playerA: 5, playerB: 5}, time.Now().Add(-2*time.Hour), newMatchOpts(t)); err != nil {
		t.Fatalf("warm-up AddMatch: %v", err)
	}
	for _, p := range []idpkg.ID{buyerA, buyerB, g1, g2} {
		setBetLimit(t, pool, p, 16)
	}

	market, err := marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
		ID:         newID(t),
		MarketType: "match_winner",
		StartsAt:   time.Now().Add(-time.Minute),
		ClosesAt:   time.Now().Add(24 * time.Hour),
		CreatedBy:  adminID,
		MatchWinner: &elo.MatchWinnerCreateParams{
			TargetPlayerIDs:   []idpkg.ID{playerA, playerB},
			AllowOtherPlayers: true,
		},
	})
	if err != nil {
		t.Fatalf("CreateMarket: %v", err)
	}

	// G1 joins alone (Σrisk 4 → envelope 4, standby floor 0.4).
	if _, err := marketSvc.JoinAsGuarantee(ctx, newID(t), market.ID, g1, 4, 0); err != nil {
		t.Fatalf("JoinAsGuarantee g1: %v", err)
	}

	outcomeA := marketOutcomeID(t, ctx, marketSvc, market.ID, "player", playerA)
	outcomeB := marketOutcomeID(t, ctx, marketSvc, market.ID, "player", playerB)

	// Event 1: buyerA takes 1 share of A at the fresh 1/3 market — the buy
	// creates real uncovered liability (1 share outstanding vs ~0.36 collected).
	if _, err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, buyerA, outcomeA, 1); err != nil {
		t.Fatalf("buyerA bet: %v", err)
	}

	// G2 joins (Σrisk 8 → envelope 8, standby floor 0.8)…
	if _, err := marketSvc.JoinAsGuarantee(ctx, newID(t), market.ID, g2, 4, 0); err != nil {
		t.Fatalf("JoinAsGuarantee g2: %v", err)
	}

	// …and event 2: buyerB takes 1 share of B (the buy re-collateralizes the
	// book below the floor).
	if _, err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, buyerB, outcomeB, 1); err != nil {
		t.Fatalf("buyerB bet: %v", err)
	}

	// "Other" wins: nobody holds it, so paid = 0 and the whole collected pot
	// is surplus.
	if _, err := matchSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{playerA: 2, playerB: 3, playerC: 10}, time.Now(), newMatchOpts(t)); err != nil {
		t.Fatalf("trigger AddMatch: %v", err)
	}

	// Replay the two events exactly like settleGuarantors does, from the
	// stored bet costs.
	costA := readBetCost(t, pool, market.ID, buyerA)
	costB := readBetCost(t, pool, market.ID, buyerB)
	const rho = 0.1
	v1 := math.Max(1-costA, rho*math.Min(16, 4))       // event 1: only g1 active
	v2 := math.Max(1-costA-costB, rho*math.Min(16, 8)) // event 2: both active
	aG1 := v1*(4.0/4.0) + v2*(4.0/8.0)
	aG2 := v2 * (4.0 / 8.0)
	collected := costA + costB

	wantG1 := collected * aG1 / (aG1 + aG2)
	wantG2 := collected * aG2 / (aG1 + aG2)
	if !(wantG1 > wantG2) {
		t.Fatalf("test setup broken: g1 must out-earn g2 (want %.4f vs %.4f)", wantG1, wantG2)
	}

	if got := playerMarketDelta(t, pool, market.ID, g1); math.Abs(got-wantG1) > 1e-6 {
		t.Errorf("g1 delta = %.6f, want the accrual share %.6f", got, wantG1)
	}
	if got := playerMarketDelta(t, pool, market.ID, g2); math.Abs(got-wantG2) > 1e-6 {
		t.Errorf("g2 delta = %.6f, want the accrual share %.6f", got, wantG2)
	}

	// Buyers lose their stakes; the whole market stays zero-sum.
	var deltaSum float64
	rows, err := pool.Query(ctx, `SELECT elo_staked, elo_earned FROM arena_settlements WHERE arena_id = 'a2ea0000-0000-0000-0000-000000000001' AND market_id = $1`, market.ID)
	if err != nil {
		t.Fatalf("query settlements: %v", err)
	}
	for rows.Next() {
		var staked, earned float64
		if err := rows.Scan(&staked, &earned); err != nil {
			rows.Close()
			t.Fatalf("scan: %v", err)
		}
		deltaSum += staked + earned
	}
	rows.Close()
	if math.Abs(deltaSum) > 1e-9 {
		t.Errorf("settlement not zero-sum: Σ(elo_staked+elo_earned) = %.6f", deltaSum)
	}
}
