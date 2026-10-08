//go:build integration

package integration_test

// Tenants (ADR-36): the «Синие люди» tenant with its global-arena main arena
// and the two seeded clubs, the tenant lifecycle (create / settings /
// composition), the stint-based club membership, and the attribution phase:
// tenant-arena membership per openness at the match date (members of any club
// of the tenant count), members-only listing, and the mode/composition-change
// recalculation.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/elo"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

const blueMenClubUUID = "00000000-0000-0000-0000-000000000001"

type clubJSON struct {
	Id          string   `json:"id"`
	Name        string   `json:"name"`
	PlayerIds   []string `json:"player_ids"`
	TenantId    *string  `json:"tenant_id"`
	GeologistId *string  `json:"geologist_name"`
}

type clubsListJSON struct {
	Status string     `json:"status"`
	Data   []clubJSON `json:"data"`
}

func listClubs(t *testing.T, router interface {
	ServeHTTP(http.ResponseWriter, *http.Request)
}) []clubJSON {
	t.Helper()
	w := doJSON(t, router, http.MethodGet, "/clubs", "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET /clubs: %d %s", w.Code, w.Body.String())
	}
	var resp clubsListJSON
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode clubs: %v", err)
	}
	return resp.Data
}

func getClub(t *testing.T, router interface {
	ServeHTTP(http.ResponseWriter, *http.Request)
}, id string) (int, *clubJSON) {
	t.Helper()
	w := doJSON(t, router, http.MethodGet, "/clubs/"+id, "", "")
	if w.Code != http.StatusOK {
		return w.Code, nil
	}
	var resp struct {
		Status string   `json:"status"`
		Data   clubJSON `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode club: %v", err)
	}
	return w.Code, &resp.Data
}

type tenantJSON struct {
	Id                  string   `json:"id"`
	Name                string   `json:"name"`
	ClubIds             []string `json:"club_ids"`
	ArenaMembershipMode string   `json:"arena_membership_mode"`
	TournamentsOpenness string   `json:"tournaments_openness"`
	MainArenaId         string   `json:"main_arena_id"`
}

func getTenant(t *testing.T, router interface {
	ServeHTTP(http.ResponseWriter, *http.Request)
}, id string) (int, *tenantJSON) {
	t.Helper()
	w := doJSON(t, router, http.MethodGet, "/tenants/"+id, "", "")
	if w.Code != http.StatusOK {
		return w.Code, nil
	}
	var resp struct {
		Status string     `json:"status"`
		Data   tenantJSON `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode tenant: %v", err)
	}
	return w.Code, &resp.Data
}

// TestTenants_BlueMenBackfill pins the migration backfill: the «Синие люди»
// tenant owns the global arena as its main arena, carries the «Все партии»
// openness (all — migration 075) / open, and holds both clubs («Синие люди»
// and «Весёлые карточные игры»).
func TestTenants_BlueMenBackfill(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	router := setupRouter(pool)

	code, tenant := getTenant(t, router, blueMenTenantUUID)
	if code != http.StatusOK {
		t.Fatalf("GET /tenants/%s: %d %s", blueMenTenantUUID, code, "")
	}
	if tenant.Name != "Синие люди" {
		t.Fatalf("tenant name = %q, want «Синие люди»", tenant.Name)
	}
	if tenant.ArenaMembershipMode != "all" {
		t.Fatalf("arena_membership_mode = %q, want all", tenant.ArenaMembershipMode)
	}
	if tenant.TournamentsOpenness != "open" {
		t.Fatalf("tournaments_openness = %q, want open", tenant.TournamentsOpenness)
	}
	if tenant.MainArenaId != elo.BlueMenArenaID.Base58().String() {
		t.Fatalf("main_arena_id = %s, want the global arena %s", tenant.MainArenaId, elo.BlueMenArenaID.Base58())
	}
	wantClubs := []string{short(idpkg.ID(blueMenClubUUID)), short(idpkg.ID(vkiClubUUID))}
	if !equalStrings(tenant.ClubIds, wantClubs) {
		t.Fatalf("club_ids = %v, want %v", tenant.ClubIds, wantClubs)
	}

	// Both clubs carry the tenant back-reference.
	for _, cid := range []string{blueMenClubUUID, vkiClubUUID} {
		var attached *string
		if err := pool.QueryRow(context.Background(),
			`SELECT tenant_id::text FROM clubs WHERE id = $1`, cid).Scan(&attached); err != nil {
			t.Fatalf("read club %s: %v", cid, err)
		}
		if attached == nil || *attached != blueMenTenantUUID {
			t.Fatalf("club %s tenant_id = %v, want %s", cid, attached, blueMenTenantUUID)
		}
	}

	// The arena row carries the tenant anchor.
	var anchored *string
	if err := pool.QueryRow(context.Background(),
		`SELECT tenant_id::text FROM arenas WHERE id = $1`, elo.BlueMenArenaID).Scan(&anchored); err != nil {
		t.Fatalf("read global arena: %v", err)
	}
	if anchored == nil || *anchored != blueMenTenantUUID {
		t.Fatalf("global arena tenant_id = %v, want %s", anchored, blueMenTenantUUID)
	}

	// Pre-tenancy tournaments and markets are tied to the tenant.
	var orphans int
	if err := pool.QueryRow(context.Background(),
		`SELECT (SELECT COUNT(*) FROM tournaments WHERE tenant_id <> '00000000-0000-0000-0000-000000000002')
		      + (SELECT COUNT(*) FROM markets WHERE tenant_id <> '00000000-0000-0000-0000-000000000002')`).Scan(&orphans); err != nil {
		t.Fatalf("count orphan rows: %v", err)
	}
	if orphans != 0 {
		t.Fatalf("%d tournaments/markets are not owned by «Синие люди»", orphans)
	}

	// Clubs stay plain grouping: no kind/tenant fields on the club read.
	code, club := getClub(t, router, blueMenClubUUID)
	if code != http.StatusOK {
		t.Fatalf("GET /clubs/%s: %d", blueMenClubUUID, code)
	}
	if club.TenantId == nil || *club.TenantId != short(idpkg.ID(blueMenTenantUUID)) {
		t.Fatalf("club tenant_id = %v, want the «Синие люди» tenant", club.TenantId)
	}
}

// TestTenants_Lifecycle walks create (with composition) → settings → rename →
// composition replace → guards.
func TestTenants_Lifecycle(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()

	router := setupRouter(pool)
	token, _ := createTestUserWithID(t, pool, true)

	// Two fresh group clubs to compose from.
	clubA, clubB := newID(t), newID(t)
	for id, name := range map[idpkg.ID]string{clubA: "Клуб А", clubB: "Клуб Б"} {
		w := doJSON(t, router, http.MethodPost, "/clubs", token,
			fmt.Sprintf(`{"id": %q, "name": %q}`, id, name))
		if w.Code != http.StatusOK {
			t.Fatalf("POST /clubs: %d %s", w.Code, w.Body.String())
		}
	}

	// Create the tenant with an initial composition; the main arena is born
	// with it.
	tenantID := newID(t)
	w := doJSON(t, router, http.MethodPost, "/tenants", token,
		fmt.Sprintf(`{"id": %q, "name": "Сообщество", "arena_membership_mode": "any_member", "tournaments_openness": "open", "club_ids": [%q, %q]}`,
			tenantID, clubA, clubB))
	if w.Code != http.StatusOK {
		t.Fatalf("POST /tenants: %d %s", w.Code, w.Body.String())
	}
	var created struct {
		Data tenantJSON `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create: %v", err)
	}
	if len(created.Data.ClubIds) != 2 || created.Data.MainArenaId == "" {
		t.Fatalf("created tenant = %+v, want both clubs and a main arena", created.Data)
	}
	mainArenaID := created.Data.MainArenaId

	// The fresh main arena exists, is named after the tenant, carries the
	// tenant anchor, and is guarded against direct PATCH/DELETE.
	arenaCanonical, err := idpkg.ParseTolerant(mainArenaID)
	if err != nil {
		t.Fatalf("parse main arena id: %v", err)
	}
	var anchored *string
	if err := pool.QueryRow(ctx,
		`SELECT tenant_id::text FROM arenas WHERE id = $1`, arenaCanonical).Scan(&anchored); err != nil {
		t.Fatalf("read main arena row: %v", err)
	}
	if anchored == nil || *anchored != tenantID.String() {
		t.Fatalf("main arena tenant_id = %v, want %s", anchored, tenantID)
	}
	w = doJSON(t, router, http.MethodGet, "/arenas/"+mainArenaID, "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET main arena: %d %s", w.Code, w.Body.String())
	}
	// The wire form carries the tenant anchor: the arena view gates its edit
	// pencil on it (ADR-36).
	var fetched struct {
		Data struct {
			TenantId *string `json:"tenant_id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &fetched); err != nil {
		t.Fatalf("decode main arena: %v", err)
	}
	wantTenant := string(tenantID.Base58())
	if fetched.Data.TenantId == nil || *fetched.Data.TenantId != wantTenant {
		t.Fatalf("GET main arena tenant_id = %v, want %s", fetched.Data.TenantId, wantTenant)
	}
	w = doJSON(t, router, http.MethodPatch, "/arenas/"+mainArenaID, token,
		`{"name": "Переименовали", "settings": {"starting_rating": 1000, "leagues": []}, "filter": {"game_ids": [], "tag_ids": []}}`)
	if w.Code != http.StatusConflict {
		t.Fatalf("PATCH main arena: %d %s", w.Code, w.Body.String())
	}
	w = doJSON(t, router, http.MethodDelete, "/arenas/"+mainArenaID, token, "")
	if w.Code != http.StatusConflict {
		t.Fatalf("DELETE main arena: %d %s", w.Code, w.Body.String())
	}

	// The 'games' arena list excludes the tenant's main arena.
	w = doJSON(t, router, http.MethodGet, "/arenas?kind=games", "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET arenas kind=games: %d %s", w.Code, w.Body.String())
	}
	var arenas struct {
		Data []struct {
			Id string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &arenas); err != nil {
		t.Fatalf("decode arenas: %v", err)
	}
	for _, a := range arenas.Data {
		if a.Id == mainArenaID {
			t.Fatalf("tenant main arena %s leaked into the games arena list", mainArenaID)
		}
	}

	// A settings PATCH with half a pair is a bad request; the full pair goes
	// through.
	w = doJSON(t, router, http.MethodPatch, "/tenants/"+tenantID.String(), token,
		`{"arena_membership_mode": "any_member"}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("PATCH half settings pair: %d %s", w.Code, w.Body.String())
	}
	w = doJSON(t, router, http.MethodPatch, "/tenants/"+tenantID.String(), token,
		`{"arena_membership_mode": "members_only", "tournaments_openness": "members_only"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("PATCH tenant settings: %d %s", w.Code, w.Body.String())
	}
	code, tenant := getTenant(t, router, tenantID.String())
	if code != http.StatusOK {
		t.Fatalf("GET tenant after settings patch: %d", code)
	}
	if tenant.ArenaMembershipMode != "members_only" {
		t.Fatalf("mode after patch = %q, want members_only", tenant.ArenaMembershipMode)
	}

	// Rename (the main arena follows).
	w = doJSON(t, router, http.MethodPatch, "/tenants/"+tenantID.String(), token,
		`{"name": "Новое имя"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("PATCH tenant name: %d %s", w.Code, w.Body.String())
	}
	var arenaName string
	if err := pool.QueryRow(ctx, `SELECT name FROM arenas WHERE id = $1`, arenaCanonical).Scan(&arenaName); err != nil {
		t.Fatalf("read arena name: %v", err)
	}
	if arenaName != "Новое имя" {
		t.Fatalf("main arena name = %q, want the tenant's new name", arenaName)
	}

	// Composition replace: drop clubB, keep clubA. The clubs read carries it.
	clubC := newID(t)
	w = doJSON(t, router, http.MethodPost, "/clubs", token,
		fmt.Sprintf(`{"id": %q, "name": "Клуб В"}`, clubC))
	if w.Code != http.StatusOK {
		t.Fatalf("POST third club: %d %s", w.Code, w.Body.String())
	}
	w = doJSON(t, router, http.MethodPut, "/tenants/"+tenantID.String()+"/clubs", token,
		fmt.Sprintf(`{"club_ids": [%q, %q]}`, clubA, clubC))
	if w.Code != http.StatusOK {
		t.Fatalf("PUT tenant clubs: %d %s", w.Code, w.Body.String())
	}
	code, tenant = getTenant(t, router, tenantID.String())
	if code != http.StatusOK || !equalStrings(tenant.ClubIds, []string{short(clubA), short(clubC)}) {
		t.Fatalf("tenant after composition change = %+v, want clubs A and C", tenant)
	}
	var detached *string
	if err := pool.QueryRow(ctx, `SELECT tenant_id::text FROM clubs WHERE id = $1`, clubB).Scan(&detached); err != nil {
		t.Fatalf("read detached club: %v", err)
	}
	if detached != nil {
		t.Fatalf("club B still attached to %s after the composition replace", *detached)
	}

	// A club of another tenant cannot be poached (409) and a tenant-attached
	// club cannot be deleted (400); a plain group can.
	otherTenant := newID(t)
	w = doJSON(t, router, http.MethodPost, "/tenants", token,
		fmt.Sprintf(`{"id": %q, "name": "Другое", "arena_membership_mode": "any_member", "tournaments_openness": "open", "club_ids": [%q]}`,
			otherTenant, clubB))
	if w.Code != http.StatusOK {
		t.Fatalf("POST second tenant: %d %s", w.Code, w.Body.String())
	}
	w = doJSON(t, router, http.MethodPut, "/tenants/"+tenantID.String()+"/clubs", token,
		fmt.Sprintf(`{"club_ids": [%q]}`, clubB))
	if w.Code != http.StatusConflict {
		t.Fatalf("poach club from another tenant: %d %s", w.Code, w.Body.String())
	}
	w = doJSON(t, router, http.MethodDelete, "/clubs/"+clubB.String(), token, "")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("DELETE attached club: %d %s", w.Code, w.Body.String())
	}
	groupClub := newID(t)
	w = doJSON(t, router, http.MethodPost, "/clubs", token,
		fmt.Sprintf(`{"id": %q, "name": "Одноразовый клуб"}`, groupClub))
	if w.Code != http.StatusOK {
		t.Fatalf("POST group club: %d %s", w.Code, w.Body.String())
	}
	w = doJSON(t, router, http.MethodDelete, "/clubs/"+groupClub.String(), token, "")
	if w.Code != http.StatusOK {
		t.Fatalf("DELETE group club: %d %s", w.Code, w.Body.String())
	}

	// Tenant names are unique (409).
	w = doJSON(t, router, http.MethodPost, "/tenants", token,
		fmt.Sprintf(`{"id": %q, "name": "Новое имя", "arena_membership_mode": "any_member", "tournaments_openness": "open"}`, newID(t)))
	if w.Code != http.StatusConflict {
		t.Fatalf("duplicate tenant name: %d %s", w.Code, w.Body.String())
	}

	// Invalid settings are a bad request.
	w = doJSON(t, router, http.MethodPost, "/tenants", token,
		fmt.Sprintf(`{"id": %q, "name": "Плохие настройки", "arena_membership_mode": "nope", "tournaments_openness": "open"}`, newID(t)))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("invalid settings: %d %s", w.Code, w.Body.String())
	}
}

// TestClubs_MemberStints pins the stint semantics: remove closes the stint
// (history kept), re-join opens a new one, reads show active members only.
func TestClubs_MemberStints(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()

	router := setupRouter(pool)
	token, _ := createTestUserWithID(t, pool, true)

	clubID := newID(t)
	w := doJSON(t, router, http.MethodPost, "/clubs", token,
		fmt.Sprintf(`{"id": %q, "name": "Клуб на стажах"}`, clubID))
	if w.Code != http.StatusOK {
		t.Fatalf("POST /clubs: %d %s", w.Code, w.Body.String())
	}

	player := createTestPlayer(t, pool, "Стажёр")
	addMember := func() *httptest.ResponseRecorder {
		return doJSON(t, router, http.MethodPost, "/clubs/"+clubID.String()+"/members", token,
			fmt.Sprintf(`{"player_id": %q}`, player))
	}

	if w := addMember(); w.Code != http.StatusOK {
		t.Fatalf("add member: %d %s", w.Code, w.Body.String())
	}
	// A repeated add is a no-op (single active stint).
	if w := addMember(); w.Code != http.StatusOK {
		t.Fatalf("repeated add: %d %s", w.Code, w.Body.String())
	}
	if _, club := getClub(t, router, clubID.String()); len(club.PlayerIds) != 1 {
		t.Fatalf("player_ids = %v, want exactly the one member", club.PlayerIds)
	}

	// A fresh stint joins at now() (the -infinity backfill is migration-time
	// only) and is active.
	var joinedRecent, active bool
	if err := pool.QueryRow(ctx,
		`SELECT joined_at > now() - interval '1 minute', left_at IS NULL
		 FROM player_club_membership WHERE club_id = $1 AND player_id = $2`,
		clubID, player).Scan(&joinedRecent, &active); err != nil {
		t.Fatalf("read stint: %v", err)
	}
	if !joinedRecent || !active {
		t.Fatalf("stint shape wrong: joined_at recent=%v active=%v", joinedRecent, active)
	}

	// Remove closes the stint; the club read drops the player, history stays.
	w = doJSON(t, router, http.MethodDelete, "/clubs/"+clubID.String()+"/members/"+player.Base58().String(), token, "")
	if w.Code != http.StatusOK {
		t.Fatalf("remove member: %d %s", w.Code, w.Body.String())
	}
	if _, club := getClub(t, router, clubID.String()); len(club.PlayerIds) != 0 {
		t.Fatalf("player_ids after remove = %v, want empty", club.PlayerIds)
	}
	var stintCount, activeCount int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*), COUNT(*) FILTER (WHERE left_at IS NULL)
		 FROM player_club_membership WHERE club_id = $1 AND player_id = $2`,
		clubID, player).Scan(&stintCount, &activeCount); err != nil {
		t.Fatalf("count stints: %v", err)
	}
	if stintCount != 1 || activeCount != 0 {
		t.Fatalf("stints after remove = %d (%d active), want 1 closed", stintCount, activeCount)
	}

	// Re-join opens a second stint; the player is a member again.
	if w := addMember(); w.Code != http.StatusOK {
		t.Fatalf("re-join: %d %s", w.Code, w.Body.String())
	}
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*), COUNT(*) FILTER (WHERE left_at IS NULL)
		 FROM player_club_membership WHERE club_id = $1 AND player_id = $2`,
		clubID, player).Scan(&stintCount, &activeCount); err != nil {
		t.Fatalf("count stints: %v", err)
	}
	if stintCount != 2 || activeCount != 1 {
		t.Fatalf("stints after re-join = %d (%d active), want 2 with 1 active", stintCount, activeCount)
	}
	if _, club := getClub(t, router, clubID.String()); len(club.PlayerIds) != 1 {
		t.Fatalf("player_ids after re-join = %v, want the member back", club.PlayerIds)
	}
}

// createTenant creates a fresh tenant over HTTP with one fresh club and
// returns (tenantID, clubID, mainArenaID-Base58).
func createTenant(t *testing.T, router interface {
	ServeHTTP(http.ResponseWriter, *http.Request)
}, token, name, mode, openness string) (idpkg.ID, idpkg.ID, string) {
	t.Helper()
	clubID := newID(t)
	w := doJSON(t, router, http.MethodPost, "/clubs", token,
		fmt.Sprintf(`{"id": %q, "name": %q}`, clubID, name+" клуб"))
	if w.Code != http.StatusOK {
		t.Fatalf("POST /clubs: %d %s", w.Code, w.Body.String())
	}
	tenantID := newID(t)
	w = doJSON(t, router, http.MethodPost, "/tenants", token,
		fmt.Sprintf(`{"id": %q, "name": %q, "arena_membership_mode": %q, "tournaments_openness": %q, "club_ids": [%q]}`,
			tenantID, name, mode, openness, clubID))
	if w.Code != http.StatusOK {
		t.Fatalf("POST /tenants %s: %d %s", name, w.Code, w.Body.String())
	}
	var resp struct {
		Data tenantJSON `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode create tenant: %v", err)
	}
	if resp.Data.MainArenaId == "" {
		t.Fatalf("tenant %s has no main arena", name)
	}
	return tenantID, clubID, resp.Data.MainArenaId
}

func addClubMember(t *testing.T, router interface {
	ServeHTTP(http.ResponseWriter, *http.Request)
}, token, clubID string, player idpkg.ID) {
	t.Helper()
	w := doJSON(t, router, http.MethodPost, "/clubs/"+clubID+"/members", token,
		fmt.Sprintf(`{"player_id": %q}`, player))
	if w.Code != http.StatusOK {
		t.Fatalf("add member %s: %d %s", player, w.Code, w.Body.String())
	}
}

func removeClubMember(t *testing.T, router interface {
	ServeHTTP(http.ResponseWriter, *http.Request)
}, token, clubID string, player idpkg.ID) {
	t.Helper()
	w := doJSON(t, router, http.MethodDelete, "/clubs/"+clubID+"/members/"+player.Base58().String(), token, "")
	if w.Code != http.StatusOK {
		t.Fatalf("remove member %s: %d %s", player, w.Code, w.Body.String())
	}
}

// settlementCount counts one arena's settlement rows, optionally for one match.
func settlementCount(t *testing.T, pool *pgxpool.Pool, arena, matchID interface{}) int {
	t.Helper()
	query := `SELECT COUNT(*) FROM arena_settlements WHERE arena_id = $1`
	args := []interface{}{arena}
	if matchID != nil {
		query += ` AND match_id = $2`
		args = append(args, matchID)
	}
	var n int
	if err := pool.QueryRow(context.Background(), query, args...).Scan(&n); err != nil {
		t.Fatalf("count settlements: %v", err)
	}
	return n
}

// arenaPlayerNames returns the current listing of an arena (GET /arenas/{id}/players).
func arenaPlayerNames(t *testing.T, router interface {
	ServeHTTP(http.ResponseWriter, *http.Request)
}, arenaID string) []string {
	t.Helper()
	w := doJSON(t, router, http.MethodGet, "/arenas/"+arenaID+"/players", "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET arena players: %d %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data []struct {
			Name string `json:"name"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode arena players: %v", err)
	}
	names := make([]string, 0, len(resp.Data))
	for _, p := range resp.Data {
		names = append(names, p.Name)
	}
	slices.Sort(names)
	return names
}

// TestTenants_ArenaAttributionAnyMember pins the any_member rule across the
// tenant's clubs: a match with at least one member of ANY club of the tenant
// at its date counts into the main arena (the match-write drain settles it
// synchronously); a member-less match counts nowhere. Guests accumulate
// rating and are listed in the arena ranking.
func TestTenants_ArenaAttributionAnyMember(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()

	router := setupRouter(pool)
	token, _ := createTestUserWithID(t, pool, true)

	tenantID, clubA, tenantArena := createTenant(t, router, token, "Атрибуция", "any_member", "open")
	tenantArenaID, err := idpkg.ParseTolerant(tenantArena)
	if err != nil {
		t.Fatalf("parse main arena id: %v", err)
	}

	member := createTestPlayer(t, pool, "Член клуба")
	guest := createBareTestPlayer(t, pool, "Гость клуба")
	addClubMember(t, router, token, clubA.String(), member)

	// A second club joins the tenant; its member is a community member too.
	clubB := newID(t)
	w := doJSON(t, router, http.MethodPost, "/clubs", token,
		fmt.Sprintf(`{"id": %q, "name": "Второй клуб"}`, clubB))
	if w.Code != http.StatusOK {
		t.Fatalf("POST second club: %d %s", w.Code, w.Body.String())
	}
	w = doJSON(t, router, http.MethodPut, "/tenants/"+tenantID.String()+"/clubs", token,
		fmt.Sprintf(`{"club_ids": [%q, %q]}`, clubA, clubB))
	if w.Code != http.StatusOK {
		t.Fatalf("PUT tenant clubs: %d %s", w.Code, w.Body.String())
	}
	memberB := createBareTestPlayer(t, pool, "Член второго клуба")
	addClubMember(t, router, token, clubB.String(), memberB)

	game := createTestGame(t, pool, "Игра атрибуции")
	svc := newMatchService(pool)

	// Member of club A + guest: counts under any_member. The match is created
	// under its owning tenant (ADR-36 phase 7); the arena's affected-set drain
	// settles it in the same transaction, and the anchor arena takes it too
	// («Синие люди» is all — every rated match counts).
	if _, err := svc.AddMatch(ctx, tenantID, game, map[idpkg.ID]float64{member: 60, guest: 20}, time.Now(), newMatchOpts(t)); err != nil {
		t.Fatalf("AddMatch member+guest: %v", err)
	}

	// Member of club B + guest: the club B membership counts into the SAME
	// tenant arena — the whole point of the multi-club tenant.
	if _, err := svc.AddMatch(ctx, tenantID, game, map[idpkg.ID]float64{memberB: 55, guest: 25}, time.Now(), newMatchOpts(t)); err != nil {
		t.Fatalf("AddMatch clubB member+guest: %v", err)
	}

	// Member-less match: rejected at creation — the guard demands a current
	// member of the creating tenant (ADR-36 phase 7), the same predicate the
	// feed selects by.
	g1 := createBareTestPlayer(t, pool, "Посторонний1")
	g2 := createBareTestPlayer(t, pool, "Посторонний2")
	strangers := newMatchOpts(t)
	if _, err := svc.AddMatch(ctx, tenantID, game, map[idpkg.ID]float64{g1: 50, g2: 30}, time.Now(), strangers); !errors.Is(err, elo.ErrMatchOutsideTenant) {
		t.Fatalf("AddMatch strangers: err = %v, want ErrMatchOutsideTenant", err)
	}
	// The same roster under «Синие люди» is rejected too: memberB is a member
	// of the fresh tenant's club only.
	if _, err := svc.AddMatch(ctx, blueMenTenantID, game, map[idpkg.ID]float64{memberB: 55, guest: 25}, time.Now(), newMatchOpts(t)); !errors.Is(err, elo.ErrMatchOutsideTenant) {
		t.Fatalf("AddMatch cross-tenant: err = %v, want ErrMatchOutsideTenant", err)
	}

	if got := settlementCount(t, pool, tenantArenaID, nil); got != 4 {
		t.Fatalf("tenant arena settled %d rows, want the 4 participants of the member matches", got)
	}
	// The anchor arena (the «Синие люди» main arena) takes both matches: its
	// mode is all — membership is irrelevant (ADR-36 phase 7).
	if got := settlementCount(t, pool, elo.BlueMenArenaID, nil); got != 4 {
		t.Fatalf("anchor arena settled %d rows, want both matches under the all mode", got)
	}
	if got := settlementCount(t, pool, tenantArenaID, strangers.ID); got != 0 {
		t.Fatalf("rejected match leaked %d rows into the tenant arena", got)
	}

	// The guests are listed in the arena ranking (any_member).
	names := arenaPlayerNames(t, router, tenantArena)
	if !slices.Contains(names, "Член клуба") || !slices.Contains(names, "Член второго клуба") || !slices.Contains(names, "Гость клуба") {
		t.Fatalf("arena players = %v, want both members and the listed guest", names)
	}
}

// TestTenants_MembersOnlyRules pins the members_only listing rules: mixed
// matches do not count into the arena; a member of any club of the tenant
// counts; former members keep their settlement history and point-in-time
// ranks but drop out of the current listing; a re-joined member is listed
// again.
func TestTenants_MembersOnlyRules(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()

	router := setupRouter(pool)
	token, _ := createTestUserWithID(t, pool, true)

	tenantID, clubA, tenantArena := createTenant(t, router, token, "Только свои", "members_only", "open")
	tenantArenaID, err := idpkg.ParseTolerant(tenantArena)
	if err != nil {
		t.Fatalf("parse main arena id: %v", err)
	}

	member := createTestPlayer(t, pool, "Свой1")
	member2 := createTestPlayer(t, pool, "Свой2")
	guest := createBareTestPlayer(t, pool, "Чужой")
	addClubMember(t, router, token, clubA.String(), member)
	addClubMember(t, router, token, clubA.String(), member2)

	// A second club attached later: its member counts into the members_only
	// arena too (membership is tenant-wide).
	clubB := newID(t)
	w := doJSON(t, router, http.MethodPost, "/clubs", token,
		fmt.Sprintf(`{"id": %q, "name": "Свои-Б"}`, clubB))
	if w.Code != http.StatusOK {
		t.Fatalf("POST second club: %d %s", w.Code, w.Body.String())
	}
	w = doJSON(t, router, http.MethodPut, "/tenants/"+tenantID.String()+"/clubs", token,
		fmt.Sprintf(`{"club_ids": [%q, %q]}`, clubA, clubB))
	if w.Code != http.StatusOK {
		t.Fatalf("PUT tenant clubs: %d %s", w.Code, w.Body.String())
	}
	memberB := createTestPlayer(t, pool, "Свой-Б")
	addClubMember(t, router, token, clubB.String(), memberB)

	game := createTestGame(t, pool, "Игра своих")
	svc := newMatchService(pool)

	// Mixed match: does not count into the members_only arena (not in the
	// affected set, nothing drains).
	if _, err := svc.AddMatch(ctx, blueMenTenantID, game, map[idpkg.ID]float64{member: 60, guest: 20}, time.Now(), newMatchOpts(t)); err != nil {
		t.Fatalf("AddMatch mixed: %v", err)
	}
	if got := settlementCount(t, pool, tenantArenaID, nil); got != 0 {
		t.Fatalf("mixed match settled %d rows into the members_only arena, want 0", got)
	}

	// Member-only match across BOTH clubs: the arena joins the affected set
	// and the synchronous drain replays it — the mixed match stays out of the
	// replay.
	if _, err := svc.AddMatch(ctx, blueMenTenantID, game, map[idpkg.ID]float64{member: 60, memberB: 20}, time.Now(), newMatchOpts(t)); err != nil {
		t.Fatalf("AddMatch members: %v", err)
	}
	if got := settlementCount(t, pool, tenantArenaID, nil); got != 2 {
		t.Fatalf("members_only arena settled %d rows, want only the cross-club member match", got)
	}
	if got := settlementCount(t, pool, elo.BlueMenArenaID, nil); got != 4 {
		t.Fatalf("global arena settled %d rows, want both matches («Синие люди» is any_member)", got)
	}

	// Current listing: members only.
	if names := arenaPlayerNames(t, router, tenantArena); !equalStrings(names, []string{"Свой1", "Свой-Б"}) {
		t.Fatalf("arena players = %v, want the two members", names)
	}

	// Removing a member keeps his settlement history (the match counts — he
	// was a member at its date) but drops him from the current listing.
	removeClubMember(t, router, token, clubA.String(), member)
	if _, err := newArenaService(pool).RecalculateAllArenas(ctx); err != nil {
		t.Fatalf("RecalculateAllArenas: %v", err)
	}
	if got := settlementCount(t, pool, tenantArenaID, nil); got != 2 {
		t.Fatalf("former member's settlements were dropped: %d rows, want 2", got)
	}
	if names := arenaPlayerNames(t, router, tenantArena); !equalStrings(names, []string{"Свой-Б"}) {
		t.Fatalf("arena players after remove = %v, want only the current member", names)
	}
	// Point-in-time ranks keep the former member (ADR-36).
	standings, err := newArenaService(pool).GetArenaPlayersAt(ctx, tenantArenaID, time.Now().Add(time.Minute))
	if err != nil {
		t.Fatalf("GetArenaPlayersAt: %v", err)
	}
	pointInTime := make([]string, 0, len(standings))
	for _, p := range standings {
		pointInTime = append(pointInTime, p.Name)
	}
	if !slices.Contains(pointInTime, "Свой1") {
		t.Fatalf("point-in-time standings %v lost the former member", pointInTime)
	}

	// Re-joining lists the member again.
	addClubMember(t, router, token, clubA.String(), member)
	if names := arenaPlayerNames(t, router, tenantArena); !equalStrings(names, []string{"Свой1", "Свой-Б"}) {
		t.Fatalf("arena players after re-join = %v, want both members back", names)
	}
}

// TestTenants_GlobalArenaOpennessGate pins the anchor-arena side of the
// attribution: «Синие люди» carries the «Все партии» openness (all —
// migration 075), so every rated match settles into its main arena; a
// member-less match cannot even be created (the create guard, ADR-36 phase
// 7); and a main-arena mode change re-settles the whole history in the
// settings transaction (the anchor arena's full drain is sweep-only).
func TestTenants_GlobalArenaOpennessGate(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()

	router := setupRouter(pool)
	token, _ := createTestUserWithID(t, pool, true)

	game := createTestGame(t, pool, "Игра синих")
	svc := newMatchService(pool)

	member := createTestPlayer(t, pool, "Синий")
	guest := createBareTestPlayer(t, pool, "Бессиний")

	mixed := newMatchOpts(t)
	if _, err := svc.AddMatch(ctx, blueMenTenantID, game, map[idpkg.ID]float64{member: 60, guest: 20}, time.Now(), mixed); err != nil {
		t.Fatalf("AddMatch mixed: %v", err)
	}
	g2 := createBareTestPlayer(t, pool, "Второй бессиний")
	strangers := newMatchOpts(t)
	if _, err := svc.AddMatch(ctx, blueMenTenantID, game, map[idpkg.ID]float64{guest: 50, g2: 30}, time.Now(), strangers); !errors.Is(err, elo.ErrMatchOutsideTenant) {
		t.Fatalf("AddMatch strangers: err = %v, want ErrMatchOutsideTenant", err)
	}

	if got := settlementCount(t, pool, elo.BlueMenArenaID, mixed.ID); got != 2 {
		t.Fatalf("all-mode anchor arena settled %d rows for the mixed match, want 2", got)
	}
	if got := settlementCount(t, pool, elo.BlueMenArenaID, strangers.ID); got != 0 {
		t.Fatalf("rejected match settled %d rows into the anchor arena, want 0", got)
	}

	// Mode change → the arena is queued for a background recalculation; the
	// drain re-settles the history: under members_only the mixed match (a
	// guest took part) leaves the rating, and the arena is left clean of
	// stale marks.
	w := doJSON(t, router, http.MethodPatch, "/tenants/"+blueMenTenantUUID, token,
		`{"arena_membership_mode": "members_only", "tournaments_openness": "members_only"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("PATCH «Синие люди» mode: %d %s", w.Code, w.Body.String())
	}
	drainArenas(t, pool)
	if got := settlementCount(t, pool, elo.BlueMenArenaID, mixed.ID); got != 0 {
		t.Fatalf("after the members_only replay the mixed match has %d rows, want 0", got)
	}
	var staleAt *time.Time
	if err := pool.QueryRow(ctx,
		`SELECT stale_at FROM arenas WHERE id = $1`, elo.BlueMenArenaID).Scan(&staleAt); err != nil {
		t.Fatalf("read main arena staleness: %v", err)
	}
	if staleAt != nil {
		t.Fatalf("main arena was left stale-marked after the settings drain")
	}

	// Back to any_member: the replay brings the mixed match's settlements back.
	w = doJSON(t, router, http.MethodPatch, "/tenants/"+blueMenTenantUUID, token,
		`{"arena_membership_mode": "any_member", "tournaments_openness": "open"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("PATCH «Синие люди» mode back: %d %s", w.Code, w.Body.String())
	}
	drainArenas(t, pool)
	if got := settlementCount(t, pool, elo.BlueMenArenaID, mixed.ID); got != 2 {
		t.Fatalf("after the any_member replay the mixed match has %d rows, want 2", got)
	}

	// And to all again: the member is irrelevant — the same two rows.
	w = doJSON(t, router, http.MethodPatch, "/tenants/"+blueMenTenantUUID, token,
		`{"arena_membership_mode": "all", "tournaments_openness": "open"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("PATCH «Синие люди» mode to all: %d %s", w.Code, w.Body.String())
	}
	drainArenas(t, pool)
	if got := settlementCount(t, pool, elo.BlueMenArenaID, mixed.ID); got != 2 {
		t.Fatalf("after the all replay the mixed match has %d rows, want 2", got)
	}
}

// TestTenants_FreshArenaModeChangeRecalc pins the fresh-arena side of a mode
// change: the save only queues the main arena (a stale mark); the drain —
// the background worker's job — replays the history under the new mode and
// clears the mark (ADR-36 phase 6).
func TestTenants_FreshArenaModeChangeRecalc(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	router := setupRouter(pool)
	token, _ := createTestUserWithID(t, pool, true)

	tenantID, clubA, tenantArena := createTenant(t, router, token, "Переключаемый", "any_member", "open")
	tenantArenaID, err := idpkg.ParseTolerant(tenantArena)
	if err != nil {
		t.Fatalf("parse main arena id: %v", err)
	}

	member := createTestPlayer(t, pool, "Ветеран")
	guest := createBareTestPlayer(t, pool, "Новичок")
	addClubMember(t, router, token, clubA.String(), member)

	game := createTestGame(t, pool, "Игра переключений")
	svc := newMatchService(pool)
	if _, err := svc.AddMatch(context.Background(), blueMenTenantID, game, map[idpkg.ID]float64{member: 60, guest: 20}, time.Now(), newMatchOpts(t)); err != nil {
		t.Fatalf("AddMatch mixed: %v", err)
	}
	if got := settlementCount(t, pool, tenantArenaID, nil); got != 2 {
		t.Fatalf("any_member arena settled %d rows, want 2", got)
	}

	// The mode change queues the arena; the drain replays: the mixed match
	// leaves the members_only arena and the stale mark clears.
	w := doJSON(t, router, http.MethodPatch, "/tenants/"+tenantID.String(), token,
		`{"arena_membership_mode": "members_only", "tournaments_openness": "open"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("PATCH mode: %d %s", w.Code, w.Body.String())
	}
	drainArenas(t, pool)
	if got := settlementCount(t, pool, tenantArenaID, nil); got != 0 {
		t.Fatalf("members_only replay kept %d rows of the mixed match, want 0", got)
	}
	var staleAt *time.Time
	if err := pool.QueryRow(context.Background(),
		`SELECT stale_at FROM arenas WHERE id = $1`, tenantArenaID).Scan(&staleAt); err != nil {
		t.Fatalf("read arena staleness: %v", err)
	}
	if staleAt != nil {
		t.Fatalf("mode change left the fresh main arena stale-marked")
	}
}

// TestTenants_CompositionChangeRecalc pins the composition side of the
// recalculation: attaching a club with members re-interprets the arena's
// history — their earlier matches flow into the main arena once the queued
// recalculation drains. The members_only mode makes the flip
// observable: a match of a not-yet-attached club's member does not count
// (mixed), and attaching the club re-settles it.
func TestTenants_CompositionChangeRecalc(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()

	router := setupRouter(pool)
	token, _ := createTestUserWithID(t, pool, true)

	tenantID, clubA, tenantArena := createTenant(t, router, token, "Композиция", "members_only", "open")
	tenantArenaID, err := idpkg.ParseTolerant(tenantArena)
	if err != nil {
		t.Fatalf("parse main arena id: %v", err)
	}
	memberA := createTestPlayer(t, pool, "Первый состав")
	addClubMember(t, router, token, clubA.String(), memberA)

	game := createTestGame(t, pool, "Игра композиции")
	svc := newMatchService(pool)

	// Club B is not attached yet: its member is not a community member, so the
	// match {memberA, memberB} is mixed for this members_only arena and counts
	// nowhere in it.
	clubB := newID(t)
	w := doJSON(t, router, http.MethodPost, "/clubs", token,
		fmt.Sprintf(`{"id": %q, "name": "Поздний клуб"}`, clubB))
	if w.Code != http.StatusOK {
		t.Fatalf("POST club B: %d %s", w.Code, w.Body.String())
	}
	memberB := createBareTestPlayer(t, pool, "Поздний член")
	addClubMember(t, router, token, clubB.String(), memberB)
	if _, err := svc.AddMatch(ctx, blueMenTenantID, game, map[idpkg.ID]float64{memberA: 60, memberB: 20}, time.Now(), newMatchOpts(t)); err != nil {
		t.Fatalf("AddMatch: %v", err)
	}
	if got := settlementCount(t, pool, tenantArenaID, nil); got != 0 {
		t.Fatalf("before the composition change the arena settled %d rows, want 0 (mixed)", got)
	}

	// Attaching club B re-interprets the history: after the drain the match is
	// members-only clean and settled.
	w = doJSON(t, router, http.MethodPut, "/tenants/"+tenantID.String()+"/clubs", token,
		fmt.Sprintf(`{"club_ids": [%q, %q]}`, clubA, clubB))
	if w.Code != http.StatusOK {
		t.Fatalf("PUT tenant clubs: %d %s", w.Code, w.Body.String())
	}
	drainArenas(t, pool)
	if got := settlementCount(t, pool, tenantArenaID, nil); got != 2 {
		t.Fatalf("after attaching club B the arena settled %d rows, want both members", got)
	}

	// Detaching back removes the settlements again.
	w = doJSON(t, router, http.MethodPut, "/tenants/"+tenantID.String()+"/clubs", token,
		fmt.Sprintf(`{"club_ids": [%q]}`, clubA))
	if w.Code != http.StatusOK {
		t.Fatalf("PUT tenant clubs back: %d %s", w.Code, w.Body.String())
	}
	drainArenas(t, pool)
	if got := settlementCount(t, pool, tenantArenaID, nil); got != 0 {
		t.Fatalf("after detaching club B the arena settled %d rows, want 0 again", got)
	}
}

// TestTenants_TournamentOpenness pins the tournaments_openness rule: a
// members_only tenant's tournament refuses non-members on the organizer's
// participant list and at self-registration; current members register freely.
func TestTenants_TournamentOpenness(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()
	q := db.New(pool)

	router := setupRouter(pool)
	admin, _ := createTestUserWithID(t, pool, true)

	tenantID, clubID, _ := createTenant(t, router, admin, "Закрытый клуб", "members_only", "members_only")
	_ = clubID

	member := createTestPlayer(t, pool, "Свой игрок")
	guest := createBareTestPlayer(t, pool, "Посторонний")
	addClubMember(t, router, admin, clubID.String(), member)

	// Organizer list gate: a members_only tenant's roster with a non-member is
	// a 403; members-only roster passes.
	game := createTestGame(t, pool, "Игра закрытого сообщества")
	createBody := func(participants string) string {
		return fmt.Sprintf(`{"id": %q, "name": %q, "games": [{"game_id": %q, "min_players": 2, "max_players": 2}], "participant_ids": %s}`,
			newID(t), "Закрытый турнир", game, participants)
	}
	w := doJSON(t, router, http.MethodPost, "/tenants/"+tenantID.String()+"/tournaments", admin,
		createBody(fmt.Sprintf(`[%q]`, guest)))
	if w.Code != http.StatusForbidden {
		t.Fatalf("create with guest participant: %d %s", w.Code, w.Body.String())
	}
	w = doJSON(t, router, http.MethodPost, "/tenants/"+tenantID.String()+"/tournaments", admin,
		createBody(fmt.Sprintf(`[%q]`, member)))
	if w.Code != http.StatusOK {
		t.Fatalf("create with member participant: %d %s", w.Code, w.Body.String())
	}
	var created struct {
		Data struct {
			Id       string `json:"id"`
			TenantId string `json:"tenant_id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create: %v", err)
	}
	tid := mustID(t, created.Data.Id)
	if created.Data.TenantId != short(tenantID) {
		t.Fatalf("tournament tenant_id = %s, want the creating tenant %s", created.Data.TenantId, short(tenantID))
	}

	// Self-registration gate: the member registers; the non-member gets
	// ErrTournamentMembersOnly (service level — the HTTP path adds only the
	// linked-player plumbing covered by TestTournament_SelfRegistration).
	svc := newTournamentService(pool)
	if err := svc.ChangeRegistration(ctx, tid, member, "", true); err != nil {
		t.Fatalf("member register: %v", err)
	}
	if err := svc.ChangeRegistration(ctx, tid, guest, "", true); !errors.Is(err, elo.ErrTournamentMembersOnly) {
		t.Fatalf("guest register: %v, want ErrTournamentMembersOnly", err)
	}
	// Withdrawal stays open for everyone (a lapsed member may still leave).
	if err := q.AddTournamentParticipant(ctx, db.AddTournamentParticipantParams{TournamentID: tid, PlayerID: guest}); err != nil {
		t.Fatalf("seed guest participant: %v", err)
	}
	if err := svc.ChangeRegistration(ctx, tid, guest, "", false); err != nil {
		t.Fatalf("guest withdraw: %v", err)
	}
}

// TestTenants_MarketMembersOnly pins the bet/guarantee restriction: on a
// members_only tenant's market, current members bet and guarantee; non-members
// get ErrMarketMembersOnly.
func TestTenants_MarketMembersOnly(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()

	router := setupRouter(pool)
	admin, _ := createTestUserWithID(t, pool, true)

	tenantID, clubID, _ := createTenant(t, router, admin, "Свой круг", "members_only", "open")

	member := createTestPlayer(t, pool, "Свои ставки")
	outsider := createBareTestPlayer(t, pool, "Чужие ставки")
	addClubMember(t, router, admin, clubID.String(), member)

	game := createTestGame(t, pool, "Игра ставок")
	marketSvc := elo.NewMarketService(pool)
	market, err := marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
		ID:         newID(t),
		TenantID:   tenantID,
		MarketType: "match_winner",
		StartsAt:   time.Now(),
		ClosesAt:   time.Now().Add(24 * time.Hour),
		CreatedBy:  createTestAdmin(t, pool),
		MatchWinner: &elo.MatchWinnerCreateParams{
			TargetPlayerIDs:   []idpkg.ID{member, outsider},
			AllowOtherPlayers: true,
			GameIDs:           []idpkg.ID{game},
		},
	})
	if err != nil {
		t.Fatalf("CreateMarket: %v", err)
	}

	// The member stands as guarantor (allowed) and gives the market liquidity.
	setBetLimit(t, pool, tenantID, member, 100)
	if _, err := marketSvc.JoinAsGuarantee(ctx, newID(t), market.ID, member, 10, 0); err != nil {
		t.Fatalf("member guarantee: %v", err)
	}
	// The outsider is refused both roles.
	if _, err := marketSvc.JoinAsGuarantee(ctx, newID(t), market.ID, outsider, 10, 0); !errors.Is(err, elo.ErrMarketMembersOnly) {
		t.Fatalf("outsider guarantee: %v, want ErrMarketMembersOnly", err)
	}
	outcome := marketOutcomeID(t, ctx, marketSvc, market.ID, "player", member)
	if _, err := marketSvc.PlaceBet(ctx, newID(t), market.ID, outsider, outcome, 1, liveProbability(t, ctx, marketSvc, market.ID, outcome)); !errors.Is(err, elo.ErrMarketMembersOnly) {
		t.Fatalf("outsider bet: %v, want ErrMarketMembersOnly", err)
	}
	if _, err := marketSvc.PlaceBet(ctx, newID(t), market.ID, member, outcome, 1, liveProbability(t, ctx, marketSvc, market.ID, outcome)); err != nil {
		t.Fatalf("member bet: %v", err)
	}
}

// TestMatchUpdate_RequiresTenantMembership pins the edit-side tenant gate
// (ADR-36): an update submitted under a ?tenant= is rejected when after it
// none of the participants remains a current member of that tenant — the
// match would drop out of its feed. Keeping a member passes; an unknown
// tenant is ErrTenantNotFound.
func TestMatchUpdate_RequiresTenantMembership(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()

	router := setupRouter(pool)
	token, _ := createTestUserWithID(t, pool, true)

	tenantID, clubID, _ := createTenant(t, router, token, "Правка сообщества", "any_member", "open")
	tenantMember := createBareTestPlayer(t, pool, "Член сообщества правки")
	guest := createBareTestPlayer(t, pool, "Гость правки")
	guest2 := createBareTestPlayer(t, pool, "Ещё гость правки")
	addClubMember(t, router, token, clubID.String(), tenantMember)

	game := createTestGame(t, pool, "Игра правки")
	svc := newMatchService(pool)

	// The match is created under its owning tenant — the community
	// tenantMember belongs to (ADR-36 phase 7).
	created, err := svc.AddMatch(ctx, tenantID, game, map[idpkg.ID]float64{tenantMember: 50, guest: 30, guest2: 20}, time.Now(), newMatchOpts(t))
	if err != nil {
		t.Fatalf("AddMatch member+guests: %v", err)
	}

	// Dropping the only community member — the match would leave the feed.
	if _, err := svc.UpdateMatch(ctx, tenantID, created.ID, game, map[idpkg.ID]float64{guest: 30, guest2: 20}, created.Date.Time, elo.UpdateMatchOpts{}); !errors.Is(err, elo.ErrMatchOutsideTenant) {
		t.Fatalf("update dropping the last member: err = %v, want ErrMatchOutsideTenant", err)
	}

	// Keeping the member goes through (score changes only).
	if _, err := svc.UpdateMatch(ctx, tenantID, created.ID, game, map[idpkg.ID]float64{tenantMember: 55, guest: 25, guest2: 20}, created.Date.Time, elo.UpdateMatchOpts{}); err != nil {
		t.Fatalf("update keeping the member: %v", err)
	}

	// An unknown tenant names no community at all.
	if _, err := svc.UpdateMatch(ctx, newID(t), created.ID, game, map[idpkg.ID]float64{tenantMember: 60, guest: 25, guest2: 20}, created.Date.Time, elo.UpdateMatchOpts{}); !errors.Is(err, elo.ErrTenantNotFound) {
		t.Fatalf("unknown tenant: err = %v, want ErrTenantNotFound", err)
	}
}

// TestTenants_MatchDisplayArena pins the display arena of the match reads
// (ADR-36): ?tenant= scopes the per-player settlement columns
// (rating staked/earned/after) to the tenant's main arena on both
// GET /matches/{id} and GET /matches. Since phase 5 the parameter is
// required — reads are tenant-scoped, there is no global default (400
// without it) — and a missing tenant is a 404.
func TestTenants_MatchDisplayArena(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()

	router := setupRouter(pool)
	token, _ := createTestUserWithID(t, pool, true)

	tenantID, clubA, _ := createTenant(t, router, token, "Матчевое", "any_member", "open")

	// Bare players with no «Синие люди» stint: the match is created under the
	// fresh tenant (its member takes part, ADR-36 phase 7) and settles into
	// that tenant's main arena.
	member := createBareTestPlayer(t, pool, "Матч-член")
	opponent := createBareTestPlayer(t, pool, "Матч-соперник")
	addClubMember(t, router, token, clubA.String(), member)

	game := createTestGame(t, pool, "Игра матча")
	if _, err := newMatchService(pool).AddMatch(ctx, tenantID, game, map[idpkg.ID]float64{member: 60, opponent: 20}, time.Now(), newMatchOpts(t)); err != nil {
		t.Fatalf("AddMatch: %v", err)
	}

	// A match id for the reads: the fresh tenant's only match, taken from the
	// tenant-scoped list.
	tenantQuery := "?tenant=" + tenantID.String()
	listPage := decodeMatchesPage(t, router, "/matches"+tenantQuery+"&player_id="+short(member))
	if len(listPage.Data) != 1 {
		t.Fatalf("tenant match list holds %d matches, want 1", len(listPage.Data))
	}
	matchID := listPage.Data[0].Id

	decodeMatch := func(path string) matchJSON {
		t.Helper()
		w := doJSON(t, router, http.MethodGet, path, "", "")
		if w.Code != http.StatusOK {
			t.Fatalf("GET %s: %d %s", path, w.Code, w.Body.String())
		}
		var resp struct {
			Data matchJSON `json:"data"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode match: %v", err)
		}
		return resp.Data
	}

	// Tenant-scoped detail: both players carry main-arena settlements.
	tenantMatch := decodeMatch("/matches/" + url.PathEscape(matchID) + tenantQuery)
	if len(tenantMatch.Score) != 2 {
		t.Fatalf("tenant match score holds %d players, want 2", len(tenantMatch.Score))
	}
	earned := 0.0
	for pid, p := range tenantMatch.Score {
		if p.RatingAfter == 0 {
			t.Fatalf("player %s has zero rating_after in the tenant scope", pid)
		}
		earned += p.RatingEarned
	}
	if earned == 0 {
		t.Fatalf("tenant match shows no rating changes: %+v", tenantMatch.Score)
	}

	// Since phase 5 the ?tenant= parameter is required: both reads without it
	// are a bad request — there is no global-arena read default.
	if code := decodeFeedStatus(t, router, "/matches/"+url.PathEscape(matchID)); code != http.StatusBadRequest {
		t.Fatalf("match without tenant gave %d, want 400", code)
	}
	if code := decodeFeedStatus(t, router, "/matches"); code != http.StatusBadRequest {
		t.Fatalf("match list without tenant gave %d, want 400", code)
	}

	// A missing tenant is a 404 on both reads.
	if code := decodeFeedStatus(t, router, "/matches/"+url.PathEscape(matchID)+"?tenant="+newID(t).String()); code != http.StatusNotFound {
		t.Fatalf("match with unknown tenant gave %d, want 404", code)
	}
	if code := decodeFeedStatus(t, router, "/matches?tenant="+newID(t).String()); code != http.StatusNotFound {
		t.Fatalf("match list with unknown tenant gave %d, want 404", code)
	}
}

// matchJSON is the wire shape the display-arena assertions touch.
type matchJSON struct {
	Id    string `json:"id"`
	Score map[string]struct {
		Score        float64 `json:"score"`
		RatingStaked float64 `json:"rating_staked"`
		RatingEarned float64 `json:"rating_earned"`
		RatingAfter  float64 `json:"rating_after"`
	} `json:"score"`
}

// decodeMatchesPage fetches one paginated match-list page.
func decodeMatchesPage(t *testing.T, router http.Handler, path string) struct {
	Data []matchJSON `json:"data"`
	Next *string     `json:"next"`
} {
	t.Helper()
	w := doJSON(t, router, http.MethodGet, path, "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET %s: %d %s", path, w.Code, w.Body.String())
	}
	var resp struct {
		Data []matchJSON `json:"data"`
		Next *string     `json:"next"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode matches page: %v", err)
	}
	return resp
}

// TestTenants_MarketSettlesIntoTenantArena pins the settlement arena: a market
// resolves into its owning tenant's main arena — buyer and guarantor rows
// included — and the recalculation re-settles it there after a match edit.
func TestTenants_MarketSettlesIntoTenantArena(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()

	router := setupRouter(pool)
	admin, _ := createTestUserWithID(t, pool, true)

	tenantID, clubID, tenantArena := createTenant(t, router, admin, "Арена рынка", "any_member", "open")
	tenantArenaID, err := idpkg.ParseTolerant(tenantArena)
	if err != nil {
		t.Fatalf("parse main arena id: %v", err)
	}

	member := createTestPlayer(t, pool, "Игрок рынка")
	guest := createBareTestPlayer(t, pool, "Напарник рынка")
	addClubMember(t, router, admin, clubID.String(), member)

	game := createTestGame(t, pool, "Игра рынка")
	marketSvc := elo.NewMarketService(pool)
	market, err := marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
		ID:         newID(t),
		TenantID:   tenantID,
		MarketType: "match_winner",
		StartsAt:   time.Now(),
		ClosesAt:   time.Now().Add(24 * time.Hour),
		CreatedBy:  createTestAdmin(t, pool),
		MatchWinner: &elo.MatchWinnerCreateParams{
			TargetPlayerIDs:   []idpkg.ID{member},
			AllowOtherPlayers: true,
			GameIDs:           []idpkg.ID{game},
		},
	})
	if err != nil {
		t.Fatalf("CreateMarket: %v", err)
	}
	// The member guarantees and bets on their own win.
	setBetLimit(t, pool, tenantID, member, 100)
	if _, err := marketSvc.JoinAsGuarantee(ctx, newID(t), market.ID, member, 10, 0); err != nil {
		t.Fatalf("guarantee: %v", err)
	}
	outcome := marketOutcomeID(t, ctx, marketSvc, market.ID, "player", member)
	if _, err := marketSvc.PlaceBet(ctx, newID(t), market.ID, member, outcome, 1, liveProbability(t, ctx, marketSvc, market.ID, outcome)); err != nil {
		t.Fatalf("bet: %v", err)
	}

	// The member wins a match against the guest → the market resolves; both
	// settlement rows land in the tenant's main arena, none in the global one.
	matchSvc := newMatchService(pool)
	match, err := matchSvc.AddMatch(ctx, blueMenTenantID, game, map[idpkg.ID]float64{member: 60, guest: 20}, time.Now(), newMatchOpts(t))
	if err != nil {
		t.Fatalf("AddMatch: %v", err)
	}
	if got := arenaMarketRows(t, pool, tenantArenaID, market.ID); got != 2 {
		t.Fatalf("tenant arena holds %d market rows, want buyer + guarantor", got)
	}
	if got := arenaMarketRows(t, pool, elo.BlueMenArenaID, market.ID); got != 0 {
		t.Fatalf("global arena holds %d rows of a tenant market", got)
	}

	// A match edit re-runs the recalculation: the market unsets from the
	// tenant arena and re-settles there (still nothing in the global arena).
	if _, err := matchSvc.UpdateMatch(ctx, tenantID, match.ID, game, map[idpkg.ID]float64{member: 60, guest: 55}, match.Date.Time, elo.UpdateMatchOpts{ActorUserID: createTestAdmin(t, pool)}); err != nil {
		t.Fatalf("UpdateMatch: %v", err)
	}
	if got := arenaMarketRows(t, pool, tenantArenaID, market.ID); got != 2 {
		t.Fatalf("after the edit the tenant arena holds %d market rows, want 2", got)
	}
	if got := arenaMarketRows(t, pool, elo.BlueMenArenaID, market.ID); got != 0 {
		t.Fatalf("after the edit the global arena holds %d rows of a tenant market", got)
	}
}

// TestTenants_TournamentWinnerMarketInTenantArena pins the tournament-winner
// market's inheritance: it is born with the tournament's tenant, its
// settlements (cancellation refunds included) land in that tenant's main
// arena.
func TestTenants_TournamentWinnerMarketInTenantArena(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()

	router := setupRouter(pool)
	admin, _ := createTestUserWithID(t, pool, true)

	tenantID, _, tenantArena := createTenant(t, router, admin, "Турнирное сообщество", "any_member", "open")
	tenantArenaID, err := idpkg.ParseTolerant(tenantArena)
	if err != nil {
		t.Fatalf("parse main arena id: %v", err)
	}

	p1 := createTestPlayer(t, pool, "Финалист1")
	p2 := createTestPlayer(t, pool, "Финалист2")
	game := createTestGame(t, pool, "Игра финала")

	// Create (tenant-scoped) → start with the first offered plan.
	tournamentID := newID(t)
	w := doJSON(t, router, http.MethodPost, "/tenants/"+tenantID.String()+"/tournaments", admin,
		fmt.Sprintf(`{"id": %q, "name": "Кубок сообщества", "games": [{"game_id": %q, "min_players": 2, "max_players": 2}], "participant_ids": [%q, %q]}`,
			tournamentID, game, p1, p2))
	if w.Code != http.StatusOK {
		t.Fatalf("create tournament: %d %s", w.Code, w.Body.String())
	}
	var created struct {
		Data struct {
			Id       string `json:"id"`
			TenantId string `json:"tenant_id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create: %v", err)
	}
	tid := mustID(t, created.Data.Id)
	if created.Data.TenantId != short(tenantID) {
		t.Fatalf("tournament tenant_id = %s, want the creating tenant %s", created.Data.TenantId, short(tenantID))
	}

	w = doJSON(t, router, http.MethodGet, "/tournaments/"+tid.String()+"/bracket-plans", admin, "")
	if w.Code != http.StatusOK {
		t.Fatalf("bracket plans: %d %s", w.Code, w.Body.String())
	}
	var plans struct {
		Data struct {
			Plans []json.RawMessage `json:"plans"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &plans); err != nil || len(plans.Data.Plans) == 0 {
		t.Fatalf("decode plans: %v (%d plans)", err, len(plans.Data.Plans))
	}
	w = doJSON(t, router, http.MethodPost, "/tournaments/"+tid.String()+"/start", admin,
		fmt.Sprintf(`{"plan": %s}`, plans.Data.Plans[0]))
	if w.Code != http.StatusOK {
		t.Fatalf("start: %d %s", w.Code, w.Body.String())
	}

	// The auto market is born under the tournament's tenant.
	tsvc := newTournamentService(pool)
	markets, err := pool.Query(ctx,
		`SELECT m.id FROM markets m JOIN market_tournament_winner_params twp ON twp.market_id = m.id WHERE twp.tournament_id = $1`, tid)
	if err != nil {
		t.Fatalf("list tournament markets: %v", err)
	}
	var marketID idpkg.ID
	found := false
	for markets.Next() {
		if err := markets.Scan(&marketID); err != nil {
			t.Fatalf("scan market id: %v", err)
		}
		found = true
	}
	markets.Close()
	if !found {
		t.Fatalf("no tournament_winner market was born with the tournament")
	}
	var marketTenant string
	if err := pool.QueryRow(ctx, `SELECT tenant_id::text FROM markets WHERE id = $1`, marketID).Scan(&marketTenant); err != nil {
		t.Fatalf("read market tenant: %v", err)
	}
	if marketTenant != tenantID.String() {
		t.Fatalf("market tenant = %s, want the tournament's tenant %s", marketTenant, tenantID)
	}

	// Guarantee + bet, then cancel the tournament: the net-zero refund rows
	// land in the tenant's main arena, not the global one.
	marketSvc := elo.NewMarketService(pool)
	setBetLimit(t, pool, tenantID, p1, 100)
	if _, err := marketSvc.JoinAsGuarantee(ctx, newID(t), marketID, p1, 10, 0); err != nil {
		t.Fatalf("guarantee: %v", err)
	}
	outcome := marketOutcomeID(t, ctx, marketSvc, marketID, "player", p1)
	if _, err := marketSvc.PlaceBet(ctx, newID(t), marketID, p1, outcome, 1, liveProbability(t, ctx, marketSvc, marketID, outcome)); err != nil {
		t.Fatalf("bet: %v", err)
	}
	if err := tsvc.CancelTournament(ctx, tid, createTestAdmin(t, pool)); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if got := arenaMarketRows(t, pool, tenantArenaID, marketID); got == 0 {
		t.Fatalf("cancellation refunds did not land in the tenant arena")
	}
	if got := arenaMarketRows(t, pool, elo.BlueMenArenaID, marketID); got != 0 {
		t.Fatalf("global arena holds %d rows of a tenant tournament market", got)
	}
}

// TestTenants_ClubFeed pins the tenant feed: membership-scoped events across
// all clubs of the tenant (a mixed match appears even when it does not count
// into a members_only main arena), tenant-owned markets only, and cursor
// pagination.
func TestTenants_ClubFeed(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()

	router := setupRouter(pool)
	admin, _ := createTestUserWithID(t, pool, true)

	tenantID, clubA, tenantArena := createTenant(t, router, admin, "Ленточное сообщество", "members_only", "open")
	tenantArenaID, err := idpkg.ParseTolerant(tenantArena)
	if err != nil {
		t.Fatalf("parse main arena id: %v", err)
	}

	// A second club of the same tenant: its member's matches are feed events
	// too.
	clubB := newID(t)
	w := doJSON(t, router, http.MethodPost, "/clubs", admin,
		fmt.Sprintf(`{"id": %q, "name": "Ленты-Б"}`, clubB))
	if w.Code != http.StatusOK {
		t.Fatalf("POST club B: %d %s", w.Code, w.Body.String())
	}
	w = doJSON(t, router, http.MethodPut, "/tenants/"+tenantID.String()+"/clubs", admin,
		fmt.Sprintf(`{"club_ids": [%q, %q]}`, clubA, clubB))
	if w.Code != http.StatusOK {
		t.Fatalf("PUT tenant clubs: %d %s", w.Code, w.Body.String())
	}

	member := createTestPlayer(t, pool, "Ленточник")
	memberB := createTestPlayer(t, pool, "Ленточник-Б")
	guest := createBareTestPlayer(t, pool, "Безленточный")
	addClubMember(t, router, admin, clubA.String(), member)
	addClubMember(t, router, admin, clubB.String(), memberB)
	game := createTestGame(t, pool, "Игра ленты")
	svc := newMatchService(pool)

	// A mixed member+guest match: does NOT count into the members_only main
	// arena, yet appears in the tenant feed — membership-scoped by design.
	if _, err := svc.AddMatch(ctx, blueMenTenantID, game, map[idpkg.ID]float64{member: 60, guest: 20}, time.Now(), newMatchOpts(t)); err != nil {
		t.Fatalf("AddMatch mixed: %v", err)
	}
	if got := settlementCount(t, pool, tenantArenaID, nil); got != 0 {
		t.Fatalf("mixed match counted into the members_only arena (%d rows)", got)
	}
	// A member of club B: in the same feed.
	if _, err := svc.AddMatch(ctx, blueMenTenantID, game, map[idpkg.ID]float64{memberB: 55, guest: 25}, time.Now(), newMatchOpts(t)); err != nil {
		t.Fatalf("AddMatch clubB member: %v", err)
	}
	// A guest-only match is unrepresentable since the create guard (ADR-36
	// phase 7): no member of the creating tenant among the participants.
	if _, err := svc.AddMatch(ctx, blueMenTenantID, game, map[idpkg.ID]float64{guest: 50, createBareTestPlayer(t, pool, "Второй без ленты"): 30}, time.Now(), newMatchOpts(t)); !errors.Is(err, elo.ErrMatchOutsideTenant) {
		t.Fatalf("AddMatch guests: err = %v, want ErrMatchOutsideTenant", err)
	}

	// Markets: the tenant's own market is in; a «Синие люди» market is not.
	marketSvc := elo.NewMarketService(pool)
	_, err = marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
		ID: newID(t), TenantID: tenantID, MarketType: "win_streak",
		StartsAt: time.Now(), ClosesAt: time.Now().Add(24 * time.Hour),
		CreatedBy: createTestAdmin(t, pool),
		WinStreak: &elo.WinStreakCreateParams{TargetPlayerID: member, WinsRequired: 3},
	})
	if err != nil {
		t.Fatalf("create tenant market: %v", err)
	}
	if _, err := marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
		ID: newID(t), TenantID: blueMenTenantID, MarketType: "win_streak",
		StartsAt: time.Now(), ClosesAt: time.Now().Add(24 * time.Hour),
		CreatedBy: createTestAdmin(t, pool),
		WinStreak: &elo.WinStreakCreateParams{TargetPlayerID: member, WinsRequired: 3},
	}); err != nil {
		t.Fatalf("create blue market: %v", err)
	}

	// Corrections are gone (ADR-36 phase 5): the feed is match and market
	// events only.

	tenantFeed := "/tenants/" + tenantID.String() + "/feed"
	page := decodeFeedPage(t, router, tenantFeed)
	eventTypes := feedEventTypesOf(page)
	if !slices.Contains(eventTypes, "match") || !slices.Contains(eventTypes, "market") {
		t.Fatalf("tenant feed = %v, want match and market events", eventTypes)
	}
	if got := countFeedEventsOfType(page, "match"); got != 2 {
		t.Fatalf("tenant feed holds %d matches, want both members'", got)
	}
	if got := countFeedEventsOfType(page, "market"); got != 1 {
		t.Fatalf("tenant feed holds %d markets, want only the tenant-owned one", got)
	}
	if got := countFeedEventsOfType(page, "correction"); got != 0 {
		t.Fatalf("tenant feed holds %d corrections, want none (removed in phase 5)", got)
	}

	// The club filter (ADR-36 phase 4) narrows the community feed to one
	// club: matches through the club's current members, markets through the
	// members the market is about (the arena feed's rule).
	clubAFeed := tenantFeed + "?club_id=" + clubA.String()
	pageA := decodeFeedPage(t, router, clubAFeed)
	if got := countFeedEventsOfType(pageA, "match"); got != 1 {
		t.Fatalf("club A feed holds %d matches, want only club A member's", got)
	}
	if got := countFeedEventsOfType(pageA, "market"); got != 1 {
		t.Fatalf("club A feed holds %d markets, want the one targeting its member", got)
	}
	clubBFeed := tenantFeed + "?club_id=" + clubB.String()
	pageB := decodeFeedPage(t, router, clubBFeed)
	if got := countFeedEventsOfType(pageB, "match"); got != 1 {
		t.Fatalf("club B feed holds %d matches, want only club B member's", got)
	}
	if got := countFeedEventsOfType(pageB, "market"); got != 0 {
		t.Fatalf("club B feed holds %d markets, want none (its member is not the target)", got)
	}
	// The filter rides in the cursor: the continuation keeps narrowing.
	walked := 0
	walkPage := decodeFeedPage(t, router, clubAFeed+"&limit=1")
	for {
		walked += len(walkPage.Data)
		if walkPage.Next == nil {
			break
		}
		walkPage = decodeFeedPage(t, router, clubAFeed+"&limit=1&next="+url.QueryEscape(*walkPage.Next))
	}
	if walked != 2 {
		t.Fatalf("club A cursor walk collected %d events, want match + market", walked)
	}

	// Cursor pagination: limit=1 walks without repeats; a foreign tenant's
	// token is a bad request.
	first := decodeFeedPage(t, router, tenantFeed+"?limit=1")
	if first.Next == nil {
		t.Fatalf("expected a next token on the limited page")
	}
	seen := map[string]bool{feedEventID(first, 0): true}
	tokenPath := tenantFeed + "?limit=1&next=" + url.QueryEscape(*first.Next)
	second := decodeFeedPage(t, router, tokenPath)
	seen[feedEventID(second, 0)] = true
	if len(seen) != 2 {
		t.Fatalf("pagination repeated an event")
	}
	foreign := decodeFeedStatus(t, router, "/tenants/"+blueMenTenantUUID+"/feed?limit=1&next="+url.QueryEscape(*first.Next))
	if foreign != http.StatusBadRequest {
		t.Fatalf("a foreign tenant's cursor gave %d, want 400", foreign)
	}

	// A missing tenant is a 404.
	if status := decodeFeedStatus(t, router, "/tenants/"+newID(t).String()+"/feed"); status != http.StatusNotFound {
		t.Fatalf("missing tenant feed gave %d, want 404", status)
	}
}

// equalStrings compares two string slices order-insensitively.
func equalStrings(a, b []string) bool {
	x := slices.Clone(a)
	y := slices.Clone(b)
	slices.Sort(x)
	slices.Sort(y)
	return slices.Equal(x, y)
}

// decodeFeedStatus fetches one feed page and returns only the status code —
// for the error branches of the tenant feed.
func decodeFeedStatus(t *testing.T, router http.Handler, path string) int {
	t.Helper()
	return doJSON(t, router, http.MethodGet, path, "", "").Code
}

func feedEventTypesOf(page feedPageJSON) []string {
	out := make([]string, 0, len(page.Data))
	for _, e := range page.Data {
		out = append(out, e.Type)
	}
	return out
}

func countFeedEventsOfType(page feedPageJSON, eventType string) int {
	n := 0
	for _, e := range page.Data {
		if e.Type == eventType {
			n++
		}
	}
	return n
}

func feedEventID(page feedPageJSON, i int) string {
	return page.Data[i].Type + "/" + page.Data[i].Data.Id
}
