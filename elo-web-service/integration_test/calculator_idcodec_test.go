//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tolyandre/elo-web-service/pkg/db"
)

// TestCalculatorData_IDCodecRoundtrip is the regression test for the row_id
// collision bug: several IAWW row ids ("structure", "research", "project", …)
// are valid Base58 strings, so the idcodec middleware would silently decode
// them to canonical UUIDs on the request path, corrupting the stored document.
//
// The fix: store the multiplier row identifier under the "row" key (no "_id"
// suffix), which idcodec leaves untouched.
//
// This test exercises the full path: POST /matches with short player ids +
// calculator_data containing all known IAWW row ids → GET /matches/{id} →
// verify the row ids survive verbatim and player ids come back short.
func TestCalculatorData_IDCodecRoundtrip(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	token := createTestUser(t, pool, true)
	router := setupRouter(pool)

	ctx := context.Background()
	q := db.New(pool)
	// Two players with low legacy ids (canonical form) so the short encoding is predictable.
	paPlayer, _ := q.CreatePlayer(ctx, db.CreatePlayerParams{ID: "00000000-0000-0000-0000-0000000000a1", Name: "Alpha"})
	pbPlayer, _ := q.CreatePlayer(ctx, db.CreatePlayerParams{ID: "00000000-0000-0000-0000-0000000000a2", Name: "Beta"})
	pa, pb := paPlayer.ID, pbPlayer.ID
	gameRow, _ := q.AddGame(ctx, db.AddGameParams{ID: "00000000-0000-0000-0000-0000000000b1", Name: "ЭБМ"})
	game := gameRow.ID

	// Every known IAWW row id appears here — if any of them is corrupted by
	// idcodec, the assertion at the bottom fails.
	allRows := []string{
		"direct", "structure", "vehicle", "research", "project", "discovery",
		"financier", "general", "culture",
		"str-res", "res-dis", "str-pro", "veh-pro", "res-pro", "pro-dis",
		"veh-res", "str-veh", "fin-gen", "dis-fin", "veh-fin", "pro-gen", "str-gen",
	}
	mults := make([]map[string]any, 0, len(allRows))
	for _, r := range allRows {
		mults = append(mults, map[string]any{"row": r, "player_id": pa, "coeff": 1, "count": 1})
	}

	calc := map[string]any{
		"schema_version":   2,
		"players":          []map[string]any{{"player_id": pa, "name": "Alpha"}, {"player_id": pb, "name": "Beta"}},
		"direct_vp":        []map[string]any{{"player_id": pa, "value": 1}},
		"multipliers":      mults,
		"fallback_game_id": nil,
	}
	calcJSON, _ := json.Marshal(calc)

	// POST body — match id is canonical, score keyed by canonical player ids
	// (idcodec decodes both on the way in).
	body := map[string]any{
		"id":              "00000000-0000-0000-0000-0000000000c1",
		"game_id":         game,
		"score":           map[string]any{pa: 10.0, pb: 5.0},
		"date":            "2026-07-20T12:00:00Z",
		"calculator_kind": "iaww",
		"calculator_data": json.RawMessage(calcJSON),
	}
	bodyBytes, _ := json.Marshal(body)

	req := httptest.NewRequest(http.MethodPost, "/matches", strings.NewReader(string(bodyBytes)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("POST /matches: %d: %s", w.Code, w.Body.String())
	}

	// GET it back.
	w2 := httptest.NewRecorder()
	router.ServeHTTP(w2, httptest.NewRequest(http.MethodGet, "/matches/00000000-0000-0000-0000-0000000000c1", nil))
	if w2.Code != http.StatusOK {
		t.Fatalf("GET /matches/{id}: %d: %s", w2.Code, w2.Body.String())
	}

	var resp struct {
		Data struct {
			CalculatorData map[string]any `json:"calculator_data"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w2.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v: %s", err, w2.Body.String())
	}

	mults2, _ := resp.Data.CalculatorData["multipliers"].([]any)
	gotRows := map[string]bool{}
	for _, m := range mults2 {
		obj, _ := m.(map[string]any)
		if r, ok := obj["row"].(string); ok {
			gotRows[r] = true
		}
		// The legacy "row_id" key MUST NOT appear.
		if _, has := obj["row_id"]; has {
			t.Errorf("response multiplier still uses row_id (should be row): %v", obj)
		}
	}
	for _, want := range allRows {
		if !gotRows[want] {
			t.Errorf("row %q missing or corrupted in roundtripped calculator_data", want)
		}
	}
}
