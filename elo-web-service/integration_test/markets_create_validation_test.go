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
	shortPlayer := shortOf(t, player.ID)

	base := func(id string) map[string]any {
		return map[string]any{
			"id":                  id,
			"market_type":         "match_winner",
			"closes_at":           time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339),
			"target_player_ids":   []string{shortPlayer},
			"allow_other_players": false,
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

// TestMarkets_Create_DefaultMaxGuarantorLossAndGuarantee pins the settings
// fallback and the voluntary-guarantor flow (ADR-20): a market is created
// without guarantors (b = 0, L from the settings default 16), stays untradable,
// and its first guarantee wager derives b = min(L, Σrisk)/ln(n) = 16/ln(3) for
// the two-target (n = 3) market.
func TestMarkets_Create_DefaultMaxGuarantorLossAndGuarantee(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	token, userID := createTestUserWithID(t, pool, true)
	router := setupRouter(pool)

	ctx := context.Background()
	q := db.New(pool)
	playerA, _ := q.CreatePlayer(ctx, db.CreatePlayerParams{ID: "00000000-0000-0000-0000-000000000111", Name: "LiqA"})
	playerB, _ := q.CreatePlayer(ctx, db.CreatePlayerParams{ID: "00000000-0000-0000-0000-000000000112", Name: "LiqB"})
	guarantor, _ := q.CreatePlayer(ctx, db.CreatePlayerParams{ID: "00000000-0000-0000-0000-000000000113", Name: "LiqGuarantor"})
	if _, err := pool.Exec(ctx, `UPDATE users SET player_id = $2 WHERE id = $1`, userID, guarantor.ID); err != nil {
		t.Fatalf("link guarantor player: %v", err)
	}
	setBetLimit(t, pool, guarantor.ID, 16)

	// Two targets → n = 3 outcomes.
	marketID := uuid.MustParse("00000000-0000-0000-0000-000000000114").String()
	w := postMarket(t, router, token, map[string]any{
		"id":                  marketID,
		"market_type":         "match_winner",
		"closes_at":           time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339),
		"target_player_ids":   []string{shortOf(t, playerA.ID), shortOf(t, playerB.ID)},
		"allow_other_players": true,
	})
	if w.Code != http.StatusCreated {
		t.Fatalf("POST /markets: %d: %s", w.Code, w.Body.String())
	}

	m, err := q.GetMarket(ctx, idpkg.ID(marketID))
	if err != nil {
		t.Fatalf("GetMarket: %v", err)
	}
	if m.LiquidityB != 0 {
		t.Errorf("guarantor-less market must start with liquidity_b = 0, got %v", m.LiquidityB)
	}
	if math.Abs(m.MaxGuarantorLoss-16) > 1e-9 {
		t.Errorf("default max_guarantor_loss = %v, want 16 (settings default)", m.MaxGuarantorLoss)
	}

	// The guarantor joins with the market's full L: b = min(16, 16)/ln(3).
	payload, _ := json.Marshal(map[string]any{
		"id":          uuid.MustParse("00000000-0000-0000-0000-000000000115").String(),
		"risk_amount": 16,
		"fee_rate":    0.05,
	})
	req := httptest.NewRequest(http.MethodPost, "/markets/"+shortOf(t, m.ID)+"/guarantees", strings.NewReader(string(payload)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w2 := httptest.NewRecorder()
	router.ServeHTTP(w2, req)
	if w2.Code != http.StatusCreated {
		t.Fatalf("POST /markets/{id}/guarantees: %d: %s", w2.Code, w2.Body.String())
	}
	var joinResp struct {
		Data struct {
			LiquidityB float64 `json:"liquidity_b"`
			TotalRisk  float64 `json:"total_risk"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w2.Body.Bytes(), &joinResp); err != nil {
		t.Fatalf("parse guarantee response: %v", err)
	}
	wantB := 16 / math.Log(3)
	if math.Abs(joinResp.Data.LiquidityB-wantB) > 1e-9 {
		t.Errorf("liquidity_b after wager = %.6f, want %.6f (16/ln 3)", joinResp.Data.LiquidityB, wantB)
	}
	if math.Abs(joinResp.Data.TotalRisk-16) > 1e-9 {
		t.Errorf("total_risk = %v, want 16", joinResp.Data.TotalRisk)
	}

	m, err = q.GetMarket(ctx, idpkg.ID(marketID))
	if err != nil {
		t.Fatalf("GetMarket after wager: %v", err)
	}
	if math.Abs(m.LiquidityB-wantB) > 1e-9 {
		t.Errorf("stored liquidity_b = %.6f, want %.6f", m.LiquidityB, wantB)
	}

	// An out-of-range fee is rejected with 422.
	badPayload, _ := json.Marshal(map[string]any{
		"id":          uuid.MustParse("00000000-0000-0000-0000-000000000116").String(),
		"risk_amount": 1,
		"fee_rate":    0.30,
	})
	req2 := httptest.NewRequest(http.MethodPost, "/markets/"+shortOf(t, m.ID)+"/guarantees", strings.NewReader(string(badPayload)))
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("Authorization", "Bearer "+token)
	w3 := httptest.NewRecorder()
	router.ServeHTTP(w3, req2)
	if w3.Code != http.StatusUnprocessableEntity {
		t.Fatalf("fee above 25%%: %d: %s (want 422)", w3.Code, w3.Body.String())
	}
}
