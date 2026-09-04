//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/tolyandre/elo-web-service/pkg/db"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

// postMarket creates a match_winner market through HTTP and returns the
// recorder for status/body assertions.
func postMarket(t *testing.T, router interface {
	ServeHTTP(http.ResponseWriter, *http.Request)
}, token string, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	payload, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/markets", strings.NewReader(string(payload)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

// TestMarkets_Create_SinglePlayerNeedsOtherPlayers guards the degenerate
// one-target market: with allow_other_players=false a single named player
// leaves no meaningful winner — any other player's win would resolve nothing.
// The check runs after target dedup, so a duplicated id cannot sneak past it.
func TestMarkets_Create_SinglePlayerNeedsOtherPlayers(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	token, _ := createTestUserWithID(t, pool, true)
	router := setupRouter(pool)

	ctx := context.Background()
	q := db.New(pool)
	player, _ := q.CreatePlayer(ctx, db.CreatePlayerParams{ID: "00000000-0000-0000-0000-000000000101", Name: "SoloPlayer"})
	guarantor, _ := q.CreatePlayer(ctx, db.CreatePlayerParams{ID: "00000000-0000-0000-0000-000000000102", Name: "SoloGuarantor"})
	shortPlayer := shortOf(t, player.ID)
	shortGuarantor := shortOf(t, guarantor.ID)

	base := func(id string) map[string]any {
		return map[string]any{
			"id":                   id,
			"market_type":          "match_winner",
			"closes_at":            time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339),
			"target_player_ids":    []string{shortPlayer},
			"allow_other_players":  false,
			"guarantor_player_ids": []string{shortGuarantor},
		}
	}

	// One target + no other players → rejected.
	w := postMarket(t, router, token, base(uuid.MustParse("00000000-0000-0000-0000-000000000103").String()))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("single target + allow_other_players=false: %d: %s", w.Code, w.Body.String())
	}
	var failResp struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &failResp); err != nil {
		t.Fatalf("parse response: %v", err)
	}
	if !strings.Contains(failResp.Message, "целевым игроком") {
		t.Errorf("message %q should explain the single-target rule", failResp.Message)
	}

	// The same id duplicated still counts as a single target after dedup.
	dup := base(uuid.MustParse("00000000-0000-0000-0000-000000000104").String())
	dup["target_player_ids"] = []string{shortPlayer, shortPlayer}
	if w := postMarket(t, router, token, dup); w.Code != http.StatusBadRequest {
		t.Fatalf("duplicated single target + allow_other_players=false: %d: %s", w.Code, w.Body.String())
	}

	// One target + other players allowed → the meaningful "will X win" market.
	ok := base(uuid.MustParse("00000000-0000-0000-0000-000000000105").String())
	ok["allow_other_players"] = true
	if w := postMarket(t, router, token, ok); w.Code != http.StatusCreated {
		t.Fatalf("single target + allow_other_players=true: %d: %s", w.Code, w.Body.String())
	}
}

// TestMarkets_Create_DefaultLiquidityFromRisk pins the settings fallback:
// a market created without liquidity_b derives b = L/ln(n) from the
// elo_settings default max guarantor loss (18), so guarantor risk — not the
// raw liquidity — is what the default controls.
func TestMarkets_Create_DefaultLiquidityFromRisk(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	token, _ := createTestUserWithID(t, pool, true)
	router := setupRouter(pool)

	ctx := context.Background()
	q := db.New(pool)
	playerA, _ := q.CreatePlayer(ctx, db.CreatePlayerParams{ID: "00000000-0000-0000-0000-000000000111", Name: "LiqA"})
	playerB, _ := q.CreatePlayer(ctx, db.CreatePlayerParams{ID: "00000000-0000-0000-0000-000000000112", Name: "LiqB"})
	guarantor, _ := q.CreatePlayer(ctx, db.CreatePlayerParams{ID: "00000000-0000-0000-0000-000000000113", Name: "LiqGuarantor"})

	// Two targets → n = 3 outcomes; b must come out as 18/ln(3) ≈ 16.39,
	// not the raw old default b = 16.
	marketID := uuid.MustParse("00000000-0000-0000-0000-000000000114").String()
	w := postMarket(t, router, token, map[string]any{
		"id":                   marketID,
		"market_type":          "match_winner",
		"closes_at":            time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339),
		"target_player_ids":    []string{shortOf(t, playerA.ID), shortOf(t, playerB.ID)},
		"allow_other_players":  true,
		"guarantor_player_ids": []string{shortOf(t, guarantor.ID)},
	})
	if w.Code != http.StatusCreated {
		t.Fatalf("POST /markets: %d: %s", w.Code, w.Body.String())
	}

	m, err := q.GetMarket(ctx, idpkg.ID(marketID))
	if err != nil {
		t.Fatalf("GetMarket: %v", err)
	}
	wantB := 16 / math.Log(3)
	if math.Abs(m.LiquidityB-wantB) > 1e-9 {
		t.Errorf("default liquidity_b = %.6f, want %.6f (16/ln 3)", m.LiquidityB, wantB)
	}
}
