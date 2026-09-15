//go:build integration

package integration_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/elo"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

// TestAddMatch_PlayerRatingsCreated verifies that adding a match creates global arena settlement rows
// for every participant and that Elo deltas (pay + earn) sum to approximately zero.
func TestAddMatch_PlayerRatingsCreated(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	p1 := createTestPlayer(t, pool, "Alice")
	p2 := createTestPlayer(t, pool, "Bob")
	p3 := createTestPlayer(t, pool, "Carol")
	gameID := createTestGame(t, pool, "Catan")

	svc := newMatchService(pool)
	_, err := svc.AddMatch(ctx, gameID, map[idpkg.ID]float64{p1: 10, p2: 5, p3: 1}, time.Now(), newMatchOpts(t))
	if err != nil {
		t.Fatalf("AddMatch: %v", err)
	}

	// Each player must have exactly one settlement row after a single match.
	for _, pid := range []idpkg.ID{p1, p2, p3} {
		rows := playerRatingRows(t, pool, pid)
		if len(rows) != 1 {
			t.Errorf("player %s: expected 1 rating row, got %d", pid, len(rows))
		}
	}

	// Check sum of all new_elo equals 3 * startingElo (true Elo is zero-sum across players)
	const startingElo = 1000.0
	var eloSum float64
	for _, pid := range []idpkg.ID{p1, p2, p3} {
		eloSum += latestElo(t, pool, pid)
	}
	const epsilon = 0.001
	expected := float64(3) * startingElo
	if diff := eloSum - expected; diff < -epsilon || diff > epsilon {
		t.Errorf("sum of elo = %.4f, want %.4f (zero-sum property)", eloSum, expected)
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

	svc := newMatchService(pool)
	_, err := svc.AddMatch(ctx, gameID, map[idpkg.ID]float64{winner: 10, loser: 1}, time.Now(), newMatchOpts(t))
	if err != nil {
		t.Fatalf("AddMatch: %v", err)
	}

	winnerElo := latestRating(t, pool, winner)
	loserElo := latestRating(t, pool, loser)
	if winnerElo <= loserElo {
		t.Errorf("expected winner Elo (%.2f) > loser Elo (%.2f)", winnerElo, loserElo)
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
	guarantor := createTestPlayer(t, pool, "ConflictBGuarantor")
	gameID := createTestGame(t, pool, "Checkers")
	adminID := createTestAdmin(t, pool)

	now := time.Now().Truncate(time.Second)
	tWarmup := now.Add(-2 * time.Hour)  // warm-up match to give bet limits
	tFuture := now.Add(2 * time.Hour)   // M2 original date (future game)
	tPast := now.Add(-30 * time.Minute) // target date for M2 (before bets placed at ~now)

	matchSvc := newMatchService(pool)
	marketSvc := elo.NewMarketService(pool)

	// 1. Warm-up match: gives players a bet limit of K/(1+1) ≈ 16.
	_, err := matchSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{playerA: 5, playerB: 5}, tWarmup, newMatchOpts(t))
	if err != nil {
		t.Fatalf("warm-up AddMatch: %v", err)
	}

	// 2. Market covering the upcoming game (starts in past, covers tFuture).
	market, err := marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
		ID:         newID(t),
		MarketType: "match_winner",
		StartsAt:   now.Add(-time.Hour),
		ClosesAt:   now.Add(24 * time.Hour),
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

	// 3. Bets placed NOW (placed_at ≈ now, before tFuture = now+2h).
	outcomeA := marketOutcomeID(t, ctx, marketSvc, market.ID, "player", playerA)
	outcomeOther := marketOutcomeID(t, ctx, marketSvc, market.ID, "other", "")
	if _, err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, playerA, outcomeA, 1); err != nil {
		t.Fatalf("PlaceBet playerA: %v", err)
	}
	if _, err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, playerB, outcomeOther, 1); err != nil {
		t.Fatalf("PlaceBet playerB: %v", err)
	}

	// 4. M2 with a future domain date triggers resolution; resolved_at = tFuture > placed_at ✓.
	m2, err := matchSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{playerA: 10, playerB: 2}, tFuture, newMatchOpts(t))
	if err != nil {
		t.Fatalf("M2 AddMatch: %v", err)
	}

	// 5. Move M2 to tPast (now-30min). This makes resolved_at = now-30min < placed_at (≈now).
	// Bets fall in [now-30min, now+2h) → conflict must be returned.
	_, err = matchSvc.UpdateMatch(ctx, m2.ID, gameID, map[idpkg.ID]float64{playerA: 10, playerB: 2}, tPast, elo.UpdateMatchOpts{})
	if err == nil {
		t.Fatal("UpdateMatch: expected error, got nil")
	}
	if !errors.Is(err, elo.ErrHistoryChangeConflict) {
		t.Errorf("UpdateMatch: expected ErrHistoryChangeConflict, got: %v", err)
	}
}
