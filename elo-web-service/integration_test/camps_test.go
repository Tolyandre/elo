//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/elo"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

// The 041 baseline seeds exactly one camp tournament («Челябинский игровой
// кэмп 2026», ADR-04/27); 051 auto-created its arena; 053 converts the arena
// into a camp arena.
const seededCampTournamentID = "00000000-0000-0000-0000-000000000001"

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

// TestCamp_SeededTournamentConverted verifies on the template clone (which
// ran the full 041→053 chain) that the seeded camp tournament's arena became a
// camp arena: window copied from the tournament, filter and anchor dropped,
// participants derived (empty on a fresh database).
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
	// Window copied from the tournament (utc+5 seed dates).
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

// TestCamp_MigrationPreservesLinksAndStats rebuilds the pre-053 production
// shape on a fresh database (migrated to 052, seeded with camp members +
// linked matches, then migrated on) and verifies the conversion: links become
// arena_matches, and after a recalculation the camp's settlements and medal
// stats are exactly the linked matches' RANK semantics — stable across a
// second recalc.
func TestCamp_MigrationPreservesLinksAndStats(t *testing.T) {
	ctx := context.Background()

	// Fresh (non-template) database, migrated to the pre-camp version 052.
	pool, dsn, cleanup := setupTestDBAtVersion(t, 52)
	defer cleanup()

	// Fixture: two camp members, two matches inside the tournament window,
	// linked via match_tournament (the old association table).
	p1 := createTestPlayer(t, pool, "(Кэмп) Миг1")
	p2 := createTestPlayer(t, pool, "(Кэмп) Миг2")
	gameID := createTestGame(t, pool, "Миггра игра")
	m1, m2 := newID(t), newID(t)
	campStart := time.Date(2026, 6, 15, 0, 0, 0, 0, time.FixedZone("+05", 5*3600))
	campEnd := time.Date(2026, 6, 21, 23, 59, 0, 0, time.FixedZone("+05", 5*3600))
	for _, mc := range []struct {
		id     idpkg.ID
		date   time.Time
		s1, s2 float64
	}{
		{m1, campStart.Add(2 * time.Hour), 10, 5},
		{m2, campStart.Add(26 * time.Hour), 5, 10},
	} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO matches (id, date, game_id) VALUES ($1, $2, $3)`, mc.id, mc.date, gameID); err != nil {
			t.Fatalf("insert match: %v", err)
		}
		if _, err := pool.Exec(ctx,
			`INSERT INTO match_scores (match_id, player_id, score) VALUES ($1, $2, $3), ($1, $4, $5)`,
			mc.id, p1, mc.s1, p2, mc.s2); err != nil {
			t.Fatalf("insert scores: %v", err)
		}
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO tournament_player_membership (tournament_id, player_id) VALUES ($1, $2), ($1, $3)`,
		seededCampTournamentID, p1, p2); err != nil {
		t.Fatalf("insert members: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO match_tournament (match_id, tournament_id) VALUES ($1, $3), ($2, $3)`,
		m1, m2, seededCampTournamentID); err != nil {
		t.Fatalf("insert match_tournament: %v", err)
	}
	var arenaID idpkg.ID
	if err := pool.QueryRow(ctx,
		`SELECT id FROM arenas WHERE tournament_id = $1`, seededCampTournamentID).Scan(&arenaID); err != nil {
		t.Fatalf("pre-migration tournament arena missing: %v", err)
	}
	pool.Close()

	// Apply 053 and verify the conversion.
	migrateToVersion(t, dsn, 0)
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("reconnect: %v", err)
	}
	defer pool.Close()

	var camp bool
	var startsAt, endsAt time.Time
	var filterID, anchorID *string
	if err := pool.QueryRow(ctx,
		`SELECT camp, starts_at, ends_at, match_filter_id::text, tournament_id::text FROM arenas WHERE id = $1`,
		arenaID).Scan(&camp, &startsAt, &endsAt, &filterID, &anchorID); err != nil {
		t.Fatalf("converted arena missing: %v", err)
	}
	if !camp || filterID != nil || anchorID != nil || !startsAt.Equal(campStart) || !endsAt.Equal(campEnd) {
		t.Fatalf("conversion wrong: camp=%v filter=%v anchor=%v window=%v..%v", camp, filterID, anchorID, startsAt, endsAt)
	}

	var linked int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM arena_matches WHERE arena_id = $1`, arenaID).Scan(&linked); err != nil {
		t.Fatalf("count arena_matches: %v", err)
	}
	if linked != 2 {
		t.Fatalf("expected 2 preserved links, got %d", linked)
	}

	// Recalculate every arena; the camp must settle from arena_matches.
	editor := createNamedTestUser(t, pool, "camp-mig-editor", "Кэмп Миг Редактор")
	router := setupRouter(pool)
	drain := func() {
		t.Helper()
		if w := doJSON(t, router, http.MethodPost, "/admin/update-arenas", editor, ""); w.Code != http.StatusOK {
			t.Fatalf("POST /admin/update-arenas: %d %s", w.Code, w.Body.String())
		}
	}
	drain()

	snapshot := func(t *testing.T) string {
		t.Helper()
		rows, err := pool.Query(ctx,
			`SELECT player_id, date, elo_after, rating_after, league FROM arena_settlements
			 WHERE arena_id = $1 AND discriminator = 'match' ORDER BY date, id`, arenaID)
		if err != nil {
			t.Fatalf("read settlements: %v", err)
		}
		defer rows.Close()
		out := ""
		for rows.Next() {
			var pid string
			var date time.Time
			var eloAfter, ratingAfter float64
			var league *string
			if err := rows.Scan(&pid, &date, &eloAfter, &ratingAfter, &league); err != nil {
				t.Fatalf("scan settlement: %v", err)
			}
			if league != nil {
				t.Fatalf("camp arena settlements must have null league, got %q", *league)
			}
			out += fmt.Sprintf("%s|%d|%.6f|%.6f\n", pid, date.Unix(), eloAfter, ratingAfter)
		}
		return out
	}

	first := snapshot(t)
	if got := len(first); got == 0 {
		t.Fatalf("no camp settlements after recalc")
	}

	// Players tab: matches_count=2 each, one first place each (RANK semantics).
	w := doJSON(t, router, http.MethodGet, "/arenas/"+string(arenaID)+"/players", "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET arena players: %d %s", w.Code, w.Body.String())
	}
	var players arenaPlayersJSON
	if err := json.Unmarshal(w.Body.Bytes(), &players); err != nil {
		t.Fatalf("decode players: %v", err)
	}
	if len(players.Data) != 2 {
		t.Fatalf("expected 2 camp players, got %d", len(players.Data))
	}
	for _, p := range players.Data {
		if p.MatchesCount != 2 || p.FirstCount != 1 || p.SecondCount != 1 {
			t.Fatalf("player %s stats: %+v, want matches=2 first=1 second=1", p.PlayerID, p)
		}
		if p.League != nil {
			t.Fatalf("camp players must be league-less, got %q", *p.League)
		}
	}

	// A second recalc must be a stable no-op over the settlements.
	drain()
	if second := snapshot(t); second != first {
		t.Fatalf("camp recalc is not stable:\nfirst:\n%s\nsecond:\n%s", first, second)
	}

	// kind=camps lists the arena with the derived participants.
	w = doJSON(t, router, http.MethodGet, "/arenas?kind=camps", "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET /arenas?kind=camps: %d %s", w.Code, w.Body.String())
	}
	var list campArenaJSON
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode arenas: %v", err)
	}
	var found *struct {
		Id        string   `json:"id"`
		PlayerIds []string `json:"player_ids"`
	}
	for i := range list.Data {
		if list.Data[i].Id == shortOf(t, arenaID) {
			pi := list.Data[i]
			found = &struct {
				Id        string   `json:"id"`
				PlayerIds []string `json:"player_ids"`
			}{pi.Id, pi.PlayerIds}
		}
	}
	if found == nil || len(found.PlayerIds) != 2 {
		t.Fatalf("camp listing must carry 2 derived participants, got %+v", found)
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
