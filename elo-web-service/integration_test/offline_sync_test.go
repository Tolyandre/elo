//go:build integration

package integration_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/elo"
)

func newIdempotencyKey() pgtype.UUID {
	return pgtype.UUID{Bytes: uuid.New(), Valid: true}
}

// TestAddMatch_BackdatedRecalculatesLaterMatches verifies that inserting a match with a
// client-supplied date between two existing matches replays Elo from that date, changing
// the settlements of the later match.
func TestAddMatch_BackdatedRecalculatesLaterMatches(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	playerA := createTestPlayer(t, pool, "OfflineA")
	playerB := createTestPlayer(t, pool, "OfflineB")
	gameID := createTestGame(t, pool, "Carcassonne")

	now := time.Now().Truncate(time.Second)
	t1 := now.Add(-2 * time.Hour)
	t2 := now.Add(-1 * time.Hour)
	tBackdated := now.Add(-90 * time.Minute) // between t1 and t2

	svc := elo.NewMatchService(pool, elo.NewMarketService(pool))

	if _, err := svc.AddMatch(ctx, gameID, map[int32]float64{playerA: 10, playerB: 5}, t1, elo.AddMatchOpts{}); err != nil {
		t.Fatalf("M1 AddMatch: %v", err)
	}
	if _, err := svc.AddMatch(ctx, gameID, map[int32]float64{playerA: 10, playerB: 5}, t2, elo.AddMatchOpts{}); err != nil {
		t.Fatalf("M2 AddMatch: %v", err)
	}

	// Compare on the true-Elo track: it is zero-sum, so a backdated loss must
	// lower A's final elo (the display rating track is scaled by the newbie
	// league mechanics and can move either way).
	beforeA := latestElo(t, pool, playerA)
	beforeB := latestElo(t, pool, playerB)

	// Backdated offline match with the opposite outcome must change the replayed history.
	created, err := svc.AddMatch(ctx, gameID, map[int32]float64{playerA: 1, playerB: 10}, tBackdated,
		elo.AddMatchOpts{ClientDate: true, IdempotencyKey: newIdempotencyKey()})
	if err != nil {
		t.Fatalf("backdated AddMatch: %v", err)
	}
	if !created.Date.Time.Equal(tBackdated) {
		t.Errorf("created match date = %v, want %v", created.Date.Time, tBackdated)
	}

	afterA := latestElo(t, pool, playerA)
	afterB := latestElo(t, pool, playerB)
	if afterA >= beforeA {
		t.Errorf("playerA elo should drop after inserting a backdated loss: before=%.4f after=%.4f", beforeA, afterA)
	}
	if afterB <= beforeB {
		t.Errorf("playerB elo should rise after inserting a backdated win: before=%.4f after=%.4f", beforeB, afterB)
	}

	// All three matches must have settlements for both players.
	for _, pid := range []int32{playerA, playerB} {
		if rows := playerRatingRows(t, pool, pid); len(rows) != 3 {
			t.Errorf("player %d: expected 3 settlement rows, got %d", pid, len(rows))
		}
	}
}

// TestAddMatch_IdempotencyKeyDeduplicates verifies that retrying AddMatch with the same
// idempotency key returns the original match without duplicating settlements.
func TestAddMatch_IdempotencyKeyDeduplicates(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	playerA := createTestPlayer(t, pool, "IdemA")
	playerB := createTestPlayer(t, pool, "IdemB")
	gameID := createTestGame(t, pool, "Splendor")

	svc := elo.NewMatchService(pool, elo.NewMarketService(pool))
	key := newIdempotencyKey()
	date := time.Now().Add(-time.Hour)
	opts := elo.AddMatchOpts{ClientDate: true, IdempotencyKey: key}

	first, err := svc.AddMatch(ctx, gameID, map[int32]float64{playerA: 10, playerB: 5}, date, opts)
	if err != nil {
		t.Fatalf("first AddMatch: %v", err)
	}
	second, err := svc.AddMatch(ctx, gameID, map[int32]float64{playerA: 10, playerB: 5}, date, opts)
	if err != nil {
		t.Fatalf("second AddMatch: %v", err)
	}
	if first.ID != second.ID {
		t.Errorf("retry created a new match: first=%d second=%d", first.ID, second.ID)
	}

	for _, pid := range []int32{playerA, playerB} {
		if rows := playerRatingRows(t, pool, pid); len(rows) != 1 {
			t.Errorf("player %d: expected 1 settlement row after retry, got %d", pid, len(rows))
		}
	}
}

// TestAddMatch_ClientDateValidation verifies the 30-days-past / no-future window.
func TestAddMatch_ClientDateValidation(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	playerA := createTestPlayer(t, pool, "DateA")
	playerB := createTestPlayer(t, pool, "DateB")
	gameID := createTestGame(t, pool, "Azul")

	svc := elo.NewMatchService(pool, elo.NewMarketService(pool))
	scores := map[int32]float64{playerA: 10, playerB: 5}

	_, err := svc.AddMatch(ctx, gameID, scores, time.Now().Add(time.Hour), elo.AddMatchOpts{ClientDate: true})
	if !errors.Is(err, elo.ErrMatchDateOutOfRange) {
		t.Errorf("future date: expected ErrMatchDateOutOfRange, got %v", err)
	}

	_, err = svc.AddMatch(ctx, gameID, scores, time.Now().Add(-31*24*time.Hour), elo.AddMatchOpts{ClientDate: true})
	if !errors.Is(err, elo.ErrMatchDateOutOfRange) {
		t.Errorf("31 days ago: expected ErrMatchDateOutOfRange, got %v", err)
	}
}

// TestCreatePlayerAndGame_IdempotencyKey verifies that repeated creates with the same key
// return the existing row, while a different key with a duplicate name still conflicts.
func TestCreatePlayerAndGame_IdempotencyKey(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	playerSvc := elo.NewPlayerService(pool)
	gameSvc := elo.NewGameService(pool)

	playerKey := newIdempotencyKey()
	p1, err := playerSvc.CreatePlayer(ctx, "Оффлайн Игрок", playerKey)
	if err != nil {
		t.Fatalf("first CreatePlayer: %v", err)
	}
	p2, err := playerSvc.CreatePlayer(ctx, "Оффлайн Игрок", playerKey)
	if err != nil {
		t.Fatalf("retry CreatePlayer: %v", err)
	}
	if p1.ID != p2.ID {
		t.Errorf("player retry created a duplicate: first=%d second=%d", p1.ID, p2.ID)
	}
	// Same name with a different key must still hit the name unique constraint.
	if _, err := playerSvc.CreatePlayer(ctx, "Оффлайн Игрок", newIdempotencyKey()); !db.IsUniqueViolation(err) {
		t.Errorf("duplicate name with new key: expected unique violation, got %v", err)
	}

	gameKey := newIdempotencyKey()
	g1, err := gameSvc.AddGame(ctx, "Оффлайн Игра", gameKey)
	if err != nil {
		t.Fatalf("first AddGame: %v", err)
	}
	g2, err := gameSvc.AddGame(ctx, "Оффлайн Игра", gameKey)
	if err != nil {
		t.Fatalf("retry AddGame: %v", err)
	}
	if g1.ID != g2.ID {
		t.Errorf("game retry created a duplicate: first=%d second=%d", g1.ID, g2.ID)
	}
	if _, err := gameSvc.AddGame(ctx, "Оффлайн Игра", newIdempotencyKey()); !db.IsUniqueViolation(err) {
		t.Errorf("duplicate game name with new key: expected unique violation, got %v", err)
	}
}

// TestAddMatch_BackdatedConflictsWithMarket verifies that a backdated insert which would
// move a market's resolution before an existing bet is rejected with ErrHistoryChangeConflict.
func TestAddMatch_BackdatedConflictsWithMarket(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	playerA := createTestPlayer(t, pool, "BackdateMarketA")
	playerB := createTestPlayer(t, pool, "BackdateMarketB")
	gameID := createTestGame(t, pool, "Root")
	adminID := createTestAdmin(t, pool)

	now := time.Now().Truncate(time.Second)
	matchSvc := elo.NewMatchService(pool, elo.NewMarketService(pool))
	marketSvc := elo.NewMarketService(pool)

	// Warm-up match for bet limits.
	if _, err := matchSvc.AddMatch(ctx, gameID, map[int32]float64{playerA: 5, playerB: 5}, now.Add(-2*time.Hour), elo.AddMatchOpts{}); err != nil {
		t.Fatalf("warm-up AddMatch: %v", err)
	}

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

	// Bets placed now.
	if err := marketSvc.PlaceBet(ctx, market.ID, playerA, "yes", 10); err != nil {
		t.Fatalf("PlaceBet playerA: %v", err)
	}
	if err := marketSvc.PlaceBet(ctx, market.ID, playerB, "no", 10); err != nil {
		t.Fatalf("PlaceBet playerB: %v", err)
	}

	// Resolve the market with a match well after the bets.
	if _, err := matchSvc.AddMatch(ctx, gameID, map[int32]float64{playerA: 10, playerB: 2}, now.Add(2*time.Hour), elo.AddMatchOpts{}); err != nil {
		t.Fatalf("resolving AddMatch: %v", err)
	}

	// A backdated offline match qualifying for the market before the bets were placed
	// would move resolved_at earlier than placed_at — must be rejected.
	_, err = matchSvc.AddMatch(ctx, gameID, map[int32]float64{playerA: 10, playerB: 2}, now.Add(-30*time.Minute),
		elo.AddMatchOpts{ClientDate: true, IdempotencyKey: newIdempotencyKey()})
	if err == nil {
		t.Fatal("backdated AddMatch: expected conflict error, got nil")
	}
	if !errors.Is(err, elo.ErrHistoryChangeConflict) {
		t.Errorf("backdated AddMatch: expected ErrHistoryChangeConflict, got: %v", err)
	}
}
