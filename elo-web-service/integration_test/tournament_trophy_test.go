//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

// TestTournament_TrophyPool covers the static trophy pool (ADR-26 §UI): the
// create/update payload carries the trophy token (a file name from
// public/trophies, format-validated), the assignment is exclusive across
// tournaments (409 for a taken trophy, free again once cleared), and a PUT
// body without the field clears it (whole-desired-config semantics, like the
// deadline).
func TestTournament_TrophyPool(t *testing.T) {
	ctx := context.Background()
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	router := setupRouter(pool)

	admin, _ := createTestUserWithID(t, pool, true)

	tid := newID(t)
	createBody := fmt.Sprintf(`{
		"id": %q, "name": "Кубковый турнир",
		"trophy": "serpent-hunt"
	}`, short(tid))
	w := doJSON(t, router, http.MethodPost, "/tenants/00000000-0000-0000-0000-000000000101/tournaments", admin, createBody)
	if w.Code != http.StatusOK {
		t.Fatalf("create tournament with trophy: %d %s", w.Code, w.Body.String())
	}
	var created tournamentJSON
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	if created.Data.Trophy == nil || *created.Data.Trophy != "serpent-hunt" {
		t.Fatalf("trophy must round-trip, got %+v", created.Data.Trophy)
	}

	// The trophy is exclusive while the tournament holds it: another
	// tournament picking the same token is a 409 naming the holder.
	otherID := newID(t)
	takenBody := fmt.Sprintf(`{
		"id": %q, "name": "Второй турнир",
		"trophy": "serpent-hunt"
	}`, short(otherID))
	w = doJSON(t, router, http.MethodPost, "/tenants/00000000-0000-0000-0000-000000000101/tournaments", admin, takenBody)
	if w.Code != http.StatusConflict {
		t.Fatalf("taken trophy must 409, got %d %s", w.Code, w.Body.String())
	}

	// A token that cannot be a pool file name is rejected; a well-formed but
	// file-less token is accepted (like club icons, the API validates the
	// format, not the file's existence — the pickers only offer real files).
	w = doJSON(t, router, http.MethodPost, "/tenants/00000000-0000-0000-0000-000000000101/tournaments", admin,
		fmt.Sprintf(`{"id": %q, "name": "Второй турнир", "trophy": "../evil"}`, short(otherID)))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("malformed trophy must 400, got %d %s", w.Code, w.Body.String())
	}

	// The refused creates left no rows: the second tournament starts clean
	// and takes a free trophy instead.
	w = doJSON(t, router, http.MethodPost, "/tenants/00000000-0000-0000-0000-000000000101/tournaments", admin,
		fmt.Sprintf(`{"id": %q, "name": "Второй турнир"}`, short(otherID)))
	if w.Code != http.StatusOK {
		t.Fatalf("create second tournament: %d %s", w.Code, w.Body.String())
	}
	updateBody := `{"name": "Второй турнир", "trophy": "clank-legacy"}`
	w = doJSON(t, router, http.MethodPut, "/tournaments/"+short(otherID), admin, updateBody)
	if w.Code != http.StatusOK {
		t.Fatalf("update tournament trophy: %d %s", w.Code, w.Body.String())
	}

	// Clearing the trophy frees it: the PUT body carries the whole desired
	// config, so an absent trophy clears it.
	w = doJSON(t, router, http.MethodPut, "/tournaments/"+short(otherID), admin, `{"name": "Второй турнир"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("clear trophy: %d %s", w.Code, w.Body.String())
	}
	var cleared tournamentJSON
	if err := json.Unmarshal(w.Body.Bytes(), &cleared); err != nil {
		t.Fatalf("decode clear response: %v", err)
	}
	if cleared.Data.Trophy != nil {
		t.Fatalf("trophy must be cleared, got %q", *cleared.Data.Trophy)
	}

	// …and the freed trophy is assignable again — by the second tournament.
	w = doJSON(t, router, http.MethodPut, "/tournaments/"+short(otherID), admin, updateBody)
	if w.Code != http.StatusOK {
		t.Fatalf("re-pick freed trophy: %d %s", w.Code, w.Body.String())
	}

	// Re-picking the tournament's own trophy stays allowed (a no-op write).
	w = doJSON(t, router, http.MethodPut, "/tournaments/"+short(otherID), admin, updateBody)
	if w.Code != http.StatusOK {
		t.Fatalf("own trophy re-pick: %d %s", w.Code, w.Body.String())
	}

	// The audit trail carries the trophy change as a before → after pair.
	page := listAudit(t, router, "?entity_type=tournament&entity_id="+short(otherID))
	var trophyChange struct {
		Trophy *struct {
			From *string `json:"from"`
			To   *string `json:"to"`
		} `json:"trophy"`
	}
	found := false
	for _, e := range page.Data {
		if e.Action != "updated" || json.Unmarshal(e.Details, &trophyChange) != nil || trophyChange.Trophy == nil {
			continue
		}
		found = true
		if trophyChange.Trophy.To == nil || *trophyChange.Trophy.To != "clank-legacy" {
			t.Fatalf("trophy audit 'to' side: %+v", trophyChange.Trophy)
		}
		break
	}
	if !found {
		t.Fatalf("no trophy change in the audit trail (%d rows)", len(page.Data))
	}

	// Past registration the config is frozen: a running tournament's PUT is a
	// 409 even for the trophy alone.
	runningID := idpkg.New()
	if _, err := pool.Exec(ctx,
		`INSERT INTO tournaments (id, tenant_id, name, status) VALUES ($1, '00000000-0000-0000-0000-000000000101', 'Идущий турнир', 'running')`,
		runningID); err != nil {
		t.Fatalf("insert running tournament: %v", err)
	}
	w = doJSON(t, router, http.MethodPut, "/tournaments/"+short(runningID), admin, updateBody)
	if w.Code != http.StatusConflict {
		t.Fatalf("trophy on a running tournament must 409, got %d %s", w.Code, w.Body.String())
	}
}
