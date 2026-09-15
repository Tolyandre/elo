//go:build integration

package integration_test

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/elo"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

// TestMarketSettlement_MatchTriggered verifies that adding a match that satisfies a
// match_winner market resolves the market and creates market_settlement global_arena_settlement rows.
func TestMarketSettlement_MatchTriggered(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	playerA := createTestPlayer(t, pool, "PlayerA")
	playerB := createTestPlayer(t, pool, "PlayerB")
	guarantor := createTestPlayer(t, pool, "PlayerBGuarantor")
	gameID := createTestGame(t, pool, "Poker")
	adminID := createTestAdmin(t, pool)

	matchSvc := elo.NewMatchService(pool, elo.NewMarketService(pool))
	marketSvc := elo.NewMarketService(pool)

	// Create a match_winner market: who wins a match with playerA and playerB?
	// Markets are created without guarantors (ADR-20): back it with a voluntary
	// zero-fee wager so the market becomes tradable.
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
	setBetLimit(t, pool, guarantor, 16)
	joinGuarantee(ctx, t, marketSvc, market.ID, guarantor)

	// Give players enough bet limit by adding a warm-up match first
	_, err = matchSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{playerA: 5, playerB: 5}, time.Now().Add(-2*time.Hour), newMatchOpts(t))
	if err != nil {
		t.Fatalf("warm-up AddMatch: %v", err)
	}

	// Both players bet: A bets on their own win outcome, B bets on "other"
	// Bet limit after a starting-Elo match = K/(1+1) = 16; use 1-share buys (cost < 1 elo) to stay within it.
	outcomeA := marketOutcomeID(t, ctx, marketSvc, market.ID, "player", playerA)
	outcomeOther := marketOutcomeID(t, ctx, marketSvc, market.ID, "other", "")
	if _, err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, playerA, outcomeA, 1); err != nil {
		t.Fatalf("PlaceBet playerA: %v", err)
	}
	if _, err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, playerB, outcomeOther, 1); err != nil {
		t.Fatalf("PlaceBet playerB: %v", err)
	}

	// Add a match where playerA wins (higher score)
	_, err = matchSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{playerA: 10, playerB: 2}, time.Now(), newMatchOpts(t))
	if err != nil {
		t.Fatalf("AddMatch (trigger): %v", err)
	}

	// Market must now be resolved with playerA's win outcome
	q := db.New(pool)
	m, err := q.GetMarket(ctx, market.ID)
	if err != nil {
		t.Fatalf("GetMarket: %v", err)
	}
	if m.Status != "resolved" {
		t.Errorf("market status = %q, want %q", m.Status, "resolved")
	}
	if m.ResolutionOutcome == nil || *m.ResolutionOutcome != outcomeA {
		t.Errorf("market resolution_outcome = %v, want playerA's outcome %q", m.ResolutionOutcome, outcomeA)
	}

	// Both players must have a market_settlement settlement row
	if c := marketSettlementRatingCount(t, pool, playerA); c != 1 {
		t.Errorf("playerA: expected 1 market_settlement row, got %d", c)
	}
	if c := marketSettlementRatingCount(t, pool, playerB); c != 1 {
		t.Errorf("playerB: expected 1 market_settlement row, got %d", c)
	}

	// Winner (playerA) should have gained elo from the settlement (1 winning
	// share pays 1, cost < 1); loser (playerB) should have lost their cost.
	// We check by comparing their final ratings: playerA's market-settlement rating > pre-settlement.
	allRowsA := playerRatingRows(t, pool, playerA)
	// Find the last two rows: second-to-last is match, last is market settlement (or vice versa)
	// The key invariant: the settlement winner's final rating > initial rating
	if len(allRowsA) < 2 {
		t.Fatalf("playerA: expected at least 2 settlement rows (match + market), got %d", len(allRowsA))
	}
	finalA := allRowsA[len(allRowsA)-1].Rating
	finalB := latestRating(t, pool, playerB)
	// playerA won the bet (net > 0), playerB lost their cost → final elo A > B
	if finalA <= finalB {
		t.Errorf("after settlement: playerA Elo (%.2f) should exceed playerB Elo (%.2f)", finalA, finalB)
	}
}

// TestRecalculation_IdempotencyForMarkets is the critical regression test for the bug where
// recalculation used GetPlayerLatestGlobalElo (unbounded) instead of GetPlayerLatestGlobalEloAtDate,
// causing market settlements to read a stale future rating.
//
// Sequence:
//  1. M1 at T1  (A, B)
//  2. Create market_winner market, both place bets
//  3. M2 at T2 > T1 that triggers market resolution
//  4. M3 at T3 > T2 (A, B)
//  5. Snapshot final ratings for A and B
//  6. Trigger recalculation by updating M1 with identical data
//  7. Assert ratings match the snapshot exactly
func TestRecalculation_IdempotencyForMarkets(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	playerA := createTestPlayer(t, pool, "RecalcA")
	playerB := createTestPlayer(t, pool, "RecalcB")
	guarantor := createTestPlayer(t, pool, "RecalcBGuarantor")
	gameID := createTestGame(t, pool, "Domino")
	adminID := createTestAdmin(t, pool)

	now := time.Now().Truncate(time.Second)
	t1 := now.Add(-3 * time.Hour)
	t2 := now.Add(-2 * time.Hour)
	t3 := now.Add(-1 * time.Hour)

	matchSvc := elo.NewMatchService(pool, elo.NewMarketService(pool))
	marketSvc := elo.NewMarketService(pool)

	// 1. M1
	m1, err := matchSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{playerA: 5, playerB: 5}, t1, newMatchOpts(t))
	if err != nil {
		t.Fatalf("M1 AddMatch: %v", err)
	}

	// 2. Create market and place bets
	market, err := marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
		ID: newID(t),
		// StartsAt must be AFTER t1 so that M1 (at t1) cannot trigger this market
		// during recalculation (the market didn't exist yet when M1 first ran).
		MarketType: "match_winner",
		StartsAt:   t1.Add(30 * time.Minute),
		// well in the future so the expiry timer doesn't fire during the test
		ClosesAt:  now.Add(24 * time.Hour),
		CreatedBy: adminID,
		MatchWinner: &elo.MatchWinnerCreateParams{
			TargetPlayerIDs:   []idpkg.ID{playerA, playerB},
			AllowOtherPlayers: true,
		},
	})
	if err != nil {
		t.Fatalf("CreateMarket: %v", err)
	}
	setBetLimit(t, pool, guarantor, 16)
	joinGuarantee(ctx, t, marketSvc, market.ID, guarantor)
	// Bet limit after a starting-Elo match = K/(1+1) = 16; use 1-share buys (cost < 1 elo) to stay within it.
	outcomeA := marketOutcomeID(t, ctx, marketSvc, market.ID, "player", playerA)
	outcomeOther := marketOutcomeID(t, ctx, marketSvc, market.ID, "other", "")
	if _, err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, playerA, outcomeA, 1); err != nil {
		t.Fatalf("PlaceBet playerA: %v", err)
	}
	if _, err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, playerB, outcomeOther, 1); err != nil {
		t.Fatalf("PlaceBet playerB: %v", err)
	}

	// 3. M2 triggers market resolution (playerA wins)
	_, err = matchSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{playerA: 10, playerB: 2}, t2, newMatchOpts(t))
	if err != nil {
		t.Fatalf("M2 AddMatch: %v", err)
	}

	// 4. M3 after settlement
	_, err = matchSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{playerA: 7, playerB: 8}, t3, newMatchOpts(t))
	if err != nil {
		t.Fatalf("M3 AddMatch: %v", err)
	}

	// 5. Snapshot
	snapshotA := latestRating(t, pool, playerA)
	snapshotB := latestRating(t, pool, playerB)

	// 6. Trigger recalculation via UpdateMatch on M1 with identical data
	_, err = matchSvc.UpdateMatch(ctx, m1.ID, gameID, map[idpkg.ID]float64{playerA: 5, playerB: 5}, t1, elo.UpdateMatchOpts{})
	if err != nil {
		t.Fatalf("UpdateMatch (recalc trigger): %v", err)
	}

	// 7. Assert final ratings match the snapshot
	afterA := latestRating(t, pool, playerA)
	afterB := latestRating(t, pool, playerB)

	const epsilon = 0.0001
	if diff := afterA - snapshotA; diff < -epsilon || diff > epsilon {
		t.Errorf("playerA: after recalc rating=%.6f, want %.6f (diff=%.6f)", afterA, snapshotA, diff)
	}
	if diff := afterB - snapshotB; diff < -epsilon || diff > epsilon {
		t.Errorf("playerB: after recalc rating=%.6f, want %.6f (diff=%.6f)", afterB, snapshotB, diff)
	}
}

// TestMarketSettlement_FixedOddsZeroSum verifies the share-buying guarantees:
//   - a market without guarantors is created but untradable (b = 0 — ADR-20:
//     the limit-LMSR would hand out free longshot shares with nobody to pay
//     the winners), and backing it with a wager makes it tradable;
//   - each buy stores shares (each winning share pays 1 at resolution);
//   - after settlement, elo is strictly conserved across buyers + guarantors
//     (Σ (elo_staked + elo_earned) == 0 over the market's settlement rows);
//   - the sole guarantor absorbs the full residual (deficit or surplus).
func TestMarketSettlement_FixedOddsZeroSum(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	playerA := createTestPlayer(t, pool, "FxoA")
	playerB := createTestPlayer(t, pool, "FxoB")
	guarantor := createTestPlayer(t, pool, "FxoGuarantor")
	gameID := createTestGame(t, pool, "FixGame")
	adminID := createTestAdmin(t, pool)

	matchSvc := elo.NewMatchService(pool, elo.NewMarketService(pool))
	marketSvc := elo.NewMarketService(pool)

	// 1. A guarantor-less market is created fine but rejects bets until a
	// guarantor backs it.
	bare, err := marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
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
		t.Fatalf("CreateMarket without guarantors: %v", err)
	}
	bareOutcome := marketOutcomeID(t, ctx, marketSvc, bare.ID, "player", playerA)
	if _, err := placeBetAtCurrentPrice(ctx, t, marketSvc, bare.ID, playerA, bareOutcome, 1); !errors.Is(err, elo.ErrMarketNeedsGuarantor) {
		t.Fatalf("expected ErrMarketNeedsGuarantor on a guarantor-less market, got %v", err)
	}

	// 2. Create a market backed by a sole guarantor.
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
	setBetLimit(t, pool, guarantor, 16)
	joinGuarantee(ctx, t, marketSvc, market.ID, guarantor)

	// Warm-up match so players have a bet limit > 0.
	if _, err := matchSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{playerA: 5, playerB: 5}, time.Now().Add(-2*time.Hour), newMatchOpts(t)); err != nil {
		t.Fatalf("warm-up AddMatch: %v", err)
	}

	// 3. Buy shares (1 share of playerA's win outcome vs 2 shares of "other" —
	// asymmetric so the settlement residual is non-zero); the AMM-priced cost
	// (elo spent) and shares are stored server-side.
	outcomeA := marketOutcomeID(t, ctx, marketSvc, market.ID, "player", playerA)
	outcomeOther := marketOutcomeID(t, ctx, marketSvc, market.ID, "other", "")
	if _, err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, playerA, outcomeA, 1); err != nil {
		t.Fatalf("PlaceBet playerA: %v", err)
	}
	if _, err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, playerB, outcomeOther, 2); err != nil {
		t.Fatalf("PlaceBet playerB: %v", err)
	}

	sharesA, sharesB := readBetShares(t, pool, market.ID, playerA), readBetShares(t, pool, market.ID, playerB)
	// Shares-driven buys store exactly the shares asked for.
	if math.Abs(sharesA-1) > 1e-9 || math.Abs(sharesB-2) > 1e-9 {
		t.Errorf("shares = %v/%v, want 1/2 (as asked)", sharesA, sharesB)
	}
	// The cost is the average price over the bought interval — below the share
	// count (price < 1).
	amountA, amountB := readBetCost(t, pool, market.ID, playerA), readBetCost(t, pool, market.ID, playerB)
	if amountA <= 0 || amountA >= 1 {
		t.Errorf("playerA amount = %v, want it in (0, 1) at fresh 50/50 LMSR state", amountA)
	}
	if amountB <= 0 || amountB >= 2 {
		t.Errorf("playerB amount = %v, want it in (0, 2)", amountB)
	}

	// 4. Trigger resolution: playerA (YES) wins.
	if _, err := matchSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{playerA: 10, playerB: 2}, time.Now(), newMatchOpts(t)); err != nil {
		t.Fatalf("trigger AddMatch: %v", err)
	}

	// 5. Strict zero-sum across all market settlement rows (buyers + guarantor).
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

	// 6. The sole guarantor absorbs the residual exactly:
	//    collected(amountA+amountB) − paid(sharesA), since each winning YES share
	//    pays 1.
	expectedResidual := (amountA + amountB) - sharesA
	guarantorDelta := playerMarketDelta(t, pool, market.ID, guarantor)
	gotGuarantorRow := guarantorDelta != 0 || math.Abs(expectedResidual) < 1e-9
	if !gotGuarantorRow {
		t.Errorf("expected a guarantor settlement row for %s", guarantor)
	}
	if math.Abs(guarantorDelta-expectedResidual) > 1e-6 {
		t.Errorf("guarantor delta = %.6f, want residual %.6f", guarantorDelta, expectedResidual)
	}

	// 7. Winner (playerA) payout == their shares; loser (playerB) payout == 0.
	if got := playerMarketEarned(t, pool, market.ID, playerA); math.Abs(got-sharesA) > 1e-6 {
		t.Errorf("playerA earned = %.6f, want shares %.6f", got, sharesA)
	}
	if got := playerMarketEarned(t, pool, market.ID, playerB); math.Abs(got) > 1e-6 {
		t.Errorf("playerB earned = %.6f, want 0 (loser)", got)
	}

	const epsilon = 1e-6
	if math.Abs(deltaSum) > epsilon {
		t.Errorf("market settlement not zero-sum: Σ(elo_staked+elo_earned) = %.6f (must be 0)", deltaSum)
	}
}

// TestMarketSettlement_GuarantorBuysOwnMarket verifies the ADR-10 guarantee that
// a player may be both buyer and guarantor (the creator's player is prefilled as
// guarantor): the guarantor can buy on their own market, and at settlement they
// get one settlement row per role — a 'market' row carrying the buy P&L and a
// 'market_guarantor' row carrying their residual share — keeping elo strictly
// conserved. Both rows share the same post-market balances so the latest-at-date
// elo/rating read is correct whichever row the id tie-break picks. The
// per-guarantor payout rollup shows only the guarantor-role row.
func TestMarketSettlement_GuarantorBuysOwnMarket(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	playerA := createTestPlayer(t, pool, "OwnGuarA") // buyer + sole guarantor
	playerB := createTestPlayer(t, pool, "OwnGuarB")
	gameID := createTestGame(t, pool, "OwnGuarGame")
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
			TargetPlayerIDs:   []idpkg.ID{playerA, playerB},
			AllowOtherPlayers: true,
		},
	})
	if err != nil {
		t.Fatalf("CreateMarket: %v", err)
	}

	if _, err := matchSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{playerA: 5, playerB: 5}, time.Now().Add(-2*time.Hour), newMatchOpts(t)); err != nil {
		t.Fatalf("warm-up AddMatch: %v", err)
	}

	// playerA becomes the sole guarantor (risk 16) and also buys — the wager
	// and the buy both reserve against the betting limit, so fund both.
	setBetLimit(t, pool, playerA, 20)
	joinGuarantee(ctx, t, marketSvc, market.ID, playerA)

	// The guarantor (playerA) buys 1 share of their own win outcome on their own
	// market; playerB buys 2 shares of "other" (asymmetric so the residual is
	// non-zero).
	outcomeA := marketOutcomeID(t, ctx, marketSvc, market.ID, "player", playerA)
	outcomeOther := marketOutcomeID(t, ctx, marketSvc, market.ID, "other", "")
	if _, err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, playerA, outcomeA, 1); err != nil {
		t.Fatalf("PlaceBet playerA (guarantor buying own market): %v", err)
	}
	if _, err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, playerB, outcomeOther, 2); err != nil {
		t.Fatalf("PlaceBet playerB: %v", err)
	}

	sharesA := readBetShares(t, pool, market.ID, playerA)
	amountA, amountB := readBetCost(t, pool, market.ID, playerA), readBetCost(t, pool, market.ID, playerB)

	// Resolve YES (playerA wins).
	if _, err := matchSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{playerA: 10, playerB: 2}, time.Now(), newMatchOpts(t)); err != nil {
		t.Fatalf("trigger AddMatch: %v", err)
	}

	// playerA must have exactly TWO settlement rows: one per role (UNIQUE
	// (market_id, player_id, discriminator)) — the buy P&L in 'market' and the
	// guarantor residual share in 'market_guarantor'.
	var rowCount int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM global_arena_settlement WHERE market_id = $1 AND player_id = $2`,
		market.ID, playerA,
	).Scan(&rowCount); err != nil {
		t.Fatalf("count playerA rows: %v", err)
	}
	if rowCount != 2 {
		t.Errorf("playerA: expected 2 settlement rows (buyer + guarantor), got %d", rowCount)
	}

	// The rows are per-row checkpoints (ADR-21): the buyer row applies its P&L
	// to the pre-market balance, and the guarantor row (written second, higher
	// id) accumulates the residual share on top — landing on the post-market
	// balance that latest-at-date reads pick up.
	var buyerElo, buyerRating, guarantorElo, guarantorRating float64
	if err := pool.QueryRow(ctx,
		`SELECT elo_after, rating_after FROM global_arena_settlement
		 WHERE market_id = $1 AND player_id = $2 AND discriminator = 'market'`,
		market.ID, playerA,
	).Scan(&buyerElo, &buyerRating); err != nil {
		t.Fatalf("read playerA buyer row: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT elo_after, rating_after FROM global_arena_settlement
		 WHERE market_id = $1 AND player_id = $2 AND discriminator = 'market_guarantor'`,
		market.ID, playerA,
	).Scan(&guarantorElo, &guarantorRating); err != nil {
		t.Fatalf("read playerA guarantor row: %v", err)
	}

	// Total delta: −amountA (bought) + sharesA (won) + residual (sole guarantor)
	// = amountB; playerB loses amountB. Strict zero-sum overall.
	const epsilon = 1e-6
	expectedResidual := (amountA + amountB) - sharesA
	if math.Abs((guarantorElo-buyerElo)-expectedResidual) > epsilon {
		t.Errorf("playerA rows: guarantor−buyer elo after = %.6f, want residual %.6f",
			guarantorElo-buyerElo, expectedResidual)
	}
	if math.Abs((guarantorRating-buyerRating)-expectedResidual) > epsilon {
		t.Errorf("playerA rows: guarantor−buyer rating after = %.6f, want residual %.6f",
			guarantorRating-buyerRating, expectedResidual)
	}

	if got := playerMarketDelta(t, pool, market.ID, playerA); math.Abs(got-amountB) > epsilon {
		t.Errorf("playerA total delta = %.6f, want +%.6f (amountB)", got, amountB)
	}
	if got := playerMarketDelta(t, pool, market.ID, playerB); math.Abs(got+amountB) > epsilon {
		t.Errorf("playerB delta = %.6f, want -%.6f", got, amountB)
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
	if math.Abs(deltaSum) > epsilon {
		t.Errorf("market settlement not zero-sum: Σ(elo_staked+elo_earned) = %.6f (must be 0)", deltaSum)
	}

	// The per-guarantor payout rollup must include only playerA's guarantor-role
	// row (the house result: the residual share, without the buy P&L).
	expGuarantorStaked := math.Max(-expectedResidual, 0)
	expGuarantorEarned := math.Max(expectedResidual, 0)
	rollup, err := db.New(pool).GetMarketGuarantorPayouts(ctx, market.ID)
	if err != nil {
		t.Fatalf("GetMarketGuarantorPayouts: %v", err)
	}
	found := false
	for _, r := range rollup {
		if r.PlayerID == playerA {
			found = true
			if math.Abs(r.Staked-expGuarantorStaked) > epsilon || math.Abs(r.Earned-expGuarantorEarned) > epsilon {
				t.Errorf("guarantor rollup for playerA = (staked %.6f, earned %.6f), want (%.6f, %.6f)",
					r.Staked, r.Earned, expGuarantorStaked, expGuarantorEarned)
			}
		}
	}
	if !found {
		t.Errorf("guarantor rollup does not include playerA (buyer + guarantor)")
	}
}
