//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/tolyandre/elo-web-service/pkg/elo"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

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

	svc := newMatchService(pool)

	if _, err := svc.AddMatch(ctx, blueMenTenantID, gameID, map[idpkg.ID]float64{playerA: 10, playerB: 5}, t1, newMatchOpts(t)); err != nil {
		t.Fatalf("M1 AddMatch: %v", err)
	}
	if _, err := svc.AddMatch(ctx, blueMenTenantID, gameID, map[idpkg.ID]float64{playerA: 10, playerB: 5}, t2, newMatchOpts(t)); err != nil {
		t.Fatalf("M2 AddMatch: %v", err)
	}

	// Compare on the true-Elo track: it is zero-sum, so a backdated loss must
	// lower A's final elo (the display rating track is scaled by the newbie
	// league mechanics and can move either way).
	beforeA := latestElo(t, pool, playerA)
	beforeB := latestElo(t, pool, playerB)

	// Backdated offline match with the opposite outcome must change the replayed history.
	created, err := svc.AddMatch(ctx, blueMenTenantID, gameID, map[idpkg.ID]float64{playerA: 1, playerB: 10}, tBackdated,
		elo.AddMatchOpts{ClientDate: true, ID: newID(t)})
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
	for _, pid := range []idpkg.ID{playerA, playerB} {
		if rows := playerRatingRows(t, pool, pid); len(rows) != 3 {
			t.Errorf("player %s: expected 3 settlement rows, got %d", pid, len(rows))
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

	svc := newMatchService(pool)
	key := newID(t)
	date := time.Now().Add(-time.Hour)
	opts := elo.AddMatchOpts{ClientDate: true, ID: key}

	first, err := svc.AddMatch(ctx, blueMenTenantID, gameID, map[idpkg.ID]float64{playerA: 10, playerB: 5}, date, opts)
	if err != nil {
		t.Fatalf("first AddMatch: %v", err)
	}
	second, err := svc.AddMatch(ctx, blueMenTenantID, gameID, map[idpkg.ID]float64{playerA: 10, playerB: 5}, date, opts)
	if err != nil {
		t.Fatalf("second AddMatch: %v", err)
	}
	if first.ID != second.ID {
		t.Errorf("retry created a new match: first=%s second=%s", first.ID, second.ID)
	}

	for _, pid := range []idpkg.ID{playerA, playerB} {
		if rows := playerRatingRows(t, pool, pid); len(rows) != 1 {
			t.Errorf("player %s: expected 1 settlement row after retry, got %d", pid, len(rows))
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

	svc := newMatchService(pool)
	scores := map[idpkg.ID]float64{playerA: 10, playerB: 5}

	_, err := svc.AddMatch(ctx, blueMenTenantID, gameID, scores, time.Now().Add(time.Hour), elo.AddMatchOpts{ClientDate: true, ID: newID(t)})
	if !errors.Is(err, elo.ErrMatchDateOutOfRange) {
		t.Errorf("future date: expected ErrMatchDateOutOfRange, got %v", err)
	}

	_, err = svc.AddMatch(ctx, blueMenTenantID, gameID, scores, time.Now().Add(-31*24*time.Hour), elo.AddMatchOpts{ClientDate: true, ID: newID(t)})
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
	gameSvc := newGameService(pool)

	playerKey := newID(t)
	p1, err := playerSvc.CreatePlayer(ctx, playerKey, "Оффлайн Игрок", "")
	if err != nil {
		t.Fatalf("first CreatePlayer: %v", err)
	}
	p2, err := playerSvc.CreatePlayer(ctx, playerKey, "Оффлайн Игрок", "")
	if err != nil {
		t.Fatalf("retry CreatePlayer: %v", err)
	}
	if p1.ID != p2.ID {
		t.Errorf("player retry created a duplicate: first=%s second=%s", p1.ID, p2.ID)
	}
	// Same name with a different key must still conflict — but as a
	// DuplicateNameError (ADR-37) that names the entity to adopt.
	_, err = playerSvc.CreatePlayer(ctx, newID(t), "Оффлайн Игрок", "")
	var playerDup *elo.DuplicateNameError
	if !errors.As(err, &playerDup) {
		t.Errorf("duplicate name with new key: expected DuplicateNameError, got %v", err)
	} else if playerDup.ExistingID != p1.ID {
		t.Errorf("DuplicateNameError existing id = %s, want %s", playerDup.ExistingID, p1.ID)
	}

	gameKey := newID(t)
	g1, err := gameSvc.AddGame(ctx, gameKey, "Оффлайн Игра", "")
	if err != nil {
		t.Fatalf("first AddGame: %v", err)
	}
	g2, err := gameSvc.AddGame(ctx, gameKey, "Оффлайн Игра", "")
	if err != nil {
		t.Fatalf("retry AddGame: %v", err)
	}
	if g1.ID != g2.ID {
		t.Errorf("game retry created a duplicate: first=%s second=%s", g1.ID, g2.ID)
	}
	_, err = gameSvc.AddGame(ctx, newID(t), "Оффлайн Игра", "")
	var gameDup *elo.DuplicateNameError
	if !errors.As(err, &gameDup) {
		t.Errorf("duplicate game name with new key: expected DuplicateNameError, got %v", err)
	} else if gameDup.ExistingID != g1.ID {
		t.Errorf("game DuplicateNameError existing id = %s, want %s", gameDup.ExistingID, g1.ID)
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
	matchSvc := newMatchService(pool)
	marketSvc := elo.NewMarketService(pool)

	// Warm-up match for bet limits.
	if _, err := matchSvc.AddMatch(ctx, blueMenTenantID, gameID, map[idpkg.ID]float64{playerA: 5, playerB: 5}, now.Add(-2*time.Hour), newMatchOpts(t)); err != nil {
		t.Fatalf("warm-up AddMatch: %v", err)
	}

	market, err := marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
		TenantID:   blueMenTenantID,
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
	// playerA is the sole guarantor and also buys 10 shares: fund both the
	// wager risk (16) and the buy.
	setBetLimit(t, pool, blueMenTenantID, playerA, 24)
	joinGuarantee(ctx, t, marketSvc, market.ID, playerA)

	// Bets placed now.
	outcomeA := marketOutcomeID(t, ctx, marketSvc, market.ID, "player", playerA)
	outcomeOther := marketOutcomeID(t, ctx, marketSvc, market.ID, "other", "")
	if _, err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, playerA, outcomeA, 10); err != nil {
		t.Fatalf("PlaceBet playerA: %v", err)
	}
	if _, err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, playerB, outcomeOther, 10); err != nil {
		t.Fatalf("PlaceBet playerB: %v", err)
	}

	// Resolve the market with a match well after the bets.
	if _, err := matchSvc.AddMatch(ctx, blueMenTenantID, gameID, map[idpkg.ID]float64{playerA: 10, playerB: 2}, now.Add(2*time.Hour), newMatchOpts(t)); err != nil {
		t.Fatalf("resolving AddMatch: %v", err)
	}

	// A backdated offline match qualifying for the market before the bets were placed
	// would move resolved_at earlier than placed_at — must be rejected.
	_, err = matchSvc.AddMatch(ctx, blueMenTenantID, gameID, map[idpkg.ID]float64{playerA: 10, playerB: 2}, now.Add(-30*time.Minute),
		elo.AddMatchOpts{ClientDate: true, ID: newID(t)})
	if err == nil {
		t.Fatal("backdated AddMatch: expected conflict error, got nil")
	}
	if !errors.Is(err, elo.ErrHistoryChangeConflict) {
		t.Errorf("backdated AddMatch: expected ErrHistoryChangeConflict, got: %v", err)
	}
}

// TestCreatePlayer_DuplicateNameReturnsExistingId verifies the HTTP envelope of
// ADR-37: a second create with the same name (different id — the offline-sync
// race) answers 409 with existing_id naming the entity to adopt.
func TestCreatePlayer_DuplicateNameReturnsExistingId(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	token := createTestUser(t, pool, true)
	router := setupRouter(pool)

	uid, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("generate player id: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/players", strings.NewReader(`{"id":"`+uid.String()+`","name":"Дубликат Игрок"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("first create: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	uid2, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("generate second player id: %v", err)
	}
	req2 := httptest.NewRequest(http.MethodPost, "/players", strings.NewReader(`{"id":"`+uid2.String()+`","name":"Дубликат Игрок"}`))
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("Authorization", "Bearer "+token)
	w2 := httptest.NewRecorder()
	router.ServeHTTP(w2, req2)
	if w2.Code != http.StatusConflict {
		t.Fatalf("duplicate create: expected 409, got %d: %s", w2.Code, w2.Body.String())
	}

	var resp struct {
		Status     string `json:"status"`
		Message    string `json:"message"`
		ExistingID string `json:"existing_id"`
	}
	if err := json.NewDecoder(w2.Body).Decode(&resp); err != nil {
		t.Fatalf("decode 409 body: %v", err)
	}
	if resp.Status != "fail" {
		t.Errorf("status = %q, want fail", resp.Status)
	}
	// existing_id is the Base58 wire form of the first player's canonical id.
	encoded, err := json.Marshal(idpkg.ID(uid.String()))
	if err != nil {
		t.Fatalf("encode id: %v", err)
	}
	want := strings.Trim(string(encoded), `"`)
	if resp.ExistingID != want {
		t.Errorf("existing_id = %q, want %q", resp.ExistingID, want)
	}

	// The idempotent replay (same id) still answers 200, unchanged by the new error shape.
	req3 := httptest.NewRequest(http.MethodPost, "/players", strings.NewReader(`{"id":"`+uid.String()+`","name":"Дубликат Игрок"}`))
	req3.Header.Set("Content-Type", "application/json")
	req3.Header.Set("Authorization", "Bearer "+token)
	w3 := httptest.NewRecorder()
	router.ServeHTTP(w3, req3)
	if w3.Code != http.StatusOK {
		t.Errorf("idempotent replay: expected 200, got %d: %s", w3.Code, w3.Body.String())
	}
}

// TestCreateGame_DuplicateNameReturnsExistingId verifies the same ADR-37
// envelope for the game create path (the display name is a generated column).
func TestCreateGame_DuplicateNameReturnsExistingId(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	token := createTestUser(t, pool, true)
	router := setupRouter(pool)

	uid, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("generate game id: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/games", strings.NewReader(`{"id":"`+uid.String()+`","name":"Дубликат Игра"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("first create: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	uid2, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("generate second game id: %v", err)
	}
	req2 := httptest.NewRequest(http.MethodPost, "/games", strings.NewReader(`{"id":"`+uid2.String()+`","name":"Дубликат Игра"}`))
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("Authorization", "Bearer "+token)
	w2 := httptest.NewRecorder()
	router.ServeHTTP(w2, req2)
	if w2.Code != http.StatusConflict {
		t.Fatalf("duplicate create: expected 409, got %d: %s", w2.Code, w2.Body.String())
	}

	var resp struct {
		Status     string `json:"status"`
		ExistingID string `json:"existing_id"`
	}
	if err := json.NewDecoder(w2.Body).Decode(&resp); err != nil {
		t.Fatalf("decode 409 body: %v", err)
	}
	encoded, err := json.Marshal(idpkg.ID(uid.String()))
	if err != nil {
		t.Fatalf("encode id: %v", err)
	}
	want := strings.Trim(string(encoded), `"`)
	if resp.Status != "fail" || resp.ExistingID != want {
		t.Errorf("status = %q, existing_id = %q, want fail + %q", resp.Status, resp.ExistingID, want)
	}
}
