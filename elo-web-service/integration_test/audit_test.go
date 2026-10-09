//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
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
	EntityID   string          `json:"entity_id"`
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
	if w := doJSON(t, router, http.MethodPatch, "/games/"+gameID, bob, `{"alias":"Новое имя","name_en":"Старое имя"}`); w.Code != http.StatusOK {
		t.Fatalf("rename game: %d %s", w.Code, w.Body.String())
	}

	// Rename to the same name: no change, no extra event.
	if w := doJSON(t, router, http.MethodPatch, "/games/"+gameID, bob, `{"alias":"Новое имя","name_en":"Старое имя"}`); w.Code != http.StatusOK {
		t.Fatalf("no-op rename game: %d %s", w.Code, w.Body.String())
	}

	// Idempotent replay of the create: still no second "created" event.
	if w := doJSON(t, router, http.MethodPost, "/games", alice, `{"id":"`+gameID+`","name":"Старое имя"}`); w.Code != http.StatusOK {
		t.Fatalf("replay create game: %d %s", w.Code, w.Body.String())
	}

	page := listAudit(t, router, "?entity_type=game")
	if len(page.Data) != 2 {
		t.Fatalf("expected 2 game events (created, updated with the rename diff), got %d: %+v", len(page.Data), page.Data)
	}
	// Latest first: the update precedes the created event.
	if page.Data[0].Action != "updated" || page.Data[1].Action != "created" {
		t.Errorf("order = [%s, %s], want [updated, created]", page.Data[0].Action, page.Data[1].Action)
	}
	if page.Data[1].ActorName != "Алиса" || page.Data[0].ActorName != "Боб" {
		t.Errorf("actors = [%s created, %s updated], want [Алиса, Боб]", page.Data[1].ActorName, page.Data[0].ActorName)
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

	// The rename rides the field diff: display name and alias both moved.
	var updateDetails struct {
		Name *struct {
			From *string `json:"from"`
			To   *string `json:"to"`
		} `json:"name"`
		Alias *struct {
			From *string `json:"from"`
			To   *string `json:"to"`
		} `json:"alias"`
	}
	if err := json.Unmarshal(page.Data[0].Details, &updateDetails); err != nil {
		t.Fatalf("update details: %v (%s)", err, page.Data[0].Details)
	}
	if updateDetails.Name == nil || updateDetails.Name.From == nil || *updateDetails.Name.From != "Старое имя" ||
		updateDetails.Name.To == nil || *updateDetails.Name.To != "Новое имя" {
		t.Errorf("name diff = %+v, want Старое имя → Новое имя", updateDetails.Name)
	}
	if updateDetails.Alias == nil || updateDetails.Alias.From != nil || updateDetails.Alias.To == nil || *updateDetails.Alias.To != "Новое имя" {
		t.Errorf("alias diff = %+v, want null → Новое имя", updateDetails.Alias)
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
	// The match edit is tenant-gated (ADR-36): make both players «Синие люди»
	// members so the update passes the feed-membership check.
	for _, pid := range []string{playerA, playerB} {
		if err := addBlueMenStint(context.Background(), pool, idpkg.ID(pid)); err != nil {
			t.Fatalf("add stint: %v", err)
		}
	}

	matchID := string(newID(t))
	matchDate := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
	createBody := fmt.Sprintf(`{"id":%q,"game_id":%q,"date":%q,"score":{%q:10,%q:5}}`, matchID, gameID, matchDate, playerA, playerB)
	if w := doJSON(t, router, http.MethodPost, "/tenants/"+blueMenTenantUUID+"/matches", alice, createBody); w.Code != http.StatusOK {
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
	if w := doJSON(t, router, http.MethodPut, "/matches/"+matchID+"?tenant="+string(blueMenTenantID.Base58()), bob, updateBody); w.Code != http.StatusOK {
		t.Fatalf("update match: %d %s", w.Code, w.Body.String())
	}

	// Same body again: a no-op edit must not add an audit row.
	if w := doJSON(t, router, http.MethodPut, "/matches/"+matchID+"?tenant="+string(blueMenTenantID.Base58()), bob, updateBody); w.Code != http.StatusOK {
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
	wantActions := []string{"deleted", "updated", "created"}
	for i, want := range wantActions {
		if playerPage.Data[i].Action != want {
			t.Errorf("player event %d = %s, want %s", i, playerPage.Data[i].Action, want)
		}
	}
	var playerNameDiff struct {
		Name *struct {
			From *string `json:"from"`
			To   *string `json:"to"`
		} `json:"name"`
	}
	if err := json.Unmarshal(playerPage.Data[1].Details, &playerNameDiff); err != nil {
		t.Fatalf("player update details: %v (%s)", err, playerPage.Data[1].Details)
	}
	if playerNameDiff.Name == nil || playerNameDiff.Name.From == nil || *playerNameDiff.Name.From != "Старый" ||
		playerNameDiff.Name.To == nil || *playerNameDiff.Name.To != "Новый" {
		t.Errorf("player name diff = %+v, want Старый → Новый", playerNameDiff.Name)
	}

	clubID := string(newID(t))
	if w := doJSON(t, router, http.MethodPost, "/clubs", alice, `{"id":"`+clubID+`","name":"Клуб Один"}`); w.Code != http.StatusOK {
		t.Fatalf("create club: %d %s", w.Code, w.Body.String())
	}
	// Icon-only patch: audited as a club-update event (ADR-36).
	if w := doJSON(t, router, http.MethodPatch, "/clubs/"+clubID, alice, `{"icon":"clover"}`); w.Code != http.StatusOK {
		t.Fatalf("patch club icon: %d %s", w.Code, w.Body.String())
	}
	if w := doJSON(t, router, http.MethodPatch, "/clubs/"+clubID, alice, `{"name":"Клуб Два"}`); w.Code != http.StatusOK {
		t.Fatalf("rename club: %d %s", w.Code, w.Body.String())
	}

	clubPage := listAudit(t, router, "?entity_type=club&entity_id="+clubID)
	if len(clubPage.Data) != 3 {
		t.Fatalf("expected 3 club events (rename diff, icon, created), got %+v", clubPage.Data)
	}
	wantClubActions := []string{"updated", "updated", "created"}
	for i, want := range wantClubActions {
		if clubPage.Data[i].Action != want {
			t.Errorf("club event %d = %s, want %s", i, clubPage.Data[i].Action, want)
		}
	}
	var iconChange struct {
		Icon *struct {
			From *string `json:"from"`
			To   *string `json:"to"`
		} `json:"icon"`
	}
	if err := json.Unmarshal(clubPage.Data[1].Details, &iconChange); err != nil {
		t.Fatalf("club icon details: %v (%s)", err, clubPage.Data[1].Details)
	}
	if iconChange.Icon == nil || iconChange.Icon.From != nil || iconChange.Icon.To == nil || *iconChange.Icon.To != "clover" {
		t.Errorf("club icon diff = %+v, want null → clover", iconChange.Icon)
	}
	var clubNameDiff struct {
		Name *struct {
			From *string `json:"from"`
			To   *string `json:"to"`
		} `json:"name"`
	}
	if err := json.Unmarshal(clubPage.Data[0].Details, &clubNameDiff); err != nil {
		t.Fatalf("club rename details: %v (%s)", err, clubPage.Data[0].Details)
	}
	if clubNameDiff.Name == nil || clubNameDiff.Name.From == nil || *clubNameDiff.Name.From != "Клуб Один" ||
		clubNameDiff.Name.To == nil || *clubNameDiff.Name.To != "Клуб Два" {
		t.Errorf("club name diff = %+v, want Клуб Один → Клуб Два", clubNameDiff.Name)
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

// TestAuditTenantSettings covers the tenant journal end to end (ADR-36):
// settings and composition changes leave structured tenant-update diff
// documents, and GET /audit?entity_type=tenant lists them. The read side must
// know the kind — a missing conversion in auditDetailsFromStored 500s the
// whole feed with "unknown audit details kind".
func TestAuditTenantSettings(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	router := setupRouter(pool)
	token, _ := createTestUserWithID(t, pool, true)

	tenantID, clubA, _ := createTenant(t, router, token, "Аудит сообществ", "any_member", "open")

	// An openness change leaves the structured openness diff.
	if w := doJSON(t, router, http.MethodPatch, "/tenants/"+tenantID.String(), token,
		`{"arena_membership_mode": "members_only", "tournaments_openness": "members_only"}`); w.Code != http.StatusOK {
		t.Fatalf("PATCH tenant openness: %d %s", w.Code, w.Body.String())
	}
	// An arena settings change leaves the starting-rating pair.
	if w := doJSON(t, router, http.MethodPatch, "/tenants/"+tenantID.String(), token,
		`{"settings": {"starting_rating": 100, "catch_up": {"earned_min": 2, "earned_max": 64, "tau": 100}, "leagues": []}}`); w.Code != http.StatusOK {
		t.Fatalf("PATCH tenant settings: %d %s", w.Code, w.Body.String())
	}

	page := listAudit(t, router, "?entity_type=tenant")
	// Latest first: the settings change, the openness change, then the create.
	if len(page.Data) < 3 {
		t.Fatalf("tenant audit has %d entries, want at least 3", len(page.Data))
	}
	for i, e := range page.Data[:2] {
		if e.EntityType != "tenant" || e.Action != "updated" {
			t.Fatalf("entry %d = %s/%s, want tenant/updated", i, e.EntityType, e.Action)
		}
		if e.EntityID != string(tenantID.Base58()) {
			t.Fatalf("entry %d entity_id = %s, want the tenant %s", i, e.EntityID, tenantID.Base58())
		}
	}

	var opennessDoc struct {
		ArenaMembershipMode *struct {
			From string `json:"from"`
			To   string `json:"to"`
		} `json:"arena_membership_mode"`
		TournamentsOpenness *struct {
			From string `json:"from"`
			To   string `json:"to"`
		} `json:"tournaments_openness"`
	}
	if err := json.Unmarshal(page.Data[1].Details, &opennessDoc); err != nil {
		t.Fatalf("decode openness diff: %v", err)
	}
	if opennessDoc.ArenaMembershipMode == nil || opennessDoc.ArenaMembershipMode.From != "any_member" || opennessDoc.ArenaMembershipMode.To != "members_only" {
		t.Fatalf("openness diff mode = %+v", opennessDoc.ArenaMembershipMode)
	}

	var settingsDoc struct {
		StartingRating *struct {
			From float64 `json:"from"`
			To   float64 `json:"to"`
		} `json:"starting_rating"`
		LeaguesChanged bool `json:"leagues_changed"`
	}
	if err := json.Unmarshal(page.Data[0].Details, &settingsDoc); err != nil {
		t.Fatalf("decode settings diff: %v", err)
	}
	if settingsDoc.StartingRating == nil || settingsDoc.StartingRating.To != 100 {
		t.Fatalf("starting_rating diff = %+v, want → 100", settingsDoc.StartingRating)
	}

	// The club attach on create recorded the club id in the created event's
	// entity details; the composition change path is covered by the tenants
	// tests — here the plain created entry closes the lifecycle.
	if page.Data[2].Action != "created" {
		t.Fatalf("oldest entry = %s, want created", page.Data[2].Action)
	}
	_ = clubA
}

// TestAuditUserPermissionToggle covers the /admin/users audit flow: granting
// and revoking the edit permission each leave one user-update event with the
// before → after pair, the target user as entity and the acting admin as
// actor; a no-op PATCH (same value) leaves no event.
func TestAuditUserPermissionToggle(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	router := setupRouter(pool)
	admin, _ := createTestUserWithID(t, pool, true)
	_, targetID := createTestUserWithID(t, pool, false)

	if w := doJSON(t, router, http.MethodPatch, "/users/"+targetID, admin, `{"can_edit": true}`); w.Code != http.StatusOK {
		t.Fatalf("grant: %d %s", w.Code, w.Body.String())
	}
	// No-op: same value again — nothing to audit.
	if w := doJSON(t, router, http.MethodPatch, "/users/"+targetID, admin, `{"can_edit": true}`); w.Code != http.StatusOK {
		t.Fatalf("no-op grant: %d %s", w.Code, w.Body.String())
	}
	if w := doJSON(t, router, http.MethodPatch, "/users/"+targetID, admin, `{"can_edit": false}`); w.Code != http.StatusOK {
		t.Fatalf("revoke: %d %s", w.Code, w.Body.String())
	}

	page := listAudit(t, router, "?entity_type=user")
	if len(page.Data) != 2 {
		t.Fatalf("expected 2 user events (granted, revoked), got %d: %+v", len(page.Data), page.Data)
	}
	wantEntity := short(idpkg.ID(targetID))
	for i, e := range page.Data {
		if e.Action != "updated" || e.EntityID != wantEntity || e.ActorName == "" {
			t.Fatalf("event %d = {action:%s entity:%s actor:%q}, want updated on %s by the admin", i, e.Action, e.EntityID, e.ActorName, wantEntity)
		}
	}

	var detailsOf = func(i int) struct {
		AllowEditing struct {
			From bool `json:"from"`
			To   bool `json:"to"`
		} `json:"allow_editing"`
	} {
		var d struct {
			AllowEditing struct {
				From bool `json:"from"`
				To   bool `json:"to"`
			} `json:"allow_editing"`
		}
		if err := json.Unmarshal(page.Data[i].Details, &d); err != nil {
			t.Fatalf("details %d: %v (%s)", i, err, page.Data[i].Details)
		}
		return d
	}
	// Latest first: the revoke precedes the grant.
	if got := detailsOf(0); !got.AllowEditing.From || got.AllowEditing.To {
		t.Fatalf("revoke diff = %+v, want true → false", got.AllowEditing)
	}
	if got := detailsOf(1); got.AllowEditing.From || !got.AllowEditing.To {
		t.Fatalf("grant diff = %+v, want false → true", got.AllowEditing)
	}
}

// TestAuditClubMembershipAndIcon covers the club admin page's new audit flow:
// an icon set and each membership add/remove leave one club-update event —
// icon diffs carry the before → after key, membership diffs the player id —
// while no-ops (same icon, stint already open, closing an absent stint)
// leave nothing.
func TestAuditClubMembershipAndIcon(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	router := setupRouter(pool)
	admin, _ := createTestUserWithID(t, pool, true)

	clubID := string(newID(t))
	if w := doJSON(t, router, http.MethodPost, "/clubs", admin, `{"id":"`+clubID+`","name":"Аудит-клуб"}`); w.Code != http.StatusOK {
		t.Fatalf("create club: %d %s", w.Code, w.Body.String())
	}
	player := createTestPlayer(t, pool, "Участник")

	if w := doJSON(t, router, http.MethodPatch, "/clubs/"+clubID, admin, `{"icon": "blue-figure"}`); w.Code != http.StatusOK {
		t.Fatalf("set icon: %d %s", w.Code, w.Body.String())
	}
	// Same icon again: a no-op, no second icon event.
	if w := doJSON(t, router, http.MethodPatch, "/clubs/"+clubID, admin, `{"icon": "blue-figure"}`); w.Code != http.StatusOK {
		t.Fatalf("re-set icon: %d %s", w.Code, w.Body.String())
	}

	if w := doJSON(t, router, http.MethodPost, "/clubs/"+clubID+"/members", admin, `{"player_id": "`+player.String()+`"}`); w.Code != http.StatusOK {
		t.Fatalf("add member: %d %s", w.Code, w.Body.String())
	}
	// Re-add while the stint is open: no-op, no second membership event.
	if w := doJSON(t, router, http.MethodPost, "/clubs/"+clubID+"/members", admin, `{"player_id": "`+player.String()+`"}`); w.Code != http.StatusOK {
		t.Fatalf("re-add member: %d %s", w.Code, w.Body.String())
	}
	if w := doJSON(t, router, http.MethodDelete, "/clubs/"+clubID+"/members/"+player.String(), admin, ""); w.Code != http.StatusOK {
		t.Fatalf("remove member: %d %s", w.Code, w.Body.String())
	}
	// Closing an already-closed stint: no-op, no event.
	if w := doJSON(t, router, http.MethodDelete, "/clubs/"+clubID+"/members/"+player.String(), admin, ""); w.Code != http.StatusOK {
		t.Fatalf("re-remove member: %d %s", w.Code, w.Body.String())
	}

	page := listAudit(t, router, "?entity_type=club")
	// The create closes the feed; between it and the newest event exactly the
	// icon set, the join and the leave.
	if len(page.Data) != 4 {
		t.Fatalf("expected 4 club events (created, icon, joined, left), got %d: %+v", len(page.Data), page.Data)
	}
	if page.Data[0].Action != "updated" || page.Data[1].Action != "updated" || page.Data[2].Action != "updated" || page.Data[3].Action != "created" {
		t.Fatalf("actions = [%s, %s, %s, %s], want [updated, updated, updated, created]",
			page.Data[0].Action, page.Data[1].Action, page.Data[2].Action, page.Data[3].Action)
	}
	if page.Data[0].ActorName != page.Data[1].ActorName || page.Data[0].ActorName == "" {
		t.Fatalf("actors = [%q, %q], want the admin on the new events", page.Data[0].ActorName, page.Data[1].ActorName)
	}

	var iconDoc struct {
		Icon *struct {
			From *string `json:"from"`
			To   *string `json:"to"`
		} `json:"icon"`
	}
	if err := json.Unmarshal(page.Data[2].Details, &iconDoc); err != nil {
		t.Fatalf("icon details: %v (%s)", err, page.Data[2].Details)
	}
	if iconDoc.Icon == nil || iconDoc.Icon.From != nil || iconDoc.Icon.To == nil || *iconDoc.Icon.To != "blue-figure" {
		t.Fatalf("icon diff = %+v, want null → blue-figure", iconDoc.Icon)
	}

	var joinDoc, leaveDoc struct {
		Players *struct {
			AddedPlayerIDs   []string `json:"added_player_ids"`
			RemovedPlayerIDs []string `json:"removed_player_ids"`
		} `json:"players"`
	}
	if err := json.Unmarshal(page.Data[1].Details, &joinDoc); err != nil {
		t.Fatalf("join details: %v (%s)", err, page.Data[1].Details)
	}
	if err := json.Unmarshal(page.Data[0].Details, &leaveDoc); err != nil {
		t.Fatalf("leave details: %v (%s)", err, page.Data[0].Details)
	}
	wantPlayer := short(player)
	if joinDoc.Players == nil || len(joinDoc.Players.AddedPlayerIDs) != 1 || joinDoc.Players.AddedPlayerIDs[0] != wantPlayer {
		t.Fatalf("join diff = %+v, want [%s] added", joinDoc.Players, wantPlayer)
	}
	if leaveDoc.Players == nil || len(leaveDoc.Players.RemovedPlayerIDs) != 1 || leaveDoc.Players.RemovedPlayerIDs[0] != wantPlayer {
		t.Fatalf("leave diff = %+v, want [%s] removed", leaveDoc.Players, wantPlayer)
	}
}

// TestAuditArenaUpdate covers the user-managed arena surface (ADR-24): a
// rename/settings/filter change leaves one arena-update row with the field
// diff; a no-op update leaves no row.
func TestAuditArenaUpdate(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	router := setupRouter(pool)
	editor, _ := createTestUserWithID(t, pool, true)

	w := doJSON(t, router, http.MethodPost, "/arenas", editor,
		`{"name":"кланк (аудит)","filter":{"game_ids":[],"tag_ids":[]},"settings":{"starting_rating":1000,"catch_up":{"earned_min":2,"earned_max":64,"tau":100},"leagues":[]}}`)
	if w.Code != http.StatusOK {
		t.Fatalf("POST /arenas: %d %s", w.Code, w.Body.String())
	}
	var created struct {
		Data struct {
			Id string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}

	// Rename + starting-rating change: one combined diff.
	if w := doJSON(t, router, http.MethodPatch, "/arenas/"+created.Data.Id, editor,
		`{"name":"кланк (аудит) v2","filter":{"game_ids":[],"tag_ids":[]},"settings":{"starting_rating":950,"catch_up":{"earned_min":2,"earned_max":64,"tau":100},"leagues":[]}}`); w.Code != http.StatusOK {
		t.Fatalf("PATCH arena: %d %s", w.Code, w.Body.String())
	}
	// A no-op update (same body again) must add no row.
	if w := doJSON(t, router, http.MethodPatch, "/arenas/"+created.Data.Id, editor,
		`{"name":"кланк (аудит) v2","filter":{"game_ids":[],"tag_ids":[]},"settings":{"starting_rating":950,"catch_up":{"earned_min":2,"earned_max":64,"tau":100},"leagues":[]}}`); w.Code != http.StatusOK {
		t.Fatalf("no-op PATCH arena: %d %s", w.Code, w.Body.String())
	}

	page := listAudit(t, router, "?entity_type=arena&entity_id="+created.Data.Id)
	if len(page.Data) != 1 {
		t.Fatalf("arena audit has %d entries, want exactly 1 (the changed update; create emits no details row and the no-op none)", len(page.Data))
	}
	e := page.Data[0]
	if e.Action != "updated" || e.EntityType != "arena" {
		t.Fatalf("entry = %s/%s, want arena/updated", e.EntityType, e.Action)
	}

	var doc struct {
		Name *struct {
			From string `json:"from"`
			To   string `json:"to"`
		} `json:"name"`
		StartingRating *struct {
			From float64 `json:"from"`
			To   float64 `json:"to"`
		} `json:"starting_rating"`
		LeaguesChanged bool `json:"leagues_changed"`
		FilterChanged  bool `json:"filter_changed"`
	}
	if err := json.Unmarshal(e.Details, &doc); err != nil {
		t.Fatalf("details: %v (%s)", err, e.Details)
	}
	if doc.Name == nil || doc.Name.From != "кланк (аудит)" || doc.Name.To != "кланк (аудит) v2" {
		t.Fatalf("name diff = %+v, want rename", doc.Name)
	}
	if doc.StartingRating == nil || doc.StartingRating.From != 1000 || doc.StartingRating.To != 950 {
		t.Fatalf("starting_rating diff = %+v, want 1000 → 950", doc.StartingRating)
	}
	if doc.LeaguesChanged || doc.FilterChanged {
		t.Errorf("leagues/filter changed = %v/%v, want false/false", doc.LeaguesChanged, doc.FilterChanged)
	}
}
