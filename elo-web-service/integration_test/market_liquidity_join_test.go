//go:build integration

package integration_test

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/elo"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

// TestMarketLiquidityJoin_RepricesAndStaysSolvent reproduces dev market
// Cf3FQiH6dYXSn7w7qtCXQ: a thin guarantor (risk 0.1), several favourite buys,
// then a deep guarantor (risk 4). The removed price-preserving q rescale
// (ADR-22) multiplied q by b_new/b_old = 41, priced the underdog at
// e^{-34} ≈ 0 and let a 1-elo all-in buy amass 122.59 shares against 4.1 of
// combined guarantor risk — an unpayable payout. Now the join must reprice
// the market honestly (prices move toward uniform over the fixed q), the
// underdog must cost real elo, and settlement must stay zero-sum with no
// guarantor losing more than their risk.
func TestMarketLiquidityJoin_RepricesAndStaysSolvent(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	playerFav := createTestPlayer(t, pool, "LjqFav")
	playerDog := createTestPlayer(t, pool, "LjqDog")
	guarantorThin := createTestPlayer(t, pool, "LjqThin")
	guarantorDeep := createTestPlayer(t, pool, "LjqDeep")
	gameID := createTestGame(t, pool, "LjqGame")
	adminID := createTestAdmin(t, pool)

	matchSvc := elo.NewMatchService(pool, elo.NewMarketService(pool))
	marketSvc := elo.NewMarketService(pool)

	market, err := marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
		ID:         newID(t),
		MarketType: "match_winner",
		StartsAt:   time.Now().Add(-time.Minute),
		ClosesAt:   time.Now().Add(24 * time.Hour),
		CreatedBy:  adminID,
		MatchWinner: &elo.MatchWinnerCreateParams{
			TargetPlayerIDs:   []idpkg.ID{playerFav, playerDog},
			AllowOtherPlayers: true,
		},
	})
	if err != nil {
		t.Fatalf("CreateMarket: %v", err)
	}

	// Warm-up match so the limit recalculation has a baseline, then fund the
	// traders above its rewrite.
	if _, err := matchSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{playerFav: 5, playerDog: 5}, time.Now().Add(-2*time.Hour), newMatchOpts(t)); err != nil {
		t.Fatalf("warm-up AddMatch: %v", err)
	}
	setBetLimit(t, pool, playerFav, 16)
	setBetLimit(t, pool, playerDog, 16)
	setBetLimit(t, pool, guarantorThin, 16)
	setBetLimit(t, pool, guarantorDeep, 16)

	// 1. Thin guarantor (risk 0.1): b = 0.1/ln 3.
	if _, err := marketSvc.JoinAsGuarantee(ctx, newID(t), market.ID, guarantorThin, 0.1, 0.01); err != nil {
		t.Fatalf("JoinAsGuarantee(thin): %v", err)
	}

	outcomeFav := marketOutcomeID(t, ctx, marketSvc, market.ID, "player", playerFav)
	outcomeDog := marketOutcomeID(t, ctx, marketSvc, market.ID, "player", playerDog)

	// 2. Three one-share favourite buys saturate the thin market (b₁ = 0.091:
	// a q gap of 3 is already ~33·b).
	for i := 0; i < 3; i++ {
		if err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, playerFav, outcomeFav, 1); err != nil {
			t.Fatalf("favourite buy %d: %v", i+1, err)
		}
	}
	pBefore := liveProbability(t, ctx, marketSvc, market.ID, outcomeFav)
	if pBefore < 0.99 {
		t.Fatalf("favourite price on the thin saturated market = %v, want ~1", pBefore)
	}

	// 3. Deep guarantor joins (risk 4): b = 4.1/ln 3. Prices must MOVE (the
	// removed rescale kept them fixed while inflating q 41×).
	if _, err := marketSvc.JoinAsGuarantee(ctx, newID(t), market.ID, guarantorDeep, 4, 0); err != nil {
		t.Fatalf("JoinAsGuarantee(deep): %v", err)
	}
	m, err := marketSvc.GetMarket(ctx, market.ID)
	if err != nil {
		t.Fatalf("GetMarket: %v", err)
	}
	if want := 4.1 / math.Log(3); math.Abs(m.LiquidityB-want) > 1e-12 {
		t.Fatalf("liquidity_b = %v, want %v", m.LiquidityB, want)
	}
	pAfter := liveProbability(t, ctx, marketSvc, market.ID, outcomeFav)
	if !(pAfter < pBefore-0.1) {
		t.Fatalf("join must reprice the favourite down (before %v, after %v)", pBefore, pAfter)
	}
	// q must stay the raw accumulated shares: 3 favourites, no ×41 inflation.
	outcomes, err := marketSvc.ListMarketOutcomesWithPools(ctx, market.ID)
	if err != nil {
		t.Fatalf("ListMarketOutcomesWithPools: %v", err)
	}
	for _, o := range outcomes {
		if o.ID == outcomeFav && math.Abs(o.Q-3) > 1e-9 {
			t.Fatalf("favourite q = %v after the join, want the raw 3 (no rescale)", o.Q)
		}
	}

	// 4a. A toxic-sized underdog buy (the 122 shares the rescale gave away
	// for 1 elo) now costs ~real elo and trips the bet limit.
	if err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, playerDog, outcomeDog, 122); !errors.Is(err, elo.ErrBetLimitExceeded) {
		t.Fatalf("122-share underdog buy must exceed the 16-elo bet limit at honest prices, got %v", err)
	}

	// 4b. A single underdog share costs real elo (~0.26 at p ≈ 0.29), not
	// the rescale's dust.
	if err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, playerDog, outcomeDog, 1); err != nil {
		t.Fatalf("underdog buy: %v", err)
	}
	if dogCost := readBetCost(t, pool, market.ID, playerDog); dogCost < 0.1 {
		t.Errorf("underdog share cost = %v, want real elo (≈0.26), not dust", dogCost)
	}

	// 5. The underdog wins: settlement must be zero-sum, no guarantor loses
	// more than their risk.
	if _, err := matchSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{playerFav: 2, playerDog: 10}, time.Now(), newMatchOpts(t)); err != nil {
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
		t.Errorf("rejoined-market settlement not zero-sum: Σ(elo_staked+elo_earned) = %.17g", deltaSum)
	}
	for _, g := range []struct {
		id   idpkg.ID
		risk float64
	}{{guarantorThin, 0.1}, {guarantorDeep, 4}} {
		if delta := playerMarketDelta(t, pool, market.ID, g.id); delta < -(g.risk + 1e-9) {
			t.Errorf("guarantor %s delta = %.6f, loss exceeds the risked %.2f", g.id, delta, g.risk)
		}
	}
}

// TestRepairRescaledMarkets drives the one-time startup repair (ADR-22) over
// two legacy states manufactured by hand:
//   - a healthy market (only pre-rescale bets): q gets recomputed from the
//     bets and the market stays open at the repriced probabilities;
//   - an insolvent one (a toxic post-rescale bet whose shares the backing
//     cannot cover): the market is cancelled and every bet refunded, so no
//     unpayable payout can materialize at settlement.
func TestRepairRescaledMarkets(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	buyer := createTestPlayer(t, pool, "RepBuyer")
	dogBuyer := createTestPlayer(t, pool, "RepDogBuyer")
	guarantor := createTestPlayer(t, pool, "RepGuarantor")
	gameID := createTestGame(t, pool, "RepGame")
	adminID := createTestAdmin(t, pool)

	matchSvc := elo.NewMatchService(pool, elo.NewMarketService(pool))
	marketSvc := elo.NewMarketService(pool)

	setBetLimit(t, pool, buyer, 16)
	setBetLimit(t, pool, dogBuyer, 16)
	setBetLimit(t, pool, guarantor, 16)

	makeMarket := func(t *testing.T) idpkg.ID {
		t.Helper()
		fav := createTestPlayer(t, pool, randName("RepFav"))
		dog := createTestPlayer(t, pool, randName("RepDog"))
		if _, err := matchSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{fav: 5, dog: 5}, time.Now().Add(-2*time.Hour), newMatchOpts(t)); err != nil {
			t.Fatalf("warm-up AddMatch: %v", err)
		}
		market, err := marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
			ID:         newID(t),
			MarketType: "match_winner",
			StartsAt:   time.Now().Add(-time.Minute),
			ClosesAt:   time.Now().Add(24 * time.Hour),
			CreatedBy:  adminID,
			MatchWinner: &elo.MatchWinnerCreateParams{
				TargetPlayerIDs:   []idpkg.ID{fav, dog},
				AllowOtherPlayers: true,
			},
		})
		if err != nil {
			t.Fatalf("CreateMarket: %v", err)
		}
		if _, err := marketSvc.JoinAsGuarantee(ctx, newID(t), market.ID, guarantor, 4, 0); err != nil {
			t.Fatalf("JoinAsGuarantee: %v", err)
		}
		return market.ID
	}

	// A second guarantor would just split the same risk pool; one is enough.

	healthy := makeMarket(t)
	favOutcome := marketOutcomeID(t, ctx, marketSvc, healthy, "player", marketPlayerID(t, pool, healthy, 0))
	if err := placeBetAtCurrentPrice(ctx, t, marketSvc, healthy, buyer, favOutcome, 1); err != nil {
		t.Fatalf("healthy favourite buy: %v", err)
	}

	insolvent := makeMarket(t)
	insolventFav := marketOutcomeID(t, ctx, marketSvc, insolvent, "player", marketPlayerID(t, pool, insolvent, 0))
	insolventDog := marketOutcomeID(t, ctx, marketSvc, insolvent, "player", marketPlayerID(t, pool, insolvent, 1))
	if err := placeBetAtCurrentPrice(ctx, t, marketSvc, insolvent, buyer, insolventFav, 1); err != nil {
		t.Fatalf("insolvent favourite buy: %v", err)
	}
	// The toxic legacy state: q inflated ×41 and a post-rescale underdog bet
	// of 100 shares bought for dust — exactly what the removed rescale sold.
	if _, err := pool.Exec(ctx, `UPDATE market_outcomes SET q = q * 41 WHERE market_id = $1`, insolvent); err != nil {
		t.Fatalf("simulate rescale: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO bets (id, market_id, player_id, outcome, cost, fee, shares)
		VALUES ($1, $2, $3, $4, 0.5, 0, 100)`, newID(t), insolvent, dogBuyer, insolventDog); err != nil {
		t.Fatalf("insert toxic bet: %v", err)
	}

	if err := marketSvc.RepairRescaledMarkets(ctx); err != nil {
		t.Fatalf("RepairRescaledMarkets: %v", err)
	}

	// The healthy market: q restored to the raw shares, still open.
	if got := marketOutcomeQ(t, pool, healthy, favOutcome); math.Abs(got-1) > 1e-9 {
		t.Errorf("healthy market q = %v, want the raw 1", got)
	}
	if status := marketStatus(t, pool, healthy); status != "open" {
		t.Errorf("healthy market status = %q, want open", status)
	}

	// The insolvent market: cancelled, every bet refunded (cost + fee).
	if status := marketStatus(t, pool, insolvent); status != "cancelled" {
		t.Errorf("insolvent market status = %q, want cancelled", status)
	}
	var refund float64
	if err := pool.QueryRow(ctx, `SELECT elo_earned FROM global_arena_settlement
		WHERE market_id = $1 AND player_id = $2 AND discriminator = 'market'`, insolvent, dogBuyer).Scan(&refund); err != nil {
		t.Fatalf("toxic buyer refund row: %v", err)
	}
	if math.Abs(refund-0.5) > 1e-9 {
		t.Errorf("toxic buyer refund = %v, want the 0.5 cost back", refund)
	}

	// Idempotent: a second pass is a no-op.
	if err := marketSvc.RepairRescaledMarkets(ctx); err != nil {
		t.Fatalf("second RepairRescaledMarkets: %v", err)
	}
	if status := marketStatus(t, pool, insolvent); status != "cancelled" {
		t.Errorf("insolvent market status after second pass = %q, want cancelled", status)
	}
}

// randName keeps the per-test helper players unique.
func randName(prefix string) string {
	return prefix + time.Now().Format("150405.000000000")
}

// marketPlayerID returns the target player of the idx-th (by q desc) player
// outcome of the market — enough for the repair test's favourite/underdog
// lookups without threading the created players through makeMarket.
func marketPlayerID(t *testing.T, pool *pgxpool.Pool, marketID idpkg.ID, idx int) idpkg.ID {
	t.Helper()
	var pid idpkg.ID
	if err := pool.QueryRow(context.Background(), `SELECT player_id FROM market_outcomes
		WHERE market_id = $1 AND kind = 'player' ORDER BY id LIMIT 1 OFFSET $2`, marketID, idx).Scan(&pid); err != nil {
		t.Fatalf("market player %d: %v", idx, err)
	}
	return pid
}

func marketOutcomeQ(t *testing.T, pool *pgxpool.Pool, marketID, outcomeID idpkg.ID) float64 {
	t.Helper()
	var q float64
	if err := pool.QueryRow(context.Background(), `SELECT q FROM market_outcomes WHERE market_id = $1 AND id = $2`, marketID, outcomeID).Scan(&q); err != nil {
		t.Fatalf("outcome q: %v", err)
	}
	return q
}

func marketStatus(t *testing.T, pool *pgxpool.Pool, marketID idpkg.ID) string {
	t.Helper()
	var status string
	if err := pool.QueryRow(context.Background(), `SELECT status FROM markets WHERE id = $1`, marketID).Scan(&status); err != nil {
		t.Fatalf("market status: %v", err)
	}
	return status
}
