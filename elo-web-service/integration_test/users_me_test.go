//go:build integration

package integration_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/google/uuid"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

// TestPatchMe_Base58PlayerId is the regression test for binding a player on
// /settings: the handler used to cast the raw Base58 body value to id.ID
// without decoding, so Postgres rejected it with SQLSTATE 22P02.
func TestPatchMe_Base58PlayerId(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	token := createTestUser(t, pool, true)
	router := setupRouter(pool)

	uid, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("generate player id: %v", err)
	}
	canonical := uid.String()
	short := idpkg.ToBase58(canonical)

	if w := doJSON(t, router, http.MethodPost, "/players", token, `{"id":"`+short+`","name":"PatchMePlayer"}`); w.Code != http.StatusOK {
		t.Fatalf("create player: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Bind the player using the SHORT (wire) id — what the settings page sends.
	if w := doJSON(t, router, http.MethodPatch, "/auth/me", token, `{"player_id":"`+short+`"}`); w.Code != http.StatusNoContent {
		t.Fatalf("patch me with short player id: expected 204, got %d: %s", w.Code, w.Body.String())
	}

	var me struct {
		Data struct {
			PlayerID *string `json:"player_id"`
		} `json:"data"`
	}
	w := doJSON(t, router, http.MethodGet, "/auth/me", token, "")
	if w.Code != http.StatusOK {
		t.Fatalf("get me: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if err := json.Unmarshal(w.Body.Bytes(), &me); err != nil {
		t.Fatalf("decode get me response: %v", err)
	}
	if me.Data.PlayerID == nil || *me.Data.PlayerID != short {
		t.Errorf("me.player_id = %v, want %q", me.Data.PlayerID, short)
	}

	// The canonical form must keep working (old clients).
	if w := doJSON(t, router, http.MethodPatch, "/auth/me", token, `{"player_id":"`+canonical+`"}`); w.Code != http.StatusNoContent {
		t.Errorf("patch me with canonical player id: expected 204, got %d: %s", w.Code, w.Body.String())
	}

	// Unlink with null.
	if w := doJSON(t, router, http.MethodPatch, "/auth/me", token, `{"player_id":null}`); w.Code != http.StatusNoContent {
		t.Errorf("patch me with null player id: expected 204, got %d: %s", w.Code, w.Body.String())
	}
	w = doJSON(t, router, http.MethodGet, "/auth/me", token, "")
	if err := json.Unmarshal(w.Body.Bytes(), &me); err != nil {
		t.Fatalf("decode get me response: %v", err)
	}
	if me.Data.PlayerID != nil {
		t.Errorf("me.player_id = %q after unlink, want null", *me.Data.PlayerID)
	}

	// A malformed id is a 400, not a 500 from the database.
	if w := doJSON(t, router, http.MethodPatch, "/auth/me", token, `{"player_id":"not-an-id"}`); w.Code != http.StatusBadRequest {
		t.Errorf("patch me with malformed id: expected 400, got %d: %s", w.Code, w.Body.String())
	}
}
