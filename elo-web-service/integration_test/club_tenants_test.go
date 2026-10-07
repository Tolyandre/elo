//go:build integration

package integration_test

// Club tenants (ADR-36): the converted «Синие люди» tenant with its
// global-arena main arena, the group lifecycle (create / convert / delete),
// the stint-based membership, and the phase-1 invariant that a fresh club
// arena attracts no matches yet.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

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

// TestClubs_ClubArenaMatchesNothingYet pins the phase-1 invariant: a fresh
// tenant's main arena does not attract matches — the link-only branch of the
// membership function leaves it empty while the global arena settles.
func TestClubs_ClubArenaMatchesNothingYet(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()

	router := setupRouter(pool)
	token, _ := createTestUserWithID(t, pool, true)

	clubID := newID(t)
	w := doJSON(t, router, http.MethodPost, "/clubs", token,
		fmt.Sprintf(`{"id": %q, "name": "Клуб без партий"}`, clubID))
	if w.Code != http.StatusOK {
		t.Fatalf("POST /clubs: %d %s", w.Code, w.Body.String())
	}
	w = doJSON(t, router, http.MethodPost, "/clubs/"+clubID.String()+"/convert", token,
		`{"arena_membership_mode": "any_member", "tournaments_openness": "open"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("convert: %d %s", w.Code, w.Body.String())
	}
	var converted struct {
		Data clubJSON `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &converted); err != nil {
		t.Fatalf("decode convert: %v", err)
	}
	clubArena, err := idpkg.ParseTolerant(*converted.Data.MainArenaId)
	if err != nil {
		t.Fatalf("parse main arena id: %v", err)
	}

	// A match between two players (neither in the club): the global arena
	// settles it, the club arena stays empty.
	p1 := createTestPlayer(t, pool, "Матч1")
	p2 := createTestPlayer(t, pool, "Матч2")
	svc := newMatchService(pool)
	if _, err := svc.AddMatch(ctx, createTestGame(t, pool, "Игра клуба"), map[idpkg.ID]float64{p1: 60, p2: 20}, time.Now(), newMatchOpts(t)); err != nil {
		t.Fatalf("AddMatch: %v", err)
	}

	var clubSettlements, globalSettlements int
	if err := pool.QueryRow(ctx,
		`SELECT
		    (SELECT COUNT(*) FROM arena_settlements WHERE arena_id = $1),
		    (SELECT COUNT(*) FROM arena_settlements WHERE arena_id = $2)`,
		clubArena, elo.GlobalArenaID).Scan(&clubSettlements, &globalSettlements); err != nil {
		t.Fatalf("count settlements: %v", err)
	}
	if clubSettlements != 0 {
		t.Fatalf("club arena attracted %d settlements, want 0 in the attribution phase", clubSettlements)
	}
	if globalSettlements == 0 {
		t.Fatalf("global arena settled nothing, want the match")
	}
}
