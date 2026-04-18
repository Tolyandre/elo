//go:build integration

package integration_test

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/elo"
)

// createTestPlayer inserts a player and returns its ID.
func createTestPlayer(t *testing.T, pool *pgxpool.Pool, name string) int32 {
	t.Helper()
	q := db.New(pool)
	p, err := q.CreatePlayer(context.Background(), db.CreatePlayerParams{Name: name})
	if err != nil {
		t.Fatalf("create player %q: %v", name, err)
	}
	return p.ID
}

// createTestGame inserts a game and returns its ID.
func createTestGame(t *testing.T, pool *pgxpool.Pool, name string) int32 {
	t.Helper()
	q := db.New(pool)
	g, err := q.AddGame(context.Background(), name)
	if err != nil {
		t.Fatalf("create game %q: %v", name, err)
	}
	return g.ID
}

// createTestAdmin inserts a user with allow_editing=true and returns its ID.
func createTestAdmin(t *testing.T, pool *pgxpool.Pool) int32 {
	t.Helper()
	q := db.New(pool)
	id, err := q.CreateUser(context.Background(), db.CreateUserParams{
		AllowEditing:        true,
		GoogleOauthUserID:   fmt.Sprintf("admin-%d", time.Now().UnixNano()),
		GoogleOauthUserName: "Admin",
	})
	if err != nil {
		t.Fatalf("create admin user: %v", err)
	}
	return id
}

// playerRatingRows returns all player_ratings rows for a player, ordered by date then id.
func playerRatingRows(t *testing.T, pool *pgxpool.Pool, playerID int32) []db.RatingHistoryRow {
	t.Helper()
	rows, err := db.New(pool).RatingHistory(context.Background(), playerID)
	if err != nil {
		t.Fatalf("rating history for player %d: %v", playerID, err)
	}
	return rows
}

// latestRating returns the most recent player_ratings entry for a player.
func latestRating(t *testing.T, pool *pgxpool.Pool, playerID int32) float64 {
	t.Helper()
	rows := playerRatingRows(t, pool, playerID)
	if len(rows) == 0 {
		t.Fatalf("no rating rows for player %d", playerID)
	}
	return rows[len(rows)-1].Rating
}

// marketSettlementRatingCount returns how many player_ratings rows exist for a player with source_type='market_settlement'.
func marketSettlementRatingCount(t *testing.T, pool *pgxpool.Pool, playerID int32) int {
	t.Helper()
	var count int
	err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM player_ratings WHERE player_id = $1 AND source_type = 'market_settlement'`,
		playerID,
	).Scan(&count)
	if err != nil {
		t.Fatalf("count market_settlement ratings for player %d: %v", playerID, err)
	}
	return count
}

// --- Tests ---

// TestAddMatch_PlayerRatingsCreated verifies that adding a match creates player_ratings rows
// for every participant and that Elo deltas (pay + earn) sum to approximately zero.
func TestAddMatch_PlayerRatingsCreated(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	p1 := createTestPlayer(t, pool, "Alice")
	p2 := createTestPlayer(t, pool, "Bob")
	p3 := createTestPlayer(t, pool, "Carol")
	gameID := createTestGame(t, pool, "Catan")

	svc := elo.NewMatchService(pool, elo.NewMarketService(pool))
	_, err := svc.AddMatch(ctx, gameID, map[int32]float64{p1: 10, p2: 5, p3: 1}, time.Now())
	if err != nil {
		t.Fatalf("AddMatch: %v", err)
	}

	// Each player must have exactly one rating row after a single match.
	for _, pid := range []int32{p1, p2, p3} {
		rows := playerRatingRows(t, pool, pid)
		if len(rows) != 1 {
			t.Errorf("player %d: expected 1 rating row, got %d", pid, len(rows))
		}
	}

	// Check sum of all ratings equals 3 * startingElo (Elo is zero-sum across players)
	const startingElo = 1000.0
	var ratingsSum float64
	for _, pid := range []int32{p1, p2, p3} {
		ratingsSum += latestRating(t, pool, pid)
	}
	const epsilon = 0.001
	expected := float64(3) * startingElo
	if diff := ratingsSum - expected; diff < -epsilon || diff > epsilon {
		t.Errorf("sum of ratings = %.4f, want %.4f (zero-sum property)", ratingsSum, expected)
	}
}

// TestAddMatch_EloOrderPreserved verifies that after a match the highest scorer
// has a higher Elo than the lowest scorer.
func TestAddMatch_EloOrderPreserved(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	winner := createTestPlayer(t, pool, "Winner")
	loser := createTestPlayer(t, pool, "Loser")
	gameID := createTestGame(t, pool, "Chess")

	svc := elo.NewMatchService(pool, elo.NewMarketService(pool))
	_, err := svc.AddMatch(ctx, gameID, map[int32]float64{winner: 10, loser: 1}, time.Now())
	if err != nil {
		t.Fatalf("AddMatch: %v", err)
	}

	winnerElo := latestRating(t, pool, winner)
	loserElo := latestRating(t, pool, loser)
	if winnerElo <= loserElo {
		t.Errorf("expected winner Elo (%.2f) > loser Elo (%.2f)", winnerElo, loserElo)
	}
}

// TestMarketSettlement_MatchTriggered verifies that adding a match that satisfies a
// match_winner market resolves the market and creates market_settlement player_ratings rows.
func TestMarketSettlement_MatchTriggered(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	playerA := createTestPlayer(t, pool, "PlayerA")
	playerB := createTestPlayer(t, pool, "PlayerB")
	gameID := createTestGame(t, pool, "Poker")
	adminID := createTestAdmin(t, pool)

	matchSvc := elo.NewMatchService(pool, elo.NewMarketService(pool))
	marketSvc := elo.NewMarketService(pool)

	// Create a match_winner market: does playerA win a match that includes playerB?
	market, err := marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
		MarketType: "match_winner",
		StartsAt:   time.Now().Add(-time.Minute),
		ClosesAt:   time.Now().Add(24 * time.Hour),
		CreatedBy:  adminID,
		MatchWinner: &elo.MatchWinnerCreateParams{
			TargetPlayerID:    playerA,
			RequiredPlayerIDs: []int32{playerB},
		},
	})
	if err != nil {
		t.Fatalf("CreateMarket: %v", err)
	}

	// Give players enough bet limit by adding a warm-up match first
	_, err = matchSvc.AddMatch(ctx, gameID, map[int32]float64{playerA: 5, playerB: 5}, time.Now().Add(-2*time.Hour))
	if err != nil {
		t.Fatalf("warm-up AddMatch: %v", err)
	}

	// Both players bet: A bets yes (they win), B bets no
	// Bet limit after a starting-Elo match = K/(1+1) = 16; use 10 to stay within it.
	if err := marketSvc.PlaceBet(ctx, market.ID, playerA, "yes", 10); err != nil {
		t.Fatalf("PlaceBet playerA: %v", err)
	}
	if err := marketSvc.PlaceBet(ctx, market.ID, playerB, "no", 10); err != nil {
		t.Fatalf("PlaceBet playerB: %v", err)
	}

	// Add a match where playerA wins (higher score)
	_, err = matchSvc.AddMatch(ctx, gameID, map[int32]float64{playerA: 10, playerB: 2}, time.Now())
	if err != nil {
		t.Fatalf("AddMatch (trigger): %v", err)
	}

	// Market must now be resolved with outcome "yes"
	q := db.New(pool)
	m, err := q.GetMarketWithPools(ctx, market.ID)
	if err != nil {
		t.Fatalf("GetMarketWithPools: %v", err)
	}
	if m.Status != "resolved" {
		t.Errorf("market status = %q, want %q", m.Status, "resolved")
	}
	if !m.ResolutionOutcome.Valid || m.ResolutionOutcome.String != "yes" {
		t.Errorf("market resolution_outcome = %v, want \"yes\"", m.ResolutionOutcome)
	}

	// Both players must have a market_settlement rating row
	if c := marketSettlementRatingCount(t, pool, playerA); c != 1 {
		t.Errorf("playerA: expected 1 market_settlement row, got %d", c)
	}
	if c := marketSettlementRatingCount(t, pool, playerB); c != 1 {
		t.Errorf("playerB: expected 1 market_settlement row, got %d", c)
	}

	// Winner (playerA) should have gained ELo from the settlement (earned 100, staked 50 → +50)
	// Loser (playerB) should have lost Elo (-50).
	// We check by comparing their final ratings: playerA's market-settlement rating > pre-settlement.
	allRowsA := playerRatingRows(t, pool, playerA)
	// Find the last two rows: second-to-last is match, last is market settlement (or vice versa)
	// The key invariant: the settlement winner's final rating > initial rating
	if len(allRowsA) < 2 {
		t.Fatalf("playerA: expected at least 2 rating rows (match + market), got %d", len(allRowsA))
	}
	finalA := allRowsA[len(allRowsA)-1].Rating
	finalB := latestRating(t, pool, playerB)
	// playerA won the bet: +50 → final ELo higher than playerB who lost -50
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
	gameID := createTestGame(t, pool, "Domino")
	adminID := createTestAdmin(t, pool)

	now := time.Now().Truncate(time.Second)
	t1 := now.Add(-3 * time.Hour)
	t2 := now.Add(-2 * time.Hour)
	t3 := now.Add(-1 * time.Hour)

	matchSvc := elo.NewMatchService(pool, elo.NewMarketService(pool))
	marketSvc := elo.NewMarketService(pool)

	// 1. M1
	m1, err := matchSvc.AddMatch(ctx, gameID, map[int32]float64{playerA: 5, playerB: 5}, t1)
	if err != nil {
		t.Fatalf("M1 AddMatch: %v", err)
	}

	// 2. Create market and place bets
	market, err := marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
		MarketType: "match_winner",
		// StartsAt must be AFTER t1 so that M1 (at t1) cannot trigger this market
		// during recalculation (the market didn't exist yet when M1 first ran).
		StartsAt: t1.Add(30 * time.Minute),
		ClosesAt: now.Add(24 * time.Hour), // well in the future so the expiry timer doesn't fire during the test
		CreatedBy: adminID,
		MatchWinner: &elo.MatchWinnerCreateParams{
			TargetPlayerID:    playerA,
			RequiredPlayerIDs: []int32{playerB},
		},
	})
	if err != nil {
		t.Fatalf("CreateMarket: %v", err)
	}
	// Bet limit after a starting-Elo match = K/(1+1) = 16; use 10 to stay within it.
	if err := marketSvc.PlaceBet(ctx, market.ID, playerA, "yes", 10); err != nil {
		t.Fatalf("PlaceBet playerA: %v", err)
	}
	if err := marketSvc.PlaceBet(ctx, market.ID, playerB, "no", 10); err != nil {
		t.Fatalf("PlaceBet playerB: %v", err)
	}

	// 3. M2 triggers market resolution (playerA wins)
	_, err = matchSvc.AddMatch(ctx, gameID, map[int32]float64{playerA: 10, playerB: 2}, t2)
	if err != nil {
		t.Fatalf("M2 AddMatch: %v", err)
	}

	// 4. M3 after settlement
	_, err = matchSvc.AddMatch(ctx, gameID, map[int32]float64{playerA: 7, playerB: 8}, t3)
	if err != nil {
		t.Fatalf("M3 AddMatch: %v", err)
	}

	// 5. Snapshot
	snapshotA := latestRating(t, pool, playerA)
	snapshotB := latestRating(t, pool, playerB)

	// 6. Trigger recalculation via UpdateMatch on M1 with identical data
	_, err = matchSvc.UpdateMatch(ctx, m1.ID, gameID, map[int32]float64{playerA: 5, playerB: 5}, t1)
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

// TestUpdateMatch_RejectsDateChangeWhenBetPrecedes verifies that moving a match to an earlier
// date is rejected when doing so would make the market resolve before some bets were placed.
//
// The key invariant: bet.placed_at must be < market.resolved_at (the match's domain date).
// If moving the match makes resolved_at earlier than some bet's placed_at, reject.
//
// Sequence:
//  1. Warm-up match (past) to give bet limits.
//  2. Create market (starts_at in past, closes_at far future).
//  3. Players place bets at server-now (placed_at ≈ now).
//  4. M2 at T_future (now+2h) triggers market resolution; resolved_at = now+2h > placed_at ✓.
//  5. Attempt to move M2 to T_past (now-30min) < placed_at → ErrHistoryChangeConflict.
func TestUpdateMatch_RejectsDateChangeWhenBetPrecedes(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	playerA := createTestPlayer(t, pool, "ConflictA")
	playerB := createTestPlayer(t, pool, "ConflictB")
	gameID := createTestGame(t, pool, "Checkers")
	adminID := createTestAdmin(t, pool)

	now := time.Now().Truncate(time.Second)
	tWarmup := now.Add(-2 * time.Hour)  // warm-up match to give bet limits
	tFuture := now.Add(2 * time.Hour)   // M2 original date (future game)
	tPast := now.Add(-30 * time.Minute) // target date for M2 (before bets placed at ~now)

	matchSvc := elo.NewMatchService(pool, elo.NewMarketService(pool))
	marketSvc := elo.NewMarketService(pool)

	// 1. Warm-up match: gives players a bet limit of K/(1+1) ≈ 16.
	_, err := matchSvc.AddMatch(ctx, gameID, map[int32]float64{playerA: 5, playerB: 5}, tWarmup)
	if err != nil {
		t.Fatalf("warm-up AddMatch: %v", err)
	}

	// 2. Market covering the upcoming game (starts in past, covers tFuture).
	market, err := marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
		MarketType: "match_winner",
		StartsAt:   now.Add(-time.Hour),
		ClosesAt:   now.Add(24 * time.Hour),
		CreatedBy:  adminID,
		MatchWinner: &elo.MatchWinnerCreateParams{
			TargetPlayerID:    playerA,
			RequiredPlayerIDs: []int32{playerB},
		},
	})
	if err != nil {
		t.Fatalf("CreateMarket: %v", err)
	}

	// 3. Bets placed NOW (placed_at ≈ now, before tFuture = now+2h).
	if err := marketSvc.PlaceBet(ctx, market.ID, playerA, "yes", 10); err != nil {
		t.Fatalf("PlaceBet playerA: %v", err)
	}
	if err := marketSvc.PlaceBet(ctx, market.ID, playerB, "no", 10); err != nil {
		t.Fatalf("PlaceBet playerB: %v", err)
	}

	// 4. M2 with a future domain date triggers resolution; resolved_at = tFuture > placed_at ✓.
	m2, err := matchSvc.AddMatch(ctx, gameID, map[int32]float64{playerA: 10, playerB: 2}, tFuture)
	if err != nil {
		t.Fatalf("M2 AddMatch: %v", err)
	}

	// 5. Move M2 to tPast (now-30min). This makes resolved_at = now-30min < placed_at (≈now).
	// Bets fall in [now-30min, now+2h) → conflict must be returned.
	_, err = matchSvc.UpdateMatch(ctx, m2.ID, gameID, map[int32]float64{playerA: 10, playerB: 2}, tPast)
	if err == nil {
		t.Fatal("UpdateMatch: expected error, got nil")
	}
	if !errors.Is(err, elo.ErrHistoryChangeConflict) {
		t.Errorf("UpdateMatch: expected ErrHistoryChangeConflict, got: %v", err)
	}
}

// TestMarketExpiry_TimeBasedSettlement verifies that adding a match with a date past a
// market's closes_at triggers time-based expiry and creates market_settlement rows.
func TestMarketExpiry_TimeBasedSettlement(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	playerA := createTestPlayer(t, pool, "ExpiryA")
	playerB := createTestPlayer(t, pool, "ExpiryB")
	gameID := createTestGame(t, pool, "Go")
	adminID := createTestAdmin(t, pool)

	now := time.Now().Truncate(time.Second)
	// Market closes in the future so bets can be placed, but the match date is after closes_at
	// to trigger ExpireMarketsAtDate inside AddMatch.
	tExp := now.Add(30 * time.Minute)
	tMatch := now.Add(2 * time.Hour)

	matchSvc := elo.NewMatchService(pool, elo.NewMarketService(pool))
	marketSvc := elo.NewMarketService(pool)

	// Warm-up match (before market creation) to initialise bet limits.
	_, err := matchSvc.AddMatch(ctx, gameID, map[int32]float64{playerA: 5, playerB: 5}, now.Add(-time.Hour))
	if err != nil {
		t.Fatalf("warm-up match: %v", err)
	}

	// Create a win_streak market that expires before the trigger match.
	market, err := marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
		MarketType: "win_streak",
		StartsAt:   now.Add(-time.Minute),
		ClosesAt:   tExp,
		CreatedBy:  adminID,
		WinStreak: &elo.WinStreakCreateParams{
			TargetPlayerID: playerA,
			GameIDs:        []int32{gameID},
			WinsRequired:   3,
		},
	})
	if err != nil {
		t.Fatalf("CreateMarket: %v", err)
	}

	// Bet limit after starting-Elo warm-up match = K/(1+1) = 16; use 10.
	if err := marketSvc.PlaceBet(ctx, market.ID, playerA, "yes", 10); err != nil {
		t.Fatalf("PlaceBet playerA: %v", err)
	}
	if err := marketSvc.PlaceBet(ctx, market.ID, playerB, "no", 10); err != nil {
		t.Fatalf("PlaceBet playerB: %v", err)
	}

	// Add a match whose date is past closes_at — ExpireMarketsAtDate cancels the market.
	_, err = matchSvc.AddMatch(ctx, gameID, map[int32]float64{playerA: 6, playerB: 4}, tMatch)
	if err != nil {
		t.Fatalf("AddMatch after expiry: %v", err)
	}

	// Market should no longer be open
	q := db.New(pool)
	m, err := q.GetMarketWithPools(ctx, market.ID)
	if err != nil {
		t.Fatalf("GetMarketWithPools: %v", err)
	}
	if m.Status == "open" {
		t.Errorf("market status = %q, expected it to be resolved or cancelled after expiry", m.Status)
	}

	// Both players must have a market_settlement rating row
	if c := marketSettlementRatingCount(t, pool, playerA); c != 1 {
		t.Errorf("playerA: expected 1 market_settlement row after expiry, got %d", c)
	}
	if c := marketSettlementRatingCount(t, pool, playerB); c != 1 {
		t.Errorf("playerB: expected 1 market_settlement row after expiry, got %d", c)
	}
}
