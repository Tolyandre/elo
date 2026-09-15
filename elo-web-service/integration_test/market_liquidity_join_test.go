//go:build integration

package integration_test

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"

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

	matchSvc := newMatchService(pool)
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
		if _, err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, playerFav, outcomeFav, 1); err != nil {
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
	m, err := marketSvc.Queries.GetMarket(ctx, market.ID)
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
	outcomes, err := marketSvc.Queries.ListMarketOutcomesWithPools(ctx, market.ID)
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
	if _, err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, playerDog, outcomeDog, 122); !errors.Is(err, elo.ErrBetLimitExceeded) {
		t.Fatalf("122-share underdog buy must exceed the 16-elo bet limit at honest prices, got %v", err)
	}

	// 4b. A single underdog share costs real elo (~0.26 at p ≈ 0.29), not
	// the rescale's dust.
	if _, err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, playerDog, outcomeDog, 1); err != nil {
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
