//go:build integration

package integration_test

// Club tenants (ADR-36): the converted «Синие люди» tenant with its
// global-arena main arena, the group lifecycle (create / convert / delete),
// the stint-based membership, and the attribution phase: club-arena
// membership per openness at the match date, members-only listing, and the
// mode-change recalculation.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/elo"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

const blueMenClubUUID = "00000000-0000-0000-0000-000000000001"

type clubJSON struct {
	Id                  string   `json:"id"`
	Name                string   `json:"name"`
	PlayerIds           []string `json:"player_ids"`
	Kind                string   `json:"kind"`
	ArenaMembershipMode *string  `json:"arena_membership_mode"`
	TournamentsOpenness *string  `json:"tournaments_openness"`
	MainArenaId         *string  `json:"main_arena_id"`
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

// TestClubs_BlueMenTenantBackfill pins the migration backfill: «Синие люди»
// is a tenant whose main arena is the global arena, with any_member / open.
func TestClubs_BlueMenTenantBackfill(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	router := setupRouter(pool)

	code, club := getClub(t, router, blueMenClubUUID)
	if code != http.StatusOK {
		t.Fatalf("GET /clubs/%s: %d %s", blueMenClubUUID, code, "")
	}
	if club.Kind != "tenant" {
		t.Fatalf("«Синие люди» kind = %q, want tenant", club.Kind)
	}
	if club.ArenaMembershipMode == nil || *club.ArenaMembershipMode != "any_member" {
		t.Fatalf("arena_membership_mode = %v, want any_member", club.ArenaMembershipMode)
	}
	if club.TournamentsOpenness == nil || *club.TournamentsOpenness != "open" {
		t.Fatalf("tournaments_openness = %v, want open", club.TournamentsOpenness)
	}
	if club.MainArenaId == nil || *club.MainArenaId != elo.GlobalArenaID.Base58().String() {
		t.Fatalf("main_arena_id = %v, want the global arena %s", club.MainArenaId, elo.GlobalArenaID.Base58())
	}

	// The arena row carries the club anchor.
	var anchored *string
	if err := pool.QueryRow(context.Background(),
		`SELECT club_id::text FROM arenas WHERE id = $1`, elo.GlobalArenaID).Scan(&anchored); err != nil {
		t.Fatalf("read global arena: %v", err)
	}
	if anchored == nil || *anchored != blueMenClubUUID {
		t.Fatalf("global arena club_id = %v, want %s", anchored, blueMenClubUUID)
	}
}

// TestClubs_GroupLifecycleAndConvert walks create → convert → settings →
// delete guards.
func TestClubs_GroupLifecycleAndConvert(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()

	router := setupRouter(pool)
	token, _ := createTestUserWithID(t, pool, true)

	// A fresh club is a plain group: no mode, no main arena.
	clubID := newID(t)
	w := doJSON(t, router, http.MethodPost, "/clubs", token,
		fmt.Sprintf(`{"id": %q, "name": "Групповой клуб"}`, clubID))
	if w.Code != http.StatusOK {
		t.Fatalf("POST /clubs: %d %s", w.Code, w.Body.String())
	}
	var created struct {
		Data clubJSON `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create: %v", err)
	}
	if created.Data.Kind != "group" || created.Data.MainArenaId != nil ||
		created.Data.ArenaMembershipMode != nil || created.Data.TournamentsOpenness != nil {
		t.Fatalf("fresh club = %+v, want a bare group", created.Data)
	}

	// A tenant settings PATCH on a group club is a conflict.
	w = doJSON(t, router, http.MethodPatch, "/clubs/"+clubID.String(), token,
		`{"arena_membership_mode": "any_member", "tournaments_openness": "open"}`)
	if w.Code != http.StatusConflict {
		t.Fatalf("PATCH tenant settings on group: %d %s", w.Code, w.Body.String())
	}
	// Half a settings pair is a bad request.
	w = doJSON(t, router, http.MethodPatch, "/clubs/"+clubID.String(), token,
		`{"arena_membership_mode": "any_member"}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("PATCH half settings pair: %d %s", w.Code, w.Body.String())
	}

	// Convert.
	w = doJSON(t, router, http.MethodPost, "/clubs/"+clubID.String()+"/convert", token,
		`{"arena_membership_mode": "any_member", "tournaments_openness": "open"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("POST convert: %d %s", w.Code, w.Body.String())
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode convert: %v", err)
	}
	if created.Data.Kind != "tenant" || created.Data.MainArenaId == nil {
		t.Fatalf("converted club = %+v, want tenant with a main arena", created.Data)
	}
	mainArenaID := *created.Data.MainArenaId

	// The main arena exists, is named after the club, carries the club anchor,
	// and is guarded against direct PATCH/DELETE.
	w = doJSON(t, router, http.MethodGet, "/arenas/"+mainArenaID, "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET main arena: %d %s", w.Code, w.Body.String())
	}
	arenaCanonical, err := idpkg.ParseTolerant(mainArenaID)
	if err != nil {
		t.Fatalf("parse main arena id: %v", err)
	}
	var anchored *string
	if err := pool.QueryRow(ctx,
		`SELECT club_id::text FROM arenas WHERE id = $1`, arenaCanonical).Scan(&anchored); err != nil {
		t.Fatalf("read main arena row: %v", err)
	}
	if anchored == nil || *anchored != clubID.String() {
		t.Fatalf("main arena club_id = %v, want %s", anchored, clubID)
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

	// Second conversion is a conflict; settings updates go through PATCH.
	w = doJSON(t, router, http.MethodPost, "/clubs/"+clubID.String()+"/convert", token,
		`{"arena_membership_mode": "any_member", "tournaments_openness": "open"}`)
	if w.Code != http.StatusConflict {
		t.Fatalf("second convert: %d %s", w.Code, w.Body.String())
	}
	w = doJSON(t, router, http.MethodPatch, "/clubs/"+clubID.String(), token,
		`{"arena_membership_mode": "members_only", "tournaments_openness": "members_only"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("PATCH tenant settings: %d %s", w.Code, w.Body.String())
	}
	code, club := getClub(t, router, clubID.String())
	if code != http.StatusOK {
		t.Fatalf("GET club after settings patch: %d", code)
	}
	if club.ArenaMembershipMode == nil || *club.ArenaMembershipMode != "members_only" {
		t.Fatalf("mode after patch = %v, want members_only", club.ArenaMembershipMode)
	}

	// The 'games' arena list excludes the club's main arena.
	w = doJSON(t, router, http.MethodGet, "/arenas?kind=games", "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET arenas kind=games: %d %s", w.Code, w.Body.String())
	}
	var arenas struct {
		Data []struct {
			Id   string `json:"id"`
			Name string `json:"name"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &arenas); err != nil {
		t.Fatalf("decode arenas: %v", err)
	}
	for _, a := range arenas.Data {
		if a.Id == mainArenaID {
			t.Fatalf("club main arena %s leaked into the games arena list", mainArenaID)
		}
	}

	// A tenant club cannot be deleted; a plain group (no members) can.
	w = doJSON(t, router, http.MethodDelete, "/clubs/"+clubID.String(), token, "")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("DELETE tenant club: %d %s", w.Code, w.Body.String())
	}
	otherID := newID(t)
	w = doJSON(t, router, http.MethodPost, "/clubs", token,
		fmt.Sprintf(`{"id": %q, "name": "Одноразовый клуб"}`, otherID))
	if w.Code != http.StatusOK {
		t.Fatalf("POST second club: %d %s", w.Code, w.Body.String())
	}
	w = doJSON(t, router, http.MethodDelete, "/clubs/"+otherID.String(), token, "")
	if w.Code != http.StatusOK {
		t.Fatalf("DELETE group club: %d %s", w.Code, w.Body.String())
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

// convertClub converts a fresh group over HTTP and returns the main arena id
// (Base58).
func convertClub(t *testing.T, router interface {
	ServeHTTP(http.ResponseWriter, *http.Request)
}, token, clubID, mode, openness string) string {
	t.Helper()
	w := doJSON(t, router, http.MethodPost, "/clubs/"+clubID+"/convert", token,
		fmt.Sprintf(`{"arena_membership_mode": %q, "tournaments_openness": %q}`, mode, openness))
	if w.Code != http.StatusOK {
		t.Fatalf("convert %s: %d %s", clubID, w.Code, w.Body.String())
	}
	var resp struct {
		Data clubJSON `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode convert: %v", err)
	}
	if resp.Data.MainArenaId == nil {
		t.Fatalf("converted club %s has no main arena", clubID)
	}
	return *resp.Data.MainArenaId
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

// TestClubs_ClubArenaAttributionAnyMember pins the any_member rule: a match
// with at least one member at its date counts into the fresh main arena (the
// match-write drain settles it synchronously); a member-less match counts
// nowhere. Guests accumulate rating and are listed in the arena ranking.
func TestClubs_ClubArenaAttributionAnyMember(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()

	router := setupRouter(pool)
	token, _ := createTestUserWithID(t, pool, true)

	clubID := newID(t)
	w := doJSON(t, router, http.MethodPost, "/clubs", token,
		fmt.Sprintf(`{"id": %q, "name": "Клуб атрибуции"}`, clubID))
	if w.Code != http.StatusOK {
		t.Fatalf("POST /clubs: %d %s", w.Code, w.Body.String())
	}
	clubArena := convertClub(t, router, token, clubID.String(), "any_member", "open")
	clubArenaID, err := idpkg.ParseTolerant(clubArena)
	if err != nil {
		t.Fatalf("parse main arena id: %v", err)
	}

	member := createTestPlayer(t, pool, "Член клуба")
	guest := createBareTestPlayer(t, pool, "Гость клуба")
	addClubMember(t, router, token, clubID.String(), member)

	game := createTestGame(t, pool, "Игра атрибуции")
	svc := newMatchService(pool)

	// Member + guest: counts under any_member — the club arena's affected-set
	// drain settles it in the same transaction, and the global arena takes it
	// too («Синие люди» is any_member as well).
	if _, err := svc.AddMatch(ctx, game, map[idpkg.ID]float64{member: 60, guest: 20}, time.Now(), newMatchOpts(t)); err != nil {
		t.Fatalf("AddMatch member+guest: %v", err)
	}
	// Member-less match: settles nowhere (the club predicate rejects it on
	// both arenas).
	g1 := createBareTestPlayer(t, pool, "Посторонний1")
	g2 := createBareTestPlayer(t, pool, "Посторонний2")
	strangers := newMatchOpts(t)
	if _, err := svc.AddMatch(ctx, game, map[idpkg.ID]float64{g1: 50, g2: 30}, time.Now(), strangers); err != nil {
		t.Fatalf("AddMatch strangers: %v", err)
	}

	if got := settlementCount(t, pool, clubArenaID, nil); got != 2 {
		t.Fatalf("club arena settled %d rows, want the 2 participants of the member match", got)
	}
	if got := settlementCount(t, pool, elo.GlobalArenaID, nil); got != 2 {
		t.Fatalf("global arena settled %d rows, want only the member match", got)
	}
	if got := settlementCount(t, pool, clubArenaID, strangers.ID); got != 0 {
		t.Fatalf("member-less match leaked %d rows into the club arena", got)
	}
	if got := settlementCount(t, pool, elo.GlobalArenaID, strangers.ID); got != 0 {
		t.Fatalf("member-less match leaked %d rows into the global arena", got)
	}

	// The guest is listed in the arena ranking (any_member).
	names := arenaPlayerNames(t, router, clubArena)
	if !slices.Contains(names, "Член клуба") || !slices.Contains(names, "Гость клуба") {
		t.Fatalf("arena players = %v, want the member and the listed guest", names)
	}
}

// TestClubs_MembersOnlyRules pins the members_only listing rules: mixed
// matches do not count into the arena; former members keep their settlement
// history and point-in-time ranks but drop out of the current listing; a
// re-joined member is listed again.
func TestClubs_MembersOnlyRules(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()

	router := setupRouter(pool)
	token, _ := createTestUserWithID(t, pool, true)

	clubID := newID(t)
	w := doJSON(t, router, http.MethodPost, "/clubs", token,
		fmt.Sprintf(`{"id": %q, "name": "Только свои"}`, clubID))
	if w.Code != http.StatusOK {
		t.Fatalf("POST /clubs: %d %s", w.Code, w.Body.String())
	}
	clubArena := convertClub(t, router, token, clubID.String(), "members_only", "open")
	clubArenaID, err := idpkg.ParseTolerant(clubArena)
	if err != nil {
		t.Fatalf("parse main arena id: %v", err)
	}

	member := createTestPlayer(t, pool, "Свой1")
	member2 := createTestPlayer(t, pool, "Свой2")
	guest := createBareTestPlayer(t, pool, "Чужой")
	addClubMember(t, router, token, clubID.String(), member)
	addClubMember(t, router, token, clubID.String(), member2)

	game := createTestGame(t, pool, "Игра своих")
	svc := newMatchService(pool)

	// Mixed match: does not count into the members_only arena (not in the
	// affected set, nothing drains).
	if _, err := svc.AddMatch(ctx, game, map[idpkg.ID]float64{member: 60, guest: 20}, time.Now(), newMatchOpts(t)); err != nil {
		t.Fatalf("AddMatch mixed: %v", err)
	}
	if got := settlementCount(t, pool, clubArenaID, nil); got != 0 {
		t.Fatalf("mixed match settled %d rows into the members_only arena, want 0", got)
	}

	// Member-only match: the arena joins the affected set and the synchronous
	// drain replays it — the mixed match stays out of the replay.
	if _, err := svc.AddMatch(ctx, game, map[idpkg.ID]float64{member: 60, member2: 20}, time.Now(), newMatchOpts(t)); err != nil {
		t.Fatalf("AddMatch members: %v", err)
	}
	if got := settlementCount(t, pool, clubArenaID, nil); got != 2 {
		t.Fatalf("members_only arena settled %d rows, want only the member match", got)
	}
	if got := settlementCount(t, pool, elo.GlobalArenaID, nil); got != 4 {
		t.Fatalf("global arena settled %d rows, want both matches («Синие люди» is any_member)", got)
	}

	// Current listing: members only.
	if names := arenaPlayerNames(t, router, clubArena); !equalStrings(names, []string{"Свой1", "Свой2"}) {
		t.Fatalf("arena players = %v, want the two members", names)
	}

	// Removing a member keeps his settlement history (the match counts — he
	// was a member at its date) but drops him from the current listing.
	removeClubMember(t, router, token, clubID.String(), member)
	if _, err := newArenaService(pool).RecalculateArenas(ctx); err != nil {
		t.Fatalf("RecalculateArenas: %v", err)
	}
	if got := settlementCount(t, pool, clubArenaID, nil); got != 2 {
		t.Fatalf("former member's settlements were dropped: %d rows, want 2", got)
	}
	if names := arenaPlayerNames(t, router, clubArena); !equalStrings(names, []string{"Свой2"}) {
		t.Fatalf("arena players after remove = %v, want only the current member", names)
	}
	// Point-in-time ranks keep the former member (ADR-36).
	standings, err := newArenaService(pool).GetArenaPlayersAt(ctx, clubArenaID, time.Now().Add(time.Minute))
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
	addClubMember(t, router, token, clubID.String(), member)
	if names := arenaPlayerNames(t, router, clubArena); !equalStrings(names, []string{"Свой1", "Свой2"}) {
		t.Fatalf("arena players after re-join = %v, want both members back", names)
	}
}

// TestClubs_GlobalArenaOpennessGate pins the global-arena side of the
// attribution: «Синие люди» is any_member (migration 068), so a member-less
// match leaves no rating rows — and a main-arena mode change re-settles the
// whole history in the settings transaction (the global arena is never
// drained by the background worker).
func TestClubs_GlobalArenaOpennessGate(t *testing.T) {
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
	if _, err := svc.AddMatch(ctx, game, map[idpkg.ID]float64{member: 60, guest: 20}, time.Now(), mixed); err != nil {
		t.Fatalf("AddMatch mixed: %v", err)
	}
	strangers := newMatchOpts(t)
	g2 := createBareTestPlayer(t, pool, "Второй бессиний")
	if _, err := svc.AddMatch(ctx, game, map[idpkg.ID]float64{guest: 50, g2: 30}, time.Now(), strangers); err != nil {
		t.Fatalf("AddMatch strangers: %v", err)
	}

	if got := settlementCount(t, pool, elo.GlobalArenaID, mixed.ID); got != 2 {
		t.Fatalf("any_member global arena settled %d rows for the mixed match, want 2", got)
	}
	if got := settlementCount(t, pool, elo.GlobalArenaID, strangers.ID); got != 0 {
		t.Fatalf("member-less match settled %d rows into the global arena, want 0", got)
	}
	// The rejected match still records its participants.
	var scoreRows int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM match_scores WHERE match_id = $1`, strangers.ID).Scan(&scoreRows); err != nil {
		t.Fatalf("count match scores: %v", err)
	}
	if scoreRows != 2 {
		t.Fatalf("member-less match has %d score rows, want the 2 participants", scoreRows)
	}

	// Mode change → full in-transaction replay: the mixed match leaves the
	// rating under members_only, and the global arena is left clean of stale
	// marks (the worker must never drain it).
	w := doJSON(t, router, http.MethodPatch, "/clubs/"+blueMenClubUUID, token,
		`{"arena_membership_mode": "members_only", "tournaments_openness": "members_only"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("PATCH «Синие люди» mode: %d %s", w.Code, w.Body.String())
	}
	if got := settlementCount(t, pool, elo.GlobalArenaID, mixed.ID); got != 0 {
		t.Fatalf("after the members_only replay the mixed match has %d rows, want 0", got)
	}
	var staleAt *time.Time
	if err := pool.QueryRow(ctx,
		`SELECT stale_at FROM arenas WHERE id = $1`, elo.GlobalArenaID).Scan(&staleAt); err != nil {
		t.Fatalf("read global arena staleness: %v", err)
	}
	if staleAt != nil {
		t.Fatalf("global arena was left stale-marked after the settings replay")
	}

	// Back to any_member: the replay brings the mixed match's settlements back.
	w = doJSON(t, router, http.MethodPatch, "/clubs/"+blueMenClubUUID, token,
		`{"arena_membership_mode": "any_member", "tournaments_openness": "open"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("PATCH «Синие люди» mode back: %d %s", w.Code, w.Body.String())
	}
	if got := settlementCount(t, pool, elo.GlobalArenaID, mixed.ID); got != 2 {
		t.Fatalf("after the any_member replay the mixed match has %d rows, want 2", got)
	}
}

// TestClubs_FreshArenaModeChangeRecalc pins the fresh-arena side of a mode
// change: the main arena is marked for a full recalculation (the background
// worker drains it; here the admin recalculation stands in) and the replay
// re-settles the history under the new mode.
func TestClubs_FreshArenaModeChangeRecalc(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()

	router := setupRouter(pool)
	token, _ := createTestUserWithID(t, pool, true)

	clubID := newID(t)
	w := doJSON(t, router, http.MethodPost, "/clubs", token,
		fmt.Sprintf(`{"id": %q, "name": "Переключаемый"}`, clubID))
	if w.Code != http.StatusOK {
		t.Fatalf("POST /clubs: %d %s", w.Code, w.Body.String())
	}
	clubArena := convertClub(t, router, token, clubID.String(), "any_member", "open")
	clubArenaID, err := idpkg.ParseTolerant(clubArena)
	if err != nil {
		t.Fatalf("parse main arena id: %v", err)
	}

	member := createTestPlayer(t, pool, "Ветеран")
	guest := createBareTestPlayer(t, pool, "Новичок")
	addClubMember(t, router, token, clubID.String(), member)

	game := createTestGame(t, pool, "Игра переключений")
	svc := newMatchService(pool)
	if _, err := svc.AddMatch(ctx, game, map[idpkg.ID]float64{member: 60, guest: 20}, time.Now(), newMatchOpts(t)); err != nil {
		t.Fatalf("AddMatch mixed: %v", err)
	}
	if got := settlementCount(t, pool, clubArenaID, nil); got != 2 {
		t.Fatalf("any_member arena settled %d rows, want 2", got)
	}

	// The mode change marks the fresh arena for a full recalculation.
	w = doJSON(t, router, http.MethodPatch, "/clubs/"+clubID.String(), token,
		`{"arena_membership_mode": "members_only", "tournaments_openness": "open"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("PATCH mode: %d %s", w.Code, w.Body.String())
	}
	var staleAt *time.Time
	if err := pool.QueryRow(ctx,
		`SELECT stale_at FROM arenas WHERE id = $1`, clubArenaID).Scan(&staleAt); err != nil {
		t.Fatalf("read arena staleness: %v", err)
	}
	if staleAt == nil {
		t.Fatalf("mode change did not mark the fresh main arena stale")
	}

	// The recalculation (the background worker's job, driven directly here)
	// drops the mixed match from the members_only arena.
	if _, err := newArenaService(pool).RecalculateArenas(ctx); err != nil {
		t.Fatalf("RecalculateArenas: %v", err)
	}
	if got := settlementCount(t, pool, clubArenaID, nil); got != 0 {
		t.Fatalf("members_only replay kept %d rows of the mixed match, want 0", got)
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
