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
// change: the main arena's match rows replay synchronously in the settings
// transaction (no stale mark — the worker never has to catch up) and the
// replay re-settles the history under the new mode.
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

	// The mode change replays synchronously: the mixed match leaves the
	// members_only arena and no stale mark is left behind.
	w = doJSON(t, router, http.MethodPatch, "/clubs/"+clubID.String(), token,
		`{"arena_membership_mode": "members_only", "tournaments_openness": "open"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("PATCH mode: %d %s", w.Code, w.Body.String())
	}
	if got := settlementCount(t, pool, clubArenaID, nil); got != 0 {
		t.Fatalf("members_only replay kept %d rows of the mixed match, want 0", got)
	}
	var staleAt *time.Time
	if err := pool.QueryRow(ctx,
		`SELECT stale_at FROM arenas WHERE id = $1`, clubArenaID).Scan(&staleAt); err != nil {
		t.Fatalf("read arena staleness: %v", err)
	}
	if staleAt != nil {
		t.Fatalf("mode change left the fresh main arena stale-marked")
	}
}

// TestClubs_TournamentOpenness pins the tournaments_openness rule: a
// members_only club's tournament refuses non-members on the organizer's
// participant list and at self-registration; current members register freely.
func TestClubs_TournamentOpenness(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()
	q := db.New(pool)

	router := setupRouter(pool)
	admin, _ := createTestUserWithID(t, pool, true)

	clubID := newID(t)
	w := doJSON(t, router, http.MethodPost, "/clubs", admin,
		fmt.Sprintf(`{"id": %q, "name": "Закрытый клуб"}`, clubID))
	if w.Code != http.StatusOK {
		t.Fatalf("POST /clubs: %d %s", w.Code, w.Body.String())
	}
	convertClub(t, router, admin, clubID.String(), "members_only", "members_only")

	member := createTestPlayer(t, pool, "Свой игрок")
	guest := createBareTestPlayer(t, pool, "Посторонний")
	addClubMember(t, router, admin, clubID.String(), member)

	// Organizer list gate: a members_only club's roster with a non-member is
	// a 403; members-only roster passes.
	game := createTestGame(t, pool, "Игра закрытого клуба")
	createBody := func(participants string) string {
		return fmt.Sprintf(`{"id": %q, "name": %q, "games": [{"game_id": %q, "min_players": 2, "max_players": 2}], "participant_ids": %s}`,
			newID(t), "Закрытый турнир", game, participants)
	}
	w = doJSON(t, router, http.MethodPost, "/clubs/"+clubID.String()+"/tournaments", admin,
		createBody(fmt.Sprintf(`[%q]`, guest)))
	if w.Code != http.StatusForbidden {
		t.Fatalf("create with guest participant: %d %s", w.Code, w.Body.String())
	}
	w = doJSON(t, router, http.MethodPost, "/clubs/"+clubID.String()+"/tournaments", admin,
		createBody(fmt.Sprintf(`[%q]`, member)))
	if w.Code != http.StatusOK {
		t.Fatalf("create with member participant: %d %s", w.Code, w.Body.String())
	}
	var created struct {
		Data struct {
			Id string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create: %v", err)
	}
	tid := mustID(t, created.Data.Id)

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

// TestClubs_MarketMembersOnly pins the bet/guarantee restriction: on a
// members_only club's market, current members bet and guarantee; non-members
// get ErrMarketMembersOnly.
func TestClubs_MarketMembersOnly(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()

	router := setupRouter(pool)
	admin, _ := createTestUserWithID(t, pool, true)

	clubID := newID(t)
	w := doJSON(t, router, http.MethodPost, "/clubs", admin,
		fmt.Sprintf(`{"id": %q, "name": "Свой круг"}`, clubID))
	if w.Code != http.StatusOK {
		t.Fatalf("POST /clubs: %d %s", w.Code, w.Body.String())
	}
	convertClub(t, router, admin, clubID.String(), "members_only", "open")

	member := createTestPlayer(t, pool, "Свои ставки")
	outsider := createBareTestPlayer(t, pool, "Чужие ставки")
	addClubMember(t, router, admin, clubID.String(), member)

	game := createTestGame(t, pool, "Игра ставок")
	marketSvc := elo.NewMarketService(pool)
	market, err := marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
		ID:         newID(t),
		ClubID:     clubID,
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
	setBetLimit(t, pool, member, 100)
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

// TestClubs_MarketSettlesIntoClubArena pins the settlement arena: a market
// resolves into its owning club's main arena — buyer and guarantor rows
// included — and the recalculation re-settles it there after a match edit.
func TestClubs_MarketSettlesIntoClubArena(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()

	router := setupRouter(pool)
	admin, _ := createTestUserWithID(t, pool, true)

	clubID := newID(t)
	w := doJSON(t, router, http.MethodPost, "/clubs", admin,
		fmt.Sprintf(`{"id": %q, "name": "Арена рынка"}`, clubID))
	if w.Code != http.StatusOK {
		t.Fatalf("POST /clubs: %d %s", w.Code, w.Body.String())
	}
	clubArena := convertClub(t, router, admin, clubID.String(), "any_member", "open")
	clubArenaID, err := idpkg.ParseTolerant(clubArena)
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
		ClubID:     clubID,
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
	setBetLimit(t, pool, member, 100)
	if _, err := marketSvc.JoinAsGuarantee(ctx, newID(t), market.ID, member, 10, 0); err != nil {
		t.Fatalf("guarantee: %v", err)
	}
	outcome := marketOutcomeID(t, ctx, marketSvc, market.ID, "player", member)
	if _, err := marketSvc.PlaceBet(ctx, newID(t), market.ID, member, outcome, 1, liveProbability(t, ctx, marketSvc, market.ID, outcome)); err != nil {
		t.Fatalf("bet: %v", err)
	}

	// The member wins a match against the guest → the market resolves; both
	// settlement rows land in the club's main arena, none in the global one.
	matchSvc := newMatchService(pool)
	match, err := matchSvc.AddMatch(ctx, game, map[idpkg.ID]float64{member: 60, guest: 20}, time.Now(), newMatchOpts(t))
	if err != nil {
		t.Fatalf("AddMatch: %v", err)
	}
	if got := arenaMarketRows(t, pool, clubArenaID, market.ID); got != 2 {
		t.Fatalf("club arena holds %d market rows, want buyer + guarantor", got)
	}
	if got := arenaMarketRows(t, pool, elo.GlobalArenaID, market.ID); got != 0 {
		t.Fatalf("global arena holds %d rows of a club market", got)
	}

	// A match edit re-runs the recalculation: the market unsets from the club
	// arena and re-settles there (still nothing in the global arena).
	if _, err := matchSvc.UpdateMatch(ctx, match.ID, game, map[idpkg.ID]float64{member: 60, guest: 55}, match.Date.Time, elo.UpdateMatchOpts{ActorUserID: createTestAdmin(t, pool)}); err != nil {
		t.Fatalf("UpdateMatch: %v", err)
	}
	if got := arenaMarketRows(t, pool, clubArenaID, market.ID); got != 2 {
		t.Fatalf("after the edit the club arena holds %d market rows, want 2", got)
	}
	if got := arenaMarketRows(t, pool, elo.GlobalArenaID, market.ID); got != 0 {
		t.Fatalf("after the edit the global arena holds %d rows of a club market", got)
	}
}

// TestClubs_TournamentWinnerMarketInClubArena pins the tournament-winner
// market's inheritance: it is born with the tournament's club, its
// settlements (cancellation refunds included) land in that club's main arena.
func TestClubs_TournamentWinnerMarketInClubArena(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()

	router := setupRouter(pool)
	admin, _ := createTestUserWithID(t, pool, true)

	clubID := newID(t)
	w := doJSON(t, router, http.MethodPost, "/clubs", admin,
		fmt.Sprintf(`{"id": %q, "name": "Турнирный клуб"}`, clubID))
	if w.Code != http.StatusOK {
		t.Fatalf("POST /clubs: %d %s", w.Code, w.Body.String())
	}
	clubArena := convertClub(t, router, admin, clubID.String(), "any_member", "open")
	clubArenaID, err := idpkg.ParseTolerant(clubArena)
	if err != nil {
		t.Fatalf("parse main arena id: %v", err)
	}

	p1 := createTestPlayer(t, pool, "Финалист1")
	p2 := createTestPlayer(t, pool, "Финалист2")
	game := createTestGame(t, pool, "Игра финала")

	// Create (club-scoped) → start with the first offered plan.
	tournamentID := newID(t)
	w = doJSON(t, router, http.MethodPost, "/clubs/"+clubID.String()+"/tournaments", admin,
		fmt.Sprintf(`{"id": %q, "name": "Кубок клуба", "games": [{"game_id": %q, "min_players": 2, "max_players": 2}], "participant_ids": [%q, %q]}`,
			tournamentID, game, p1, p2))
	if w.Code != http.StatusOK {
		t.Fatalf("create tournament: %d %s", w.Code, w.Body.String())
	}
	var created struct {
		Data struct {
			Id     string `json:"id"`
			ClubId string `json:"club_id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create: %v", err)
	}
	tid := mustID(t, created.Data.Id)
	if created.Data.ClubId != short(clubID) {
		t.Fatalf("tournament club_id = %s, want the creating club %s", created.Data.ClubId, short(clubID))
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

	// The auto market is born under the tournament's club.
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
	var marketClub string
	if err := pool.QueryRow(ctx, `SELECT club_id::text FROM markets WHERE id = $1`, marketID).Scan(&marketClub); err != nil {
		t.Fatalf("read market club: %v", err)
	}
	if marketClub != clubID.String() {
		t.Fatalf("market club = %s, want the tournament's club %s", marketClub, clubID)
	}

	// Guarantee + bet, then cancel the tournament: the net-zero refund rows
	// land in the club's main arena, not the global one.
	marketSvc := elo.NewMarketService(pool)
	setBetLimit(t, pool, p1, 100)
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
	if got := arenaMarketRows(t, pool, clubArenaID, marketID); got == 0 {
		t.Fatalf("cancellation refunds did not land in the club arena")
	}
	if got := arenaMarketRows(t, pool, elo.GlobalArenaID, marketID); got != 0 {
		t.Fatalf("global arena holds %d rows of a club tournament market", got)
	}
}

// TestClubs_ClubFeed pins the club feed: membership-scoped events (a mixed
// match appears even when it does not count into a members_only main arena),
// club-owned markets only, member corrections only, and cursor pagination.
func TestClubs_ClubFeed(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()

	router := setupRouter(pool)
	admin, _ := createTestUserWithID(t, pool, true)

	clubID := newID(t)
	w := doJSON(t, router, http.MethodPost, "/clubs", admin,
		fmt.Sprintf(`{"id": %q, "name": "Ленточный клуб"}`, clubID))
	if w.Code != http.StatusOK {
		t.Fatalf("POST /clubs: %d %s", w.Code, w.Body.String())
	}
	clubArena := convertClub(t, router, admin, clubID.String(), "members_only", "open")
	clubArenaID, err := idpkg.ParseTolerant(clubArena)
	if err != nil {
		t.Fatalf("parse main arena id: %v", err)
	}

	member := createTestPlayer(t, pool, "Ленточник")
	guest := createBareTestPlayer(t, pool, "Безленточный")
	addClubMember(t, router, admin, clubID.String(), member)
	game := createTestGame(t, pool, "Игра ленты")
	svc := newMatchService(pool)

	// A mixed member+guest match: does NOT count into the members_only main
	// arena, yet appears in the club feed — membership-scoped by design.
	if _, err := svc.AddMatch(ctx, game, map[idpkg.ID]float64{member: 60, guest: 20}, time.Now(), newMatchOpts(t)); err != nil {
		t.Fatalf("AddMatch mixed: %v", err)
	}
	if got := settlementCount(t, pool, clubArenaID, nil); got != 0 {
		t.Fatalf("mixed match counted into the members_only arena (%d rows)", got)
	}
	// A guest-only match stays out of the feed.
	if _, err := svc.AddMatch(ctx, game, map[idpkg.ID]float64{guest: 50, createBareTestPlayer(t, pool, "Второй без ленты"): 30}, time.Now(), newMatchOpts(t)); err != nil {
		t.Fatalf("AddMatch guests: %v", err)
	}

	// Markets: the club's own market is in; a «Синие люди» market is not.
	marketSvc := elo.NewMarketService(pool)
	_, err = marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
		ID: newID(t), ClubID: clubID, MarketType: "win_streak",
		StartsAt: time.Now(), ClosesAt: time.Now().Add(24 * time.Hour),
		CreatedBy: createTestAdmin(t, pool),
		WinStreak: &elo.WinStreakCreateParams{TargetPlayerID: member, WinsRequired: 3},
	})
	if err != nil {
		t.Fatalf("create club market: %v", err)
	}
	if _, err := marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
		ID: newID(t), ClubID: blueMenClubID, MarketType: "win_streak",
		StartsAt: time.Now(), ClosesAt: time.Now().Add(24 * time.Hour),
		CreatedBy: createTestAdmin(t, pool),
		WinStreak: &elo.WinStreakCreateParams{TargetPlayerID: member, WinsRequired: 3},
	}); err != nil {
		t.Fatalf("create blue market: %v", err)
	}

	// Corrections: the member's is in, the guest's is not.
	correctionSvc := newCorrectionService(pool)
	if err := correctionSvc.CreateGlobalArenaRatingCorrection(ctx, newID(t), member, 5); err != nil {
		t.Fatalf("member correction: %v", err)
	}
	if err := correctionSvc.CreateGlobalArenaRatingCorrection(ctx, newID(t), guest, 5); err != nil {
		t.Fatalf("guest correction: %v", err)
	}

	clubFeed := "/clubs/" + clubID.String() + "/feed"
	page := decodeFeedPage(t, router, clubFeed)
	eventTypes := feedEventTypesOf(page)
	if !slices.Contains(eventTypes, "match") || !slices.Contains(eventTypes, "market") || !slices.Contains(eventTypes, "correction") {
		t.Fatalf("club feed = %v, want match, market and correction events", eventTypes)
	}
	if got := countFeedEventsOfType(page, "match"); got != 1 {
		t.Fatalf("club feed holds %d matches, want only the member's", got)
	}
	if got := countFeedEventsOfType(page, "market"); got != 1 {
		t.Fatalf("club feed holds %d markets, want only the club-owned one", got)
	}
	if got := countFeedEventsOfType(page, "correction"); got != 1 {
		t.Fatalf("club feed holds %d corrections, want only the member's", got)
	}

	// Cursor pagination: limit=1 walks without repeats; a foreign club's
	// token is a bad request.
	first := decodeFeedPage(t, router, clubFeed+"?limit=1")
	if first.Next == nil {
		t.Fatalf("expected a next token on the limited page")
	}
	seen := map[string]bool{feedEventID(first, 0): true}
	tokenPath := clubFeed + "?limit=1&next=" + url.QueryEscape(*first.Next)
	second := decodeFeedPage(t, router, tokenPath)
	seen[feedEventID(second, 0)] = true
	if len(seen) != 2 {
		t.Fatalf("pagination repeated an event")
	}
	otherClub := newID(t)
	foreign := decodeFeedStatus(t, router, "/clubs/"+otherClub.String()+"/feed?limit=1&next="+url.QueryEscape(*first.Next))
	if foreign != http.StatusBadRequest {
		t.Fatalf("a foreign club's cursor gave %d, want 400", foreign)
	}

	// A group club has no feed (404), like a missing one.
	groupID := newID(t)
	w = doJSON(t, router, http.MethodPost, "/clubs", admin,
		fmt.Sprintf(`{"id": %q, "name": "Безленточный клуб"}`, groupID))
	if w.Code != http.StatusOK {
		t.Fatalf("POST group club: %d %s", w.Code, w.Body.String())
	}
	if status := decodeFeedStatus(t, router, "/clubs/"+groupID.String()+"/feed"); status != http.StatusNotFound {
		t.Fatalf("group club feed gave %d, want 404", status)
	}
	if status := decodeFeedStatus(t, router, "/clubs/"+newID(t).String()+"/feed"); status != http.StatusNotFound {
		t.Fatalf("missing club feed gave %d, want 404", status)
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
// for the error branches of the club feed.
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
