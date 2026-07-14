//go:build integration

package integration_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/tolyandre/elo-web-service/pkg/api/shortid"
)

// TestShortIds_EndToEnd verifies the full boundary codec against real Postgres:
//   - POST with a short id in the body → decoded to canonical, stored.
//   - Response carries the short id (canonical → short on the way out).
//   - GET by short path id → decoded to canonical, row found.
//   - GET by canonical path id still works (backward compatibility).
func TestShortIds_EndToEnd(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	token := createTestUser(t, pool, true /* allow_editing */)
	router := setupRouter(pool)

	// Mint a UUIDv7 and encode it short — this is what a real client sends.
	uid, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("generate player id: %v", err)
	}
	canonical := uid.String()
	short, err := shortid.Encode(canonical)
	if err != nil {
		t.Fatalf("encode short id: %v", err)
	}

	// POST /players with the SHORT id in the body.
	body := `{"id":"` + short + `","name":"ShortIdPlayer"}`
	req := httptest.NewRequest(http.MethodPost, "/players", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("create player with short id: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// The create response must carry the short id.
	var createResp struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &createResp); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	if createResp.Data.ID != short {
		t.Errorf("create response id = %q, want short %q", createResp.Data.ID, short)
	}

	// GET /players — the list response must also carry the short id.
	w2 := httptest.NewRecorder()
	router.ServeHTTP(w2, httptest.NewRequest(http.MethodGet, "/players", nil))
	if w2.Code != http.StatusOK {
		t.Fatalf("list players: expected 200, got %d: %s", w2.Code, w2.Body.String())
	}
	if !strings.Contains(w2.Body.String(), short) {
		t.Errorf("list response does not contain short id %q: %s", short, w2.Body.String())
	}
	if strings.Contains(w2.Body.String(), canonical) {
		t.Errorf("list response leaked canonical id %q: %s", canonical, w2.Body.String())
	}

	// GET /players/:id/stats with the SHORT path id — must decode and find the row.
	w3 := httptest.NewRecorder()
	router.ServeHTTP(w3, httptest.NewRequest(http.MethodGet, "/players/"+short+"/stats", nil))
	if w3.Code == http.StatusNotFound || w3.Code >= 500 {
		t.Errorf("GET by short id failed: status %d: %s", w3.Code, w3.Body.String())
	}

	// GET /players/:id/stats with the CANONICAL path id — backward compatibility.
	w4 := httptest.NewRecorder()
	router.ServeHTTP(w4, httptest.NewRequest(http.MethodGet, "/players/"+canonical+"/stats", nil))
	if w4.Code == http.StatusNotFound || w4.Code >= 500 {
		t.Errorf("GET by canonical id failed: status %d: %s", w4.Code, w4.Body.String())
	}
}

// TestShortIds_CanonicalStillAccepted re-checks backward compatibility: a
// canonical UUID in the POST body must still create a row, and the response
// must still return the short form.
func TestShortIds_CanonicalStillAccepted(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	token := createTestUser(t, pool, true)
	router := setupRouter(pool)

	uid, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("generate player id: %v", err)
	}
	canonical := uid.String()
	short, err := shortid.Encode(canonical)
	if err != nil {
		t.Fatalf("encode short id: %v", err)
	}

	// Send the CANONICAL form (what old clients do).
	body := `{"id":"` + canonical + `","name":"CanonicalPlayer"}`
	req := httptest.NewRequest(http.MethodPost, "/players", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("create with canonical id: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Response must still carry the short form (the outbound encoder runs regardless).
	var resp struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Data.ID != short {
		t.Errorf("response id = %q, want short %q (canonical input must still produce short output)", resp.Data.ID, short)
	}

	// The middleware must not have leaked the canonical form into the response body.
	if strings.Contains(w.Body.String(), canonical) {
		t.Errorf("response leaked canonical id: %s", w.Body.String())
	}
}
