//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	apioauth2 "github.com/tolyandre/elo-web-service/pkg/api/oauth2"
	"github.com/tolyandre/elo-web-service/pkg/db"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

// createNamedTestUser is createTestUser with a custom google id and display
// name, so audit tests can distinguish two actors.
func createNamedTestUser(t *testing.T, pool *pgxpool.Pool, googleID, name string) string {
	t.Helper()
	queries := db.New(pool)
	uid, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("generate user id: %v", err)
	}
	userID, err := queries.CreateUser(context.Background(), db.CreateUserParams{
		ID:                  idpkg.ID(uid.String()),
		AllowEditing:        true,
		GoogleOauthUserID:   googleID,
		GoogleOauthUserName: name,
	})
	if err != nil {
		t.Fatalf("create test user: %v", err)
	}
	token, err := apioauth2.CreateJwt(time.Hour, string(userID), testJWTSecret)
	if err != nil {
		t.Fatalf("create JWT: %v", err)
	}
	return token
}

type auditEntryJSON struct {
	ID         string          `json:"id"`
	CreatedAt  time.Time       `json:"created_at"`
	ActorName  string          `json:"actor_name"`
	EntityType string          `json:"entity_type"`
	Action     string          `json:"action"`
	Details    json.RawMessage `json:"details"`
}

type auditPageJSON struct {
	Data []auditEntryJSON `json:"data"`
	Next *string          `json:"next"`
}

func listAudit(t *testing.T, router interface {
	ServeHTTP(http.ResponseWriter, *http.Request)
}, query string) auditPageJSON {
	t.Helper()
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/audit"+query, nil))
	if w.Code != http.StatusOK {
		t.Fatalf("GET /audit%s: expected 200, got %d: %s", query, w.Code, w.Body.String())
	}
	var page auditPageJSON
	if err := json.NewDecoder(w.Body).Decode(&page); err != nil {
		t.Fatalf("decode audit page: %v", err)
	}
	return page
}

func doJSON(t *testing.T, router interface {
	ServeHTTP(http.ResponseWriter, *http.Request)
}, method, path, token, body string) *httptest.ResponseRecorder {
	t.Helper()
	var req *http.Request
	if body == "" {
		req = httptest.NewRequest(method, path, nil)
	} else {
		req = httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

// TestAuditGameLifecycleAndRename covers the admin-entity audit flow over HTTP:
// create, rename, delete each leave one event with the right actor and details
// (rename carries old→new name), listed latest-first.
func TestAuditGameLifecycleAndRename(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	alice := createNamedTestUser(t, pool, "audit-alice", "Алиса")
	bob := createNamedTestUser(t, pool, "audit-bob", "Боб")
	router := setupRouter(pool)

	gameID := string(newID(t))
	if w := doJSON(t, router, http.MethodPost, "/games", alice, `{"id":"`+gameID+`","name":"Старое имя"}`); w.Code != http.StatusOK {
		t.Fatalf("create game: %d %s", w.Code, w.Body.String())
	}
	if w := doJSON(t, router, http.MethodPatch, "/games/"+gameID, bob, `{"name":"Новое имя"}`); w.Code != http.StatusOK {
		t.Fatalf("rename game: %d %s", w.Code, w.Body.String())
	}

	// Rename to the same name: no change, no extra event.
	if w := doJSON(t, router, http.MethodPatch, "/games/"+gameID, bob, `{"name":"Новое имя"}`); w.Code != http.StatusOK {
		t.Fatalf("no-op rename game: %d %s", w.Code, w.Body.String())
	}

	// Idempotent replay of the create: still no second "created" event.
	if w := doJSON(t, router, http.MethodPost, "/games", alice, `{"id":"`+gameID+`","name":"Старое имя"}`); w.Code != http.StatusOK {
		t.Fatalf("replay create game: %d %s", w.Code, w.Body.String())
	}

	page := listAudit(t, router, "?entity_type=game")
	if len(page.Data) != 2 {
		t.Fatalf("expected 2 game events (created, renamed), got %d: %+v", len(page.Data), page.Data)
	}
	// Latest first: the rename precedes the created event.
	if page.Data[0].Action != "renamed" || page.Data[1].Action != "created" {
		t.Errorf("order = [%s, %s], want [renamed, created]", page.Data[0].Action, page.Data[1].Action)
	}
	if page.Data[1].ActorName != "Алиса" || page.Data[0].ActorName != "Боб" {
		t.Errorf("actors = [%s created, %s renamed], want [Алиса, Боб]", page.Data[1].ActorName, page.Data[0].ActorName)
	}

	var createdDetails struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(page.Data[1].Details, &createdDetails); err != nil {
		t.Fatalf("created details: %v (%s)", err, page.Data[1].Details)
	}
	if createdDetails.Name != "Старое имя" {
		t.Errorf("created details name = %q, want %q", createdDetails.Name, "Старое имя")
	}

	var renameDetails struct {
		OldName string `json:"old_name"`
		NewName string `json:"new_name"`
	}
	if err := json.Unmarshal(page.Data[0].Details, &renameDetails); err != nil {
		t.Fatalf("rename details: %v (%s)", err, page.Data[0].Details)
	}
	if renameDetails.OldName != "Старое имя" || renameDetails.NewName != "Новое имя" {
		t.Errorf("rename details = %+v, want Старое имя → Новое имя", renameDetails)
	}

	// Delete captures the name; the game has no matches so the delete succeeds.
	if w := doJSON(t, router, http.MethodDelete, "/games/"+gameID, alice, ""); w.Code != http.StatusOK {
		t.Fatalf("delete game: %d %s", w.Code, w.Body.String())
	}
	page = listAudit(t, router, "?entity_type=game")
	if len(page.Data) != 3 || page.Data[0].Action != "deleted" {
		t.Fatalf("expected deleted as the newest of 3 events, got %+v", page.Data)
	}
	var deletedDetails struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(page.Data[0].Details, &deletedDetails); err != nil || deletedDetails.Name != "Новое имя" {
		t.Errorf("deleted details = %s, want name Новое имя", page.Data[0].Details)
	}
}

// TestAuditMatchCreateAndUpdate covers the match flow: the created event has no
// details, an edit records the full diff (date, score changes with Base58 ids
// on the wire), and a no-op edit records nothing.
func TestAuditMatchCreateAndUpdate(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	alice := createNamedTestUser(t, pool, "audit-alice", "Алиса")
	bob := createNamedTestUser(t, pool, "audit-bob", "Боб")
	router := setupRouter(pool)

	gameID := string(newID(t))
	playerA := string(newID(t))
	playerB := string(newID(t))
	if w := doJSON(t, router, http.MethodPost, "/games", alice, `{"id":"`+gameID+`","name":"Game"}`); w.Code != http.StatusOK {
		t.Fatalf("create game: %d %s", w.Code, w.Body.String())
	}
	// UUIDv7 ids minted in the same millisecond share their prefix, so name
	// the players explicitly instead of deriving names from id prefixes.
	if w := doJSON(t, router, http.MethodPost, "/players", alice, `{"id":"`+playerA+`","name":"Игрок А"}`); w.Code != http.StatusOK {
		t.Fatalf("create player: %d %s", w.Code, w.Body.String())
	}
	if w := doJSON(t, router, http.MethodPost, "/players", alice, `{"id":"`+playerB+`","name":"Игрок Б"}`); w.Code != http.StatusOK {
		t.Fatalf("create player: %d %s", w.Code, w.Body.String())
	}

	matchID := string(newID(t))
	matchDate := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
	createBody := fmt.Sprintf(`{"id":%q,"game_id":%q,"date":%q,"score":{%q:10,%q:5}}`, matchID, gameID, matchDate, playerA, playerB)
	if w := doJSON(t, router, http.MethodPost, "/matches", alice, createBody); w.Code != http.StatusOK {
		t.Fatalf("create match: %d %s", w.Code, w.Body.String())
	}

	page := listAudit(t, router, "?entity_type=match&entity_id="+matchID)
	if len(page.Data) != 1 || page.Data[0].Action != "created" {
		t.Fatalf("expected single created event, got %+v", page.Data)
	}
	// The created event carries no details; the key may be absent or null.
	if d := string(page.Data[0].Details); d != "" && d != "null" {
		t.Errorf("created details = %s, want null", d)
	}
	if page.Data[0].ActorName != "Алиса" {
		t.Errorf("created actor = %q, want Алиса", page.Data[0].ActorName)
	}

	// Edit: change A's score and shift the date 30 minutes forward.
	newDate := time.Now().Add(-30 * time.Minute).UTC().Format(time.RFC3339)
	updateBody := fmt.Sprintf(`{"game_id":%q,"date":%q,"score":{%q:20,%q:5}}`, gameID, newDate, playerA, playerB)
	if w := doJSON(t, router, http.MethodPut, "/matches/"+matchID, bob, updateBody); w.Code != http.StatusOK {
		t.Fatalf("update match: %d %s", w.Code, w.Body.String())
	}

	// Same body again: a no-op edit must not add an audit row.
	if w := doJSON(t, router, http.MethodPut, "/matches/"+matchID, bob, updateBody); w.Code != http.StatusOK {
		t.Fatalf("no-op update match: %d %s", w.Code, w.Body.String())
	}

	page = listAudit(t, router, "?entity_type=match&entity_id="+matchID)
	if len(page.Data) != 2 {
		t.Fatalf("expected 2 match events (updated, created), got %d: %+v", len(page.Data), page.Data)
	}
	updated := page.Data[0]
	if updated.Action != "updated" || updated.ActorName != "Боб" {
		t.Fatalf("newest event = %+v, want updated by Боб", updated)
	}

	var details struct {
		Date *struct {
			Old string `json:"old"`
			New string `json:"new"`
		} `json:"date"`
		Game          *json.RawMessage `json:"game"`
		PlayerChanges []struct {
			PlayerID string   `json:"player_id"`
			Change   string   `json:"change"`
			OldScore *float64 `json:"old_score"`
			NewScore *float64 `json:"new_score"`
		} `json:"player_changes"`
		CalculatorChanged bool `json:"calculator_changed"`
	}
	if err := json.Unmarshal(updated.Details, &details); err != nil {
		t.Fatalf("updated details: %v (%s)", err, updated.Details)
	}
	if details.Date == nil {
		t.Errorf("date change missing: %s", updated.Details)
	}
	if details.Game != nil {
		t.Errorf("game change unexpected: %s", updated.Details)
	}
	if details.CalculatorChanged {
		t.Errorf("calculator_changed unexpected: %s", updated.Details)
	}
	if len(details.PlayerChanges) != 1 {
		t.Fatalf("player_changes = %+v, want exactly A's score change", details.PlayerChanges)
	}
	pc := details.PlayerChanges[0]
	if pc.Change != "score" || pc.OldScore == nil || *pc.OldScore != 10 || pc.NewScore == nil || *pc.NewScore != 20 {
		t.Errorf("score change = %+v, want 10 → 20", pc)
	}
	// The player id is on the wire in its short Base58 form (ADR-12), not the
	// canonical UUID the test posted.
	if pc.PlayerID == playerA || pc.PlayerID != string(idpkg.ID(playerA).Base58()) {
		t.Errorf("player_id on wire = %q, want Base58 %q", pc.PlayerID, string(idpkg.ID(playerA).Base58()))
	}
}

// TestAuditPlayerAndClubEvents covers player and club create/rename/delete
// events via the shared entity-details document.
func TestAuditPlayerAndClubEvents(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	alice := createNamedTestUser(t, pool, "audit-alice", "Алиса")
	router := setupRouter(pool)

	playerID := string(newID(t))
	if w := doJSON(t, router, http.MethodPost, "/players", alice, `{"id":"`+playerID+`","name":"Старый"}`); w.Code != http.StatusOK {
		t.Fatalf("create player: %d %s", w.Code, w.Body.String())
	}
	if w := doJSON(t, router, http.MethodPatch, "/players/"+playerID, alice, `{"name":"Новый"}`); w.Code != http.StatusOK {
		t.Fatalf("rename player: %d %s", w.Code, w.Body.String())
	}
	if w := doJSON(t, router, http.MethodDelete, "/players/"+playerID, alice, ""); w.Code != http.StatusOK {
		t.Fatalf("delete player: %d %s", w.Code, w.Body.String())
	}

	playerPage := listAudit(t, router, "?entity_type=player")
	if len(playerPage.Data) != 3 {
		t.Fatalf("expected 3 player events, got %+v", playerPage.Data)
	}
	wantActions := []string{"deleted", "renamed", "created"}
	for i, want := range wantActions {
		if playerPage.Data[i].Action != want {
			t.Errorf("player event %d = %s, want %s", i, playerPage.Data[i].Action, want)
		}
	}

	clubID := string(newID(t))
	if w := doJSON(t, router, http.MethodPost, "/clubs", alice, `{"id":"`+clubID+`","name":"Клуб Один"}`); w.Code != http.StatusOK {
		t.Fatalf("create club: %d %s", w.Code, w.Body.String())
	}
	// Icon-only patch: not audited (out of scope by design).
	if w := doJSON(t, router, http.MethodPatch, "/clubs/"+clubID, alice, `{"icon":"clover"}`); w.Code != http.StatusOK {
		t.Fatalf("patch club icon: %d %s", w.Code, w.Body.String())
	}
	if w := doJSON(t, router, http.MethodPatch, "/clubs/"+clubID, alice, `{"name":"Клуб Два"}`); w.Code != http.StatusOK {
		t.Fatalf("rename club: %d %s", w.Code, w.Body.String())
	}

	clubPage := listAudit(t, router, "?entity_type=club&entity_id="+clubID)
	if len(clubPage.Data) != 2 {
		t.Fatalf("expected 2 club events (renamed, created), got %+v", clubPage.Data)
	}
	var rename struct {
		OldName string `json:"old_name"`
		NewName string `json:"new_name"`
	}
	if err := json.Unmarshal(clubPage.Data[0].Details, &rename); err != nil || rename.OldName != "Клуб Один" || rename.NewName != "Клуб Два" {
		t.Errorf("club rename details = %s, want Клуб Один → Клуб Два", clubPage.Data[0].Details)
	}
}

// TestAuditListIsPublicAndPaginated checks the user's visibility decision (the
// audit read is public, like /users and /matches) and cursor pagination.
func TestAuditListIsPublicAndPaginated(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	alice := createNamedTestUser(t, pool, "audit-alice", "Алиса")
	router := setupRouter(pool)

	const total = 5
	ids := make([]string, total)
	for i := 0; i < total; i++ {
		ids[i] = string(newID(t))
		body := fmt.Sprintf(`{"id":%q,"name":"G%d"}`, ids[i], i)
		if w := doJSON(t, router, http.MethodPost, "/games", alice, body); w.Code != http.StatusOK {
			t.Fatalf("create game %d: %d %s", i, w.Code, w.Body.String())
		}
	}

	// No auth header: the read must still succeed.
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/audit?entity_type=game&limit=2", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("public GET /audit: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var first auditPageJSON
	if err := json.NewDecoder(w.Body).Decode(&first); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(first.Data) != 2 || first.Next == nil {
		t.Fatalf("page 1 = %d items, next=%v; want 2 items with cursor", len(first.Data), first.Next)
	}

	w2 := httptest.NewRecorder()
	router.ServeHTTP(w2, httptest.NewRequest(http.MethodGet, "/audit?entity_type=game&limit=2&next="+*first.Next, nil))
	if w2.Code != http.StatusOK {
		t.Fatalf("page 2: expected 200, got %d: %s", w2.Code, w2.Body.String())
	}
	var second auditPageJSON
	if err := json.NewDecoder(w2.Body).Decode(&second); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(second.Data) != 2 {
		t.Fatalf("page 2 = %d items, want 2", len(second.Data))
	}
	// Continuation strictly follows the first page (latest first, no overlap).
	if !first.Data[1].CreatedAt.After(second.Data[0].CreatedAt) &&
		!(first.Data[1].CreatedAt.Equal(second.Data[0].CreatedAt) && first.Data[1].ID > second.Data[0].ID) {
		t.Errorf("continuation out of order: page1 tail %+v, page2 head %+v", first.Data[1], second.Data[0])
	}
}
