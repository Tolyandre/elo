//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/elo"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

type campArenaJSON struct {
	Data []struct {
		Id           string     `json:"id"`
		Name         string     `json:"name"`
		Camp         bool       `json:"camp"`
		Filter       *any       `json:"filter"`
		GameId       *string    `json:"game_id"`
		TournamentId *string    `json:"tournament_id"`
		MatchesCount *int       `json:"matches_count"`
		PlayerIds    []string   `json:"player_ids"`
		StartsAt     *time.Time `json:"starts_at"`
		EndsAt       *time.Time `json:"ends_at"`
	} `json:"data"`
}

// TestCamp_SeededTournamentConverted verifies on the template clone (built
// from the squashed init migration) that the seeded camp arena carries the
// converted camp shape: the June window, no filter and no anchor, participants
// derived (empty on a fresh database).
func TestCamp_SeededTournamentConverted(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	router := setupRouter(pool)

	w := doJSON(t, router, http.MethodGet, "/arenas?kind=camps", "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET /arenas?kind=camps: %d %s", w.Code, w.Body.String())
	}
	var list campArenaJSON
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode arenas: %v", err)
	}
	if len(list.Data) != 1 {
		t.Fatalf("expected exactly 1 camp arena, got %d: %+v", len(list.Data), list.Data)
	}
	a := list.Data[0]
	if a.Name != "Челябинский игровой кэмп 2026" {
		t.Fatalf("camp arena name: %q", a.Name)
	}
	if !a.Camp || a.Filter != nil || a.GameId != nil || a.TournamentId != nil {
		t.Fatalf("camp arena shape wrong: camp=%v filter=%v game=%v tournament=%v",
			a.Camp, a.Filter, a.GameId, a.TournamentId)
	}
	// Seeded window (utc+5 dates).
	wantStart := time.Date(2026, 6, 15, 0, 0, 0, 0, time.FixedZone("+05", 5*3600))
	wantEnd := time.Date(2026, 6, 21, 23, 59, 0, 0, time.FixedZone("+05", 5*3600))
	if a.StartsAt == nil || a.EndsAt == nil ||
		!a.StartsAt.Equal(wantStart) || !a.EndsAt.Equal(wantEnd) {
		t.Fatalf("camp window: %v .. %v, want %v .. %v", a.StartsAt, a.EndsAt, wantStart, wantEnd)
	}
	if len(a.PlayerIds) != 0 {
		t.Fatalf("fresh camp must have no derived participants, got %v", a.PlayerIds)
	}

	// DB level: the filter row is gone.
	var filterID *string
	if err := pool.QueryRow(context.Background(),
		`SELECT match_filter_id::text FROM arenas WHERE tournament_id IS NULL AND camp`).Scan(&filterID); err != nil {
		t.Fatalf("camp arena lookup: %v", err)
	}
	if filterID != nil {
		t.Fatalf("camp arena must have no filter, got %s", *filterID)
	}
}

// TestCamp_CRUDAndValidation covers the camp arena CRUD surface: create with
// a window and league-less settings, the 400 guards (missing/disordered dates,
// leagues), the date-narrowing 409 and the delete cascade.
func TestCamp_CRUDAndValidation(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	editor := createNamedTestUser(t, pool, "camp-editor", "Кэмп Редактор")
	router := setupRouter(pool)

	start := time.Now().Add(-24 * time.Hour).Format(time.RFC3339)
	end := time.Now().Add(24 * time.Hour).Format(time.RFC3339)

	// Happy path.
	body := `{"name":"Тестовый кэмп","camp":true,"starts_at":"` + start + `","ends_at":"` + end + `","settings":{"starting_rating":1000,"leagues":[]}}`
	w := doJSON(t, router, http.MethodPost, "/arenas", editor, body)
	if w.Code != http.StatusOK {
		t.Fatalf("create camp: %d %s", w.Code, w.Body.String())
	}
	var created struct {
		Data struct {
			Id       string     `json:"id"`
			Camp     bool       `json:"camp"`
			Filter   *any       `json:"filter"`
			StartsAt *time.Time `json:"starts_at"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode created: %v", err)
	}
	if !created.Data.Camp || created.Data.Filter != nil || created.Data.StartsAt == nil {
		t.Fatalf("created camp shape: %+v", created.Data)
	}

	// Missing dates → 400.
	w = doJSON(t, router, http.MethodPost, "/arenas", editor, `{"name":"Без дат","camp":true,"settings":{"starting_rating":1000,"leagues":[]}}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("camp without dates must 400, got %d %s", w.Code, w.Body.String())
	}
	// Disordered dates → 400.
	w = doJSON(t, router, http.MethodPost, "/arenas", editor, `{"name":"Кривые даты","camp":true,"starts_at":"`+end+`","ends_at":"`+start+`","settings":{"starting_rating":1000,"leagues":[]}}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("camp with end before start must 400, got %d %s", w.Code, w.Body.String())
	}
	// Leagues are not allowed on camps → 400.
	w = doJSON(t, router, http.MethodPost, "/arenas", editor, `{"name":"Кэмп с лигами","camp":true,"starts_at":"`+start+`","ends_at":"`+end+`","settings":{"starting_rating":1000,"leagues":[{"kind":"newbie","goal_gap":16,"earned_min":2,"earned_max":64,"tau":100}]}}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("camp with leagues must 400, got %d %s", w.Code, w.Body.String())
	}

	// Link a match, then try narrowing the window past it → 409.
	p1 := createTestPlayer(t, pool, "КэмпС1")
	p2 := createTestPlayer(t, pool, "КэмпС2")
	gameID := createTestGame(t, pool, "КэмпС игра")
	svc := newMatchService(pool)
	mid := time.Now()
	campCanonical, err := idpkg.ParseTolerant(created.Data.Id)
	if err != nil {
		t.Fatalf("parse camp id: %v", err)
	}
	linked, err := svc.AddMatch(context.Background(), gameID, map[idpkg.ID]float64{p1: 10, p2: 5}, mid,
		elo.AddMatchOpts{ID: newID(t), CampArenaIDs: []idpkg.ID{campCanonical}})
	if err != nil {
		t.Fatalf("AddMatch: %v", err)
	}
	// Narrowing the window end past the match (~now) must be rejected.
	narrowEnd := time.Now().Add(-2 * time.Hour).Format(time.RFC3339)
	w = doJSON(t, router, http.MethodPatch, "/arenas/"+created.Data.Id, editor,
		`{"name":"Тестовый кэмп","camp":true,"starts_at":"`+start+`","ends_at":"`+narrowEnd+`","settings":{"starting_rating":1000,"leagues":[]}}`)
	if w.Code != http.StatusConflict {
		t.Fatalf("narrowing camp dates past a match must 409, got %d %s", w.Code, w.Body.String())
	}

	// Widening (and renaming) is fine.
	wideStart := time.Now().Add(-48 * time.Hour).Format(time.RFC3339)
	w = doJSON(t, router, http.MethodPatch, "/arenas/"+created.Data.Id, editor,
		`{"name":"Тестовый кэмп переименованный","camp":true,"starts_at":"`+wideStart+`","ends_at":"`+end+`","settings":{"starting_rating":1000,"leagues":[]}}`)
	if w.Code != http.StatusOK {
		t.Fatalf("widening camp dates must 200, got %d %s", w.Code, w.Body.String())
	}

	// Deleting the camp cascades its links; the match survives as an ordinary
	// match.
	w = doJSON(t, router, http.MethodDelete, "/arenas/"+created.Data.Id, editor, "")
	if w.Code != http.StatusOK {
		t.Fatalf("delete camp: %d %s", w.Code, w.Body.String())
	}
	arenaCanonical, err := idpkg.ParseTolerant(created.Data.Id)
	if err != nil {
		t.Fatalf("parse arena id: %v", err)
	}
	var links int
	if err := pool.QueryRow(context.Background(), `SELECT COUNT(*) FROM arena_matches WHERE arena_id = $1`, arenaCanonical).Scan(&links); err != nil {
		t.Fatalf("count links: %v", err)
	}
	if links != 0 {
		t.Fatalf("camp delete must cascade links, got %d", links)
	}
	var surviving int
	if err := pool.QueryRow(context.Background(), `SELECT COUNT(*) FROM matches WHERE id = $1`, linked.ID).Scan(&surviving); err != nil {
		t.Fatalf("count matches: %v", err)
	}
	if surviving != 1 {
		t.Fatalf("camp delete must not delete the match, got %d", surviving)
	}
}

// TestCamp_MatchLinkingAndDrain verifies the POST /matches camp semantics:
// in-window links are written and the camp drains synchronously; unknown ids,
// non-camp arenas and out-of-window dates are rejected with 400.
func TestCamp_MatchLinkingAndDrain(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()

	router := setupRouter(pool)

	start := time.Now().Add(-24 * time.Hour)
	end := time.Now().Add(24 * time.Hour)
	campSvc := newArenaService(pool)
	camp, err := campSvc.CreateArena(ctx, idpkg.ID(""), elo.ArenaWriteOpts{
		Name: "Линковочный кэмп", Camp: true, StartsAt: &start, EndsAt: &end,
		SettingsRaw: json.RawMessage(`{"starting_rating":1000,"leagues":[]}`),
	})
	if err != nil {
		t.Fatalf("create camp: %v", err)
	}
	// A non-camp arena to reject.
	gameSvc := newGameService(pool)
	gameRec, err := gameSvc.AddGame(ctx, newID(t), "Линковочная игра", idpkg.ID(""))
	if err != nil {
		t.Fatalf("AddGame: %v", err)
	}
	gameArena, err := campSvc.GetArenaByGame(ctx, gameRec.ID)
	if err != nil {
		t.Fatalf("game arena: %v", err)
	}

	p1 := createTestPlayer(t, pool, "Линк1")
	p2 := createTestPlayer(t, pool, "Линк2")
	mSvc := newMatchService(pool)

	// In-window link: camp drained synchronously, players tab filled.
	matchTime := time.Now()
	if _, err := mSvc.AddMatch(ctx, gameRec.ID, map[idpkg.ID]float64{p1: 10, p2: 5}, matchTime,
		elo.AddMatchOpts{ID: newID(t), CampArenaIDs: []idpkg.ID{camp.ID}}); err != nil {
		t.Fatalf("AddMatch in window: %v", err)
	}
	w := doJSON(t, router, http.MethodGet, "/arenas/"+string(camp.ID)+"/players", "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET camp players: %d %s", w.Code, w.Body.String())
	}
	var players arenaPlayersJSON
	if err := json.Unmarshal(w.Body.Bytes(), &players); err != nil {
		t.Fatalf("decode players: %v", err)
	}
	if len(players.Data) != 2 || players.Data[0].MatchesCount != 1 {
		t.Fatalf("camp drain on match write: %+v", players.Data)
	}

	// The match response carries the camp as {id, name}.
	w = doJSON(t, router, http.MethodGet, "/matches", "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET /matches: %d %s", w.Code, w.Body.String())
	}
	var matchList struct {
		Data []struct {
			Camps []struct {
				Id   string `json:"id"`
				Name string `json:"name"`
			} `json:"camps"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &matchList); err != nil {
		t.Fatalf("decode matches: %v", err)
	}
	if len(matchList.Data) != 1 || len(matchList.Data[0].Camps) != 1 ||
		matchList.Data[0].Camps[0].Id != shortOf(t, camp.ID) || matchList.Data[0].Camps[0].Name != camp.Name {
		t.Fatalf("match camps payload: %+v", matchList.Data)
	}

	// Unknown camp id → 400.
	if _, err := mSvc.AddMatch(ctx, gameRec.ID, map[idpkg.ID]float64{p1: 10, p2: 5}, matchTime,
		elo.AddMatchOpts{ID: newID(t), CampArenaIDs: []idpkg.ID{newID(t)}}); !errors.Is(err, elo.ErrCampArenaInvalid) {
		t.Fatalf("unknown camp id: got %v, want ErrCampArenaInvalid", err)
	}
	// Non-camp arena id → 400.
	if _, err := mSvc.AddMatch(ctx, gameRec.ID, map[idpkg.ID]float64{p1: 10, p2: 5}, matchTime,
		elo.AddMatchOpts{ID: newID(t), CampArenaIDs: []idpkg.ID{gameArena.ID}}); !errors.Is(err, elo.ErrCampArenaInvalid) {
		t.Fatalf("non-camp arena id: got %v, want ErrCampArenaInvalid", err)
	}
	// Out-of-window date → 400.
	if _, err := mSvc.AddMatch(ctx, gameRec.ID, map[idpkg.ID]float64{p1: 10, p2: 5}, start.Add(-time.Hour),
		elo.AddMatchOpts{ID: newID(t), CampArenaIDs: []idpkg.ID{camp.ID}, ClientDate: true}); !errors.Is(err, elo.ErrCampArenaInvalid) {
		t.Fatalf("out-of-window date: got %v, want ErrCampArenaInvalid", err)
	}
}

// TestCamp_MatchEditRelinksCamps verifies the PUT /matches camp semantics
// (ADR-27, revised): the body set is the desired set — links are attached and
// detached (each change audited, both camps drained synchronously), the date
// must stay inside every kept camp's window, and a date moved outside a
// linked camp without detaching it is a 409.
func TestCamp_MatchEditRelinksCamps(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()
	router := setupRouter(pool)

	start := time.Now().Add(-24 * time.Hour)
	end := time.Now().Add(24 * time.Hour)
	campSvc := newArenaService(pool)
	actor := createTestAdmin(t, pool)
	campA, err := campSvc.CreateArena(ctx, actor, elo.ArenaWriteOpts{
		Name: "Кэмп А", Camp: true, StartsAt: &start, EndsAt: &end,
		SettingsRaw: json.RawMessage(`{"starting_rating":1000,"leagues":[]}`),
	})
	if err != nil {
		t.Fatalf("create camp A: %v", err)
	}
	campB, err := campSvc.CreateArena(ctx, actor, elo.ArenaWriteOpts{
		Name: "Кэмп Б", Camp: true, StartsAt: &start, EndsAt: &end,
		SettingsRaw: json.RawMessage(`{"starting_rating":1000,"leagues":[]}`),
	})
	if err != nil {
		t.Fatalf("create camp B: %v", err)
	}
	gameSvc := newGameService(pool)
	gameRec, err := gameSvc.AddGame(ctx, newID(t), "Кэмп правок игра", idpkg.ID(""))
	if err != nil {
		t.Fatalf("AddGame: %v", err)
	}
	gameID := gameRec.ID
	p1 := createTestPlayer(t, pool, "Правк1")
	p2 := createTestPlayer(t, pool, "Правк2")

	mSvc := newMatchService(pool)
	matchTime := time.Now().Add(-time.Hour)
	matchID := newID(t)
	if _, err := mSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{p1: 10, p2: 5}, matchTime,
		elo.AddMatchOpts{ID: matchID, CampArenaIDs: []idpkg.ID{campA.ID}, ActorUserID: actor}); err != nil {
		t.Fatalf("AddMatch: %v", err)
	}

	linksOf := func() []idpkg.ID {
		t.Helper()
		rows, err := db.New(pool).ListCampArenasByMatchIDs(ctx, []idpkg.ID{matchID})
		if err != nil {
			t.Fatalf("list camps: %v", err)
		}
		ids := make([]idpkg.ID, 0, len(rows))
		for _, r := range rows {
			ids = append(ids, r.ArenaID)
		}
		return ids
	}
	auditOps := func(t *testing.T, arenaID idpkg.ID) map[string]int {
		t.Helper()
		rows, err := pool.Query(ctx,
			`SELECT details->>'op', COUNT(*) FROM audit_log
			 WHERE entity_type = 'arena' AND details_kind = 'camp-link' AND entity_id = $1
			 GROUP BY details->>'op'`, arenaID)
		if err != nil {
			t.Fatalf("audit lookup: %v", err)
		}
		defer rows.Close()
		out := map[string]int{}
		for rows.Next() {
			var op string
			var n int
			if err := rows.Scan(&op, &n); err != nil {
				t.Fatalf("scan audit: %v", err)
			}
			out[op] = n
		}
		return out
	}
	set := func(ids ...idpkg.ID) *[]idpkg.ID { return &ids }

	aOnly := set(campA.ID)

	// Echoing the stored set is a no-op: the link survives, no new audit row.
	if _, err := mSvc.UpdateMatch(ctx, matchID, gameID, map[idpkg.ID]float64{p1: 8, p2: 6}, matchTime.Add(time.Minute),
		elo.UpdateMatchOpts{CampArenaIDs: aOnly, ActorUserID: actor}); err != nil {
		t.Fatalf("edit with the same camp set: %v", err)
	}
	if got := linksOf(); len(got) != 1 || got[0] != campA.ID {
		t.Fatalf("same-set edit must keep the link, got %v", got)
	}
	if ops := auditOps(t, campA.ID); ops["attach"] != 1 || ops["detach"] != 0 {
		t.Fatalf("same-set edit must not write camp-link rows, got %v", ops)
	}

	// Detaching (empty desired set) removes the link, drains the camp
	// synchronously (its players tab empties), and audits the detach. The
	// match itself survives as an ordinary match.
	empty := set()
	if _, err := mSvc.UpdateMatch(ctx, matchID, gameID, map[idpkg.ID]float64{p1: 8, p2: 6}, matchTime.Add(time.Minute),
		elo.UpdateMatchOpts{CampArenaIDs: empty, ActorUserID: actor}); err != nil {
		t.Fatalf("detach edit: %v", err)
	}
	if got := linksOf(); len(got) != 0 {
		t.Fatalf("detach edit must remove the link, got %v", got)
	}
	if ops := auditOps(t, campA.ID); ops["detach"] != 1 {
		t.Fatalf("detach must be audited, got %v", ops)
	}
	w := doJSON(t, router, http.MethodGet, "/arenas/"+string(campA.ID)+"/players", "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET camp A players: %d %s", w.Code, w.Body.String())
	}
	var players arenaPlayersJSON
	if err := json.Unmarshal(w.Body.Bytes(), &players); err != nil {
		t.Fatalf("decode players: %v", err)
	}
	if len(players.Data) != 0 {
		t.Fatalf("detached camp must drain to no players, got %d", len(players.Data))
	}
	var surviving int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM matches WHERE id = $1`, matchID).Scan(&surviving); err != nil {
		t.Fatalf("count matches: %v", err)
	}
	if surviving != 1 {
		t.Fatalf("detach must not delete the match")
	}

	// Attaching a different camp relinks; both a re-attach of A and a fresh
	// link to B work in one edit.
	both := set(campA.ID, campB.ID)
	if _, err := mSvc.UpdateMatch(ctx, matchID, gameID, map[idpkg.ID]float64{p1: 7, p2: 7}, matchTime.Add(2*time.Minute),
		elo.UpdateMatchOpts{CampArenaIDs: both, ActorUserID: actor}); err != nil {
		t.Fatalf("relink edit: %v", err)
	}
	got := linksOf()
	if len(got) != 2 {
		t.Fatalf("relink edit must link both camps, got %v", got)
	}
	if ops := auditOps(t, campA.ID); ops["attach"] != 2 {
		t.Fatalf("re-attach of camp A must be audited, got %v", ops)
	}
	if ops := auditOps(t, campB.ID); ops["attach"] != 1 {
		t.Fatalf("attach of camp B must be audited, got %v", ops)
	}

	// A date moved outside the linked camps without detaching → 409.
	if _, err := mSvc.UpdateMatch(ctx, matchID, gameID, map[idpkg.ID]float64{p1: 7, p2: 7}, end.Add(2*time.Hour),
		elo.UpdateMatchOpts{ActorUserID: actor}); !errors.Is(err, elo.ErrMatchOutsideCampWindows) {
		t.Fatalf("date outside linked windows: got %v, want ErrMatchOutsideCampWindows", err)
	}

	// An explicit set containing an out-of-window camp → 400.
	outOfWindow := set(campA.ID, campB.ID)
	if _, err := mSvc.UpdateMatch(ctx, matchID, gameID, map[idpkg.ID]float64{p1: 7, p2: 7}, end.Add(2*time.Hour),
		elo.UpdateMatchOpts{CampArenaIDs: outOfWindow, ActorUserID: actor}); !errors.Is(err, elo.ErrCampArenaInvalid) {
		t.Fatalf("explicit out-of-window camp: got %v, want ErrCampArenaInvalid", err)
	}

	// Unknown and non-camp ids stay 400.
	if _, err := mSvc.UpdateMatch(ctx, matchID, gameID, map[idpkg.ID]float64{p1: 7, p2: 7}, matchTime,
		elo.UpdateMatchOpts{CampArenaIDs: set(newID(t)), ActorUserID: actor}); !errors.Is(err, elo.ErrCampArenaInvalid) {
		t.Fatalf("unknown camp id: got %v, want ErrCampArenaInvalid", err)
	}
	gameArena, err := campSvc.GetArenaByGame(ctx, gameID)
	if err != nil {
		t.Fatalf("game arena: %v", err)
	}
	if _, err := mSvc.UpdateMatch(ctx, matchID, gameID, map[idpkg.ID]float64{p1: 7, p2: 7}, matchTime,
		elo.UpdateMatchOpts{CampArenaIDs: set(gameArena.ID), ActorUserID: actor}); !errors.Is(err, elo.ErrCampArenaInvalid) {
		t.Fatalf("non-camp arena id: got %v, want ErrCampArenaInvalid", err)
	}

	// And the camp config created audit row exists (the attach rows above also
	// use action 'created', so filter by details kind).
	var configRows int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM audit_log WHERE entity_type = 'arena' AND action = 'created'
		 AND details_kind = 'arena-camp-config' AND entity_id = $1`,
		campA.ID).Scan(&configRows); err != nil {
		t.Fatalf("config audit lookup: %v", err)
	}
	if configRows != 1 {
		t.Fatalf("expected 1 camp config created audit row, got %d", configRows)
	}
}
