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

// TestMarketSaturation_BetsKeepWorking reproduces dev market Cf2zAhhjiGU9n1zyfD2JD:
// a sole guarantor risking 1 on a 3-outcome match_winner market (b = 1/ln 3),
// then one-share buys of a single outcome until its probability saturates to
// exactly 1.0 in float64. Both follow-up trades that used to break must work:
//
//   - buying the 1.00 leader — the HTTP layer rejected expected_probability 1
//     with a 400 ((0,1) open interval), and the UI sends the value it shows;
//   - buying a ~0.00 underdog share — the naive C(q+s·e_i)−C(q) difference
//     cancelled its true cost (~1e-16) to exactly 0, violating the bets
//     cost > 0 constraint (SQLSTATE 23514).
//
// Settlement must also stay zero-sum with the guarantor losing at most the
// risked 1 (Hanson's bound: worst-case loss = b·ln n = Σ effective risk).
func TestMarketSaturation_BetsKeepWorking(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	playerA := createTestPlayer(t, pool, "SatA")
	playerB := createTestPlayer(t, pool, "SatB")
	playerU := createTestPlayer(t, pool, "SatUnderdog")
	guarantor := createTestPlayer(t, pool, "SatGuarantor")
	gameID := createTestGame(t, pool, "SatGame")
	adminID := createTestAdmin(t, pool)

	matchSvc := elo.NewMatchService(pool, elo.NewMarketService(pool))
	marketSvc := elo.NewMarketService(pool)

	// The buyers need headroom for ~40 reserved elo (the warm-up match alone
	// grants far less). playerA's limit is set after the warm-up match: its
	// recalculation rewrites participants' limits from the elo formula.
	setBetLimit(t, pool, playerU, 16)
	setBetLimit(t, pool, guarantor, 16)

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
	if _, err := marketSvc.JoinAsGuarantee(ctx, newID(t), market.ID, guarantor, 1, 0); err != nil {
		t.Fatalf("JoinAsGuarantee(risk 1): %v", err)
	}
	m, err := marketSvc.GetMarket(ctx, market.ID)
	if err != nil {
		t.Fatalf("GetMarket: %v", err)
	}
	if want := 1 / math.Log(3); math.Abs(m.LiquidityB-want) > 1e-12 {
		t.Fatalf("liquidity_b = %v, want %v (risk 1 / ln 3)", m.LiquidityB, want)
	}

	// Warm-up match so the bet-limit recalculation has a baseline to read.
	if _, err := matchSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{playerA: 5, playerB: 5}, time.Now().Add(-2*time.Hour), newMatchOpts(t)); err != nil {
		t.Fatalf("warm-up AddMatch: %v", err)
	}
	setBetLimit(t, pool, playerA, 100) // after the warm-up: it rewrites participants' limits

	outcomeA := marketOutcomeID(t, ctx, marketSvc, market.ID, "player", playerA)
	outcomeU := marketOutcomeID(t, ctx, marketSvc, market.ID, "player", playerB)

	// Saturate: 40 one-share buys of playerA drive its probability to exactly
	// 1.0 (a q gap of ~37·b is enough; 40 leaves margin).
	for i := 0; i < 40; i++ {
		if err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, playerA, outcomeA, 1); err != nil {
			t.Fatalf("saturation buy %d: %v", i+1, err)
		}
	}
	saturated := liveProbability(t, ctx, marketSvc, market.ID, outcomeA)
	if saturated != 1 {
		t.Fatalf("leader probability after saturation = %v, want exactly 1", saturated)
	}

	// 1. The leader buy at displayed price 1.00 — the UI sends the saturated
	// probability it shows; expected_probability 1 must be accepted.
	leaderBet, err := marketSvc.PlaceBet(ctx, newID(t), market.ID, playerA, outcomeA, 1, 1)
	if err != nil {
		t.Fatalf("PlaceBet on the saturated leader (expected_probability 1): %v", err)
	}
	if !approxEqRel(leaderBet.CostPerShare, 1, 1e-12) {
		t.Errorf("leader cost/share = %.17g, want ~1", leaderBet.CostPerShare)
	}

	// 2. The underdog share at displayed price 0.00 — the true dust cost must
	// be charged (positive, far below display precision) instead of the
	// cancelled 0 that tripped the cost > 0 constraint.
	underdogBet, err := placeBetAtCurrentPriceReturningOutcome(ctx, t, marketSvc, market.ID, playerU, outcomeU, 1)
	if err != nil {
		t.Fatalf("PlaceBet on the saturated underdog: %v", err)
	}
	if underdogBet.CostPerShare <= 0 || underdogBet.CostPerShare > 1e-10 {
		t.Errorf("underdog cost/share = %.17g, want the true cost in (0, 1e-10]", underdogBet.CostPerShare)
	}

	// 3. The leader wins: settlement must be zero-sum, with the guarantor
	// losing at most the risked 1 (plus FP dust).
	if _, err := matchSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{playerA: 10, playerB: 2}, time.Now(), newMatchOpts(t)); err != nil {
		t.Fatalf("trigger AddMatch: %v", err)
	}

	var deltaSum float64
	rows, err := pool.Query(ctx, `SELECT elo_staked, elo_earned FROM global_arena_settlement WHERE market_id = $1`, market.ID)
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
		t.Errorf("saturated market settlement not zero-sum: Σ(elo_staked+elo_earned) = %.17g", deltaSum)
	}

	// 41 winning shares pay 41; the guarantor covered the deficit above the
	// ~40 collected. b·ln 3 = 1 bounds the loss.
	guarantorDelta := playerMarketDelta(t, pool, market.ID, guarantor)
	if guarantorDelta < -(1 + 1e-9) {
		t.Errorf("guarantor delta = %.17g, loss exceeds the risked 1 beyond FP dust", guarantorDelta)
	}
}

// liveProbability returns the outcome's current LMSR probability.
func liveProbability(t *testing.T, ctx context.Context, svc elo.IMarketService, marketID, outcomeID idpkg.ID) float64 {
	t.Helper()
	m, err := svc.GetMarket(ctx, marketID)
	if err != nil {
		t.Fatalf("GetMarket: %v", err)
	}
	outcomes, err := svc.ListMarketOutcomesWithPools(ctx, marketID)
	if err != nil {
		t.Fatalf("ListMarketOutcomesWithPools: %v", err)
	}
	q := make([]float64, len(outcomes))
	for i, o := range outcomes {
		q[i] = o.Q
	}
	price := -1.0
	for i, o := range outcomes {
		if o.ID == outcomeID {
			price = elo.MarginalProbabilitiesN(q, m.LiquidityB)[i]
		}
	}
	if price < 0 {
		t.Fatalf("outcome %s not found on market %s", outcomeID, marketID)
	}
	return price
}

// placeBetAtCurrentPriceReturningOutcome is placeBetAtCurrentPrice with the
// PlaceBetOutcome returned, so callers can assert the charged cost.
func placeBetAtCurrentPriceReturningOutcome(ctx context.Context, t *testing.T, svc elo.IMarketService, marketID, playerID idpkg.ID, outcomeID idpkg.ID, shares float64) (elo.PlaceBetOutcome, error) {
	t.Helper()
	price := liveProbability(t, ctx, svc, marketID, outcomeID)
	return svc.PlaceBet(ctx, newID(t), marketID, playerID, outcomeID, shares, price)
}

func approxEqRel(a, b, rel float64) bool {
	return math.Abs(a-b) <= rel*math.Max(math.Abs(a), math.Abs(b))
}
