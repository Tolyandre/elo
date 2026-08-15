//go:build integration

package integration_test

import (
	"context"
	"testing"

	"github.com/tolyandre/elo-web-service/pkg/db"
)

// TestMigrateMarketShares exercises the in-process data-migration runner (the
// startup path the regular tests bypass). It verifies that:
//   - pre-LMSR resolved markets (q_yes=q_no=0) get bets.shares backfilled to
//     amount × totalPool/pool_of_outcome (so shares × 1 reproduces the historical
//     parimutuel payout for winners);
//   - the run is idempotent (re-running is a no-op);
//   - the guard skips post-LMSR markets (q_yes>0), so real LMSR shares survive.
func TestMigrateMarketShares(t *testing.T) {
	pool, connStr, cleanup := setupTestDBWithDSN(t)
	defer cleanup()

	ctx := context.Background()
	adminID := createTestAdmin(t, pool)
	playerA := createTestPlayer(t, pool, "MigA")
	playerB := createTestPlayer(t, pool, "MigB")

	// Pre-LMSR resolved market: YES pool 20, NO pool 80 → total 100.
	// Winning side YES → ratio 100/20 = 5.0; losing NO → 100/80 = 1.25.
	// created_at must predate lmsrDeployCutoff (see migrate_data.go) or the
	// backfill skips the market as post-LMSR.
	marketID := newID(t)
	if _, err := pool.Exec(ctx, `
		INSERT INTO markets (id, market_type, status, starts_at, closes_at, created_by, resolved_at, resolution_outcome, q_yes, q_no, created_at)
		VALUES ($1, 'match_winner', 'resolved', NOW(), NOW(), $2, NOW(), 'yes', 0, 0, NOW() - INTERVAL '30 days')
	`, marketID, adminID); err != nil {
		t.Fatalf("seed market: %v", err)
	}
	seedBets := []struct {
		id, player, outcome string
		amount              float64
	}{
		{newID(t), playerA, "yes", 10},
		{newID(t), playerA, "yes", 10},
		{newID(t), playerB, "no", 30},
		{newID(t), playerB, "no", 50},
	}
	for _, b := range seedBets {
		if _, err := pool.Exec(ctx, `
			INSERT INTO bets (id, market_id, player_id, outcome, cost)
			VALUES ($1, $2, $3, $4, $5)
		`, b.id, marketID, b.player, b.outcome, b.amount); err != nil {
			t.Fatalf("seed bet: %v", err)
		}
	}

	// Guard market: a post-LMSR market (q_yes>0) whose real shares must survive.
	guardMarketID := newID(t)
	if _, err := pool.Exec(ctx, `
		INSERT INTO markets (id, market_type, status, starts_at, closes_at, created_by, resolved_at, resolution_outcome, q_yes, q_no, liquidity_b)
		VALUES ($1, 'match_winner', 'resolved', NOW(), NOW(), $2, NOW(), 'yes', 5.0, 0.0, 100)
	`, guardMarketID, adminID); err != nil {
		t.Fatalf("seed guard market: %v", err)
	}
	guardBetID := newID(t)
	if _, err := pool.Exec(ctx, `
		INSERT INTO bets (id, market_id, player_id, outcome, cost, shares)
		VALUES ($1, $2, $3, 'yes', 7, 13.0)
	`, guardBetID, guardMarketID, playerA); err != nil {
		t.Fatalf("seed guard bet: %v", err)
	}

	// Run the startup data-migration runner (calculator + share backfill).
	if err := db.MigrateCalculatorData(ctx, connStr); err != nil {
		t.Fatalf("MigrateCalculatorData: %v", err)
	}

	const epsilon = 1e-9
	assertShares := func(label string, got, want float64) {
		t.Helper()
		if got < want-epsilon || got > want+epsilon {
			t.Errorf("%s shares = %v, want %v", label, got, want)
		}
	}

	// The backfill (c01b9b1 semantics) replays the bets through the LMSR and
	// pins each winning player's share TOTAL to the historical pari-mutuel
	// payout: amount_win × totalPool/winPool. The per-bet split keeps the
	// replay proportions, so assert totals per (player, outcome), not per bet.
	sharesFor := func(playerID, outcome string) float64 {
		var total float64
		if err := pool.QueryRow(ctx, `
			SELECT COALESCE(SUM(shares), 0) FROM bets
			WHERE market_id = $1 AND player_id = $2 AND outcome = $3
		`, marketID, playerID, outcome).Scan(&total); err != nil {
			t.Fatalf("sum shares: %v", err)
		}
		return total
	}

	// Winning side (yes): Alice staked 20 of the 20 yes pool → payout
	// 20 × 100/20 = 100 shares total across her two bets.
	assertShares("winning player total", sharesFor(playerA, "yes"), 100.0)

	// Losing side (no): shares come from the replay only — positive and finite.
	if noTotal := sharesFor(playerB, "no"); noTotal <= 0 {
		t.Errorf("losing player shares total = %v, want > 0", noTotal)
	}

	// Guard bet untouched.
	var guardShares float64
	if err := pool.QueryRow(ctx, `SELECT shares FROM bets WHERE id = $1`, guardBetID).Scan(&guardShares); err != nil {
		t.Fatalf("read guard shares: %v", err)
	}
	assertShares("guard (post-lmsr) bet", guardShares, 13.0)

	// Idempotency: re-running must not change anything.
	if err := db.MigrateCalculatorData(ctx, connStr); err != nil {
		t.Fatalf("MigrateCalculatorData (2nd run): %v", err)
	}
	assertShares("idempotent winning player total", sharesFor(playerA, "yes"), 100.0)
	var guardShares2 float64
	if err := pool.QueryRow(ctx, `SELECT shares FROM bets WHERE id = $1`, guardBetID).Scan(&guardShares2); err != nil {
		t.Fatalf("read guard shares (2nd): %v", err)
	}
	assertShares("idempotent guard bet", guardShares2, 13.0)
}
