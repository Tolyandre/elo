//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/elo"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

// gameArenaID returns the id of the auto-managed per-game arena.
func gameArenaID(t *testing.T, pool *pgxpool.Pool, gameID idpkg.ID) idpkg.ID {
	t.Helper()
	var arenaID idpkg.ID
	if err := pool.QueryRow(context.Background(),
		`SELECT id FROM arenas WHERE game_id = $1`, gameID).Scan(&arenaID); err != nil {
		t.Fatalf("game arena lookup: %v", err)
	}
	return arenaID
}

type arenaPlayerJSON struct {
	PlayerID     string  `json:"player_id"`
	Name         string  `json:"name"`
	Rating       float64 `json:"rating"`
	League       *string `json:"league"`
	Rank         *int    `json:"rank"`
	MatchesCount int     `json:"matches_count"`
	FirstCount   int     `json:"first_count"`
	SecondCount  int     `json:"second_count"`
	ThirdCount   int     `json:"third_count"`
	FourthCount  int     `json:"fourth_count"`
}

type arenasListJSON struct {
	Data []struct {
		Id           string          `json:"id"`
		Name         string          `json:"name"`
		Settings     json.RawMessage `json:"settings"`
		GameId       *string         `json:"game_id"`
		TournamentId *string         `json:"tournament_id"`
		MatchesCount *int            `json:"matches_count"`
		Filter       map[string]any  `json:"filter"`
	} `json:"data"`
}

type arenaPlayersJSON struct {
	Data []arenaPlayerJSON `json:"data"`
}

// TestArena_GameArenaUpdatedOnMatchWrite verifies the synchronous drain: a
// match added through the API updates the game arena's settlements, stats and
// ranking before the request returns (ADR-24).
func TestArena_GameArenaUpdatedOnMatchWrite(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	editor := createNamedTestUser(t, pool, "arenas-editor", "Арена Редактор")
	router := setupRouter(pool)

	gameID := string(newID(t))
	if w := doJSON(t, router, http.MethodPost, "/games", editor, `{"id":"`+gameID+`","name":"Ареновая игра"}`); w.Code != http.StatusOK {
		t.Fatalf("create game: %d %s", w.Code, w.Body.String())
	}

	// The game's arena exists right after creation, marked stale.
	var stale *time.Time
	if err := pool.QueryRow(ctx, `SELECT stale_at FROM arenas WHERE game_id = $1`, gameID).Scan(&stale); err != nil {
		t.Fatalf("game arena missing after CreateGame: %v", err)
	}
	if stale == nil {
		t.Fatalf("fresh game arena must start stale")
	}

	// Add a match: the game arena is drained synchronously in the same tx.
	p1 := createTestPlayer(t, pool, "Арена1")
	p2 := createTestPlayer(t, pool, "Арена2")
	p3 := createTestPlayer(t, pool, "Арена3")
	svc := newMatchService(pool)
	if _, err := svc.AddMatch(ctx, blueMenTenantID, idpkg.ID(gameID), map[idpkg.ID]float64{p1: 100, p2: 50, p3: 10}, time.Now(), newMatchOpts(t)); err != nil {
		t.Fatalf("AddMatch: %v", err)
	}

	// Players tab: ranked, with stats and medals computed.
	arenaID := gameArenaID(t, pool, idpkg.ID(gameID))
	w := doJSON(t, router, http.MethodGet, "/arenas/"+string(arenaID)+"/players", "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET arena players: %d %s", w.Code, w.Body.String())
	}
	var players arenaPlayersJSON
	if err := json.Unmarshal(w.Body.Bytes(), &players); err != nil {
		t.Fatalf("decode players: %v", err)
	}
	if len(players.Data) != 3 {
		t.Fatalf("expected 3 players, got %d", len(players.Data))
	}
	first := players.Data[0]
	if first.FirstCount != 1 || first.MatchesCount != 1 {
		t.Fatalf("winner stats: %+v", first)
	}
	if first.Rank == nil || *first.Rank != 1 {
		t.Fatalf("winner rank: %+v", first)
	}
	if first.Rating <= 900 { // game-arena starting rating 900, winner gains
		t.Fatalf("winner rating %.2f did not grow above starting 900", first.Rating)
	}
	if first.League == nil || (*first.League != "newbie" && *first.League != "amateur") {
		t.Fatalf("game arena league: %+v", first.League)
	}

	// The arena is no longer stale.
	if err := pool.QueryRow(ctx, `SELECT stale_at FROM arenas WHERE id = $1`, arenaID).Scan(&stale); err != nil {
		t.Fatalf("re-read arena: %v", err)
	}
	if stale != nil {
		t.Fatalf("arena must be up to date after the synchronous drain, stale_at=%v", stale)
	}
}

// TestArena_CRUDAndValidation covers the CRUD surface: create with a validated
// settings document, list with the game filter, update/delete guards for
// auto-managed arenas and the global arena.
func TestArena_CRUDAndValidation(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	editor := createNamedTestUser(t, pool, "arenas-editor-3", "Арена Редактор 3")
	router := setupRouter(pool)

	// Create the games through the service so their auto-managed arenas exist.
	gameSvc := newGameService(pool)
	ctx := context.Background()
	gameIDRec, err := gameSvc.AddGame(ctx, newID(t), "CRUD игра", idpkg.ID(""))
	if err != nil {
		t.Fatalf("AddGame: %v", err)
	}
	otherGameIDRec, err := gameSvc.AddGame(ctx, newID(t), "Другая игра", idpkg.ID(""))
	if err != nil {
		t.Fatalf("AddGame: %v", err)
	}
	gameID := gameIDRec.ID
	otherGameID := otherGameIDRec.ID

	// Create a two-game arena (the "Кланк!" shape). The name must differ from
	// the arena seeded by migration 052 — names are unique now.
	body := `{"name":"Кланк (тест)","filter":{"game_ids":["` + string(gameID) + `","` + string(otherGameID) + `"],"tag_ids":[]},"settings":{"starting_rating":1000,"leagues":[{"kind":"newbie","goal_gap":16,"earned_min":2,"earned_max":64,"tau":100},{"kind":"amateur"}]}}`
	w := doJSON(t, router, http.MethodPost, "/arenas", editor, body)
	if w.Code != http.StatusOK {
		t.Fatalf("create arena: %d %s", w.Code, w.Body.String())
	}
	var created struct {
		Data struct {
			Id                    string `json:"id"`
			SettingsSchemaVersion int    `json:"settings_schema_version"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode created: %v", err)
	}
	if created.Data.SettingsSchemaVersion != 1 {
		t.Fatalf("settings schema version: %d", created.Data.SettingsSchemaVersion)
	}

	// Invalid settings document → 400.
	w = doJSON(t, router, http.MethodPost, "/arenas", editor, `{"name":"bad","filter":{"game_ids":[],"tag_ids":[]},"settings":{"starting_rating":1000}}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("invalid settings must 400, got %d %s", w.Code, w.Body.String())
	}

	// Arena names are unique, case-insensitively → 400.
	w = doJSON(t, router, http.MethodPost, "/arenas", editor, `{"name":"кланк (ТЕСТ)","filter":{"game_ids":[],"tag_ids":[]},"settings":{"starting_rating":1000,"leagues":[]}}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("duplicate arena name must 400, got %d %s", w.Code, w.Body.String())
	}

	// A second arena cannot be renamed onto the first one's name.
	secondBody := `{"name":"Вторая арена","filter":{"game_ids":["` + string(gameID) + `"],"tag_ids":[]},"settings":{"starting_rating":1000,"leagues":[]}}`
	w = doJSON(t, router, http.MethodPost, "/arenas", editor, secondBody)
	if w.Code != http.StatusOK {
		t.Fatalf("create second arena: %d %s", w.Code, w.Body.String())
	}
	w = doJSON(t, router, http.MethodPatch, "/arenas/"+created.Data.Id, editor, `{"name":"Вторая арена","filter":{"game_ids":[],"tag_ids":[]},"settings":{"starting_rating":1000,"leagues":[]}}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("rename onto a taken name must 400, got %d %s", w.Code, w.Body.String())
	}

	// The new arena appears in both games' arena lists.
	for _, gid := range []string{string(gameID), string(otherGameID)} {
		w := doJSON(t, router, http.MethodGet, "/arenas?game_id="+gid, "", "")
		if w.Code != http.StatusOK {
			t.Fatalf("GET /arenas?game_id: %d %s", w.Code, w.Body.String())
		}
		var list arenasListJSON
		if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
			t.Fatalf("decode: %v", err)
		}
		found := false
		for _, a := range list.Data {
			if a.Id == created.Data.Id {
				found = true
			}
		}
		if !found {
			t.Fatalf("game %s arena list misses the new arena: %+v", gid, list.Data)
		}
	}

	// Update the arena: full recalc pending (stale).
	w = doJSON(t, router, http.MethodPatch, "/arenas/"+created.Data.Id, editor, body)
	if w.Code != http.StatusOK {
		t.Fatalf("update arena: %d %s", w.Code, w.Body.String())
	}
	createdCanonical, err := idpkg.ParseTolerant(created.Data.Id)
	if err != nil {
		t.Fatalf("parse created id: %v", err)
	}
	var staleAt *time.Time
	if err := pool.QueryRow(context.Background(), `SELECT stale_at FROM arenas WHERE id = $1`, createdCanonical).Scan(&staleAt); err != nil {
		t.Fatalf("re-read arena: %v", err)
	}
	if staleAt == nil {
		t.Fatalf("updated arena must be stale pending recalculation")
	}

	// Auto-managed arenas reject PATCH/DELETE.
	gameArena := gameArenaID(t, pool, gameID)
	if w := doJSON(t, router, http.MethodPatch, "/arenas/"+string(gameArena), editor, body); w.Code != http.StatusConflict {
		t.Fatalf("patch auto arena must 409, got %d", w.Code)
	}
	if w := doJSON(t, router, http.MethodDelete, "/arenas/"+string(gameArena), editor, ""); w.Code != http.StatusConflict {
		t.Fatalf("delete auto arena must 409, got %d", w.Code)
	}
	// The global arena is permanent.
	if w := doJSON(t, router, http.MethodPatch, "/arenas/"+globalArenaUUID, editor, body); w.Code != http.StatusConflict {
		t.Fatalf("patch global arena must 409, got %d", w.Code)
	}
	if w := doJSON(t, router, http.MethodDelete, "/arenas/"+globalArenaUUID, editor, ""); w.Code != http.StatusConflict {
		t.Fatalf("delete global arena must 409, got %d", w.Code)
	}

	// Delete the user-created arena.
	if w := doJSON(t, router, http.MethodDelete, "/arenas/"+created.Data.Id, editor, ""); w.Code != http.StatusOK {
		t.Fatalf("delete arena: %d %s", w.Code, w.Body.String())
	}
}

// TestArena_GameListExcludesLinkOnlyArenas pins the /games page arena list
// (GET /arenas?game_id=): the game's own arena and the global arena are
// listed, while link-only arenas — tournament and camp — never are. Their
// membership is the explicit arena_matches link, not a filter on the game,
// so an empty filter must not read as "any game".
func TestArena_GameListExcludesLinkOnlyArenas(t *testing.T) {
	ctx := context.Background()
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	gameSvc := newGameService(pool)
	gameRec, err := gameSvc.AddGame(ctx, newID(t), "Арена-лист игра", idpkg.ID(""))
	if err != nil {
		t.Fatalf("AddGame: %v", err)
	}
	gameID := gameRec.ID

	// Probe tournament arena (the ensureTournamentArena shape: non-camp, no
	// filter, tournament anchor) and probe camp arena.
	tournID := idpkg.New()
	if _, err := pool.Exec(ctx,
		`INSERT INTO tournaments (id, tenant_id, name, status, elimination) VALUES ($1, '00000000-0000-0000-0000-000000000101', 'Арена-лист турнир', 'running', 'single')`,
		tournID); err != nil {
		t.Fatalf("insert probe tournament: %v", err)
	}
	tournArenaID := idpkg.NewMonotonic()
	if _, err := pool.Exec(ctx,
		`INSERT INTO arenas (id, name, settings, settings_schema_version, tournament_id, camp)
		 VALUES ($1, 'Арена-лист турнирная арена', '{"starting_rating":1000,"leagues":[]}', 1, $2, false)`,
		tournArenaID, tournID); err != nil {
		t.Fatalf("insert probe tournament arena: %v", err)
	}
	campArenaID := idpkg.NewMonotonic()
	if _, err := pool.Exec(ctx,
		`INSERT INTO arenas (id, name, settings, settings_schema_version, camp, starts_at, ends_at)
		 VALUES ($1, 'Арена-лист лагерь', '{"starting_rating":1000,"leagues":[]}', 1, true, NOW() - interval '1 day', NOW() + interval '1 day')`,
		campArenaID); err != nil {
		t.Fatalf("insert probe camp arena: %v", err)
	}

	router := setupRouter(pool)
	w := doJSON(t, router, http.MethodGet, "/arenas?game_id="+string(gameID), "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET /arenas?game_id: %d %s", w.Code, w.Body.String())
	}
	var list arenasListJSON
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode: %v", err)
	}

	want := map[idpkg.ID]bool{
		elo.BlueMenArenaID:           true,
		gameArenaID(t, pool, gameID): true,
	}
	for _, a := range list.Data {
		canonical, err := idpkg.ParseTolerant(a.Id)
		if err != nil {
			t.Fatalf("parse listed arena id %q: %v", a.Id, err)
		}
		if !want[canonical] {
			t.Fatalf("unexpected arena %q (%s) in the game list", a.Name, a.Id)
		}
		delete(want, canonical)
	}
	for arenaID := range want {
		t.Fatalf("game list misses expected arena %s", arenaID)
	}
}

// TestArena_GlobalArenaBacksPlayersPage pins the invariant that /players is
// the global arena: after a match the player's rating shows up in both.
func TestArena_GlobalArenaBacksPlayersPage(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	p1 := createTestPlayer(t, pool, "Глобал1")
	p2 := createTestPlayer(t, pool, "Глобал2")

	svc := newMatchService(pool)
	if _, err := svc.AddMatch(ctx, blueMenTenantID, createTestGame(t, pool, "Глобальная игра"), map[idpkg.ID]float64{p1: 60, p2: 20}, time.Now(), newMatchOpts(t)); err != nil {
		t.Fatalf("AddMatch: %v", err)
	}

	globalRating := latestRating(t, pool, p1)

	// The global arena's players tab agrees with /players' data source.
	arenas := newArenaService(pool)
	players, err := arenas.GetArenaPlayers(ctx, elo.BlueMenArenaID)
	if err != nil {
		t.Fatalf("GetArenaPlayers(global): %v", err)
	}
	var found *elo.ArenaPlayer
	for i := range players {
		if players[i].ID == p1 {
			found = &players[i]
		}
	}
	if found == nil {
		t.Fatalf("player missing from the global arena players list")
	}
	if found.Rating != globalRating {
		t.Fatalf("global arena rating %.4f != /players rating %.4f", found.Rating, globalRating)
	}
	if found.MatchesCount != 1 || found.FirstCount != 1 {
		t.Fatalf("global arena stats: %+v", found)
	}
}

// TestArena_EliteHintCountsRecentMatches pins the amateur players-tab hint:
// matches_left_for_elite must be the deficit against the player's actual
// arena-filtered match counts in the 60/180-day windows, not the raw
// requirement.
func TestArena_EliteHintCountsRecentMatches(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	editor := createNamedTestUser(t, pool, "arenas-editor-hint", "Арена Редактор Хинт")
	router := setupRouter(pool)

	gameID := string(newID(t))
	if w := doJSON(t, router, http.MethodPost, "/games", editor, `{"id":"`+gameID+`","name":"Хинтовая игра"}`); w.Code != http.StatusOK {
		t.Fatalf("create game: %d %s", w.Code, w.Body.String())
	}

	// starting_rating equals the elo starting value (1000 in the test seed),
	// so fresh players settle straight into the base (amateur) league.
	body := `{"name":"Хинт арена","filter":{"game_ids":["` + gameID + `"],"tag_ids":[]},` +
		`"settings":{"starting_rating":1000,"leagues":[{"kind":"amateur"},{"kind":"elite","matches_6m":20,"matches_2m":3}]}}`
	w := doJSON(t, router, http.MethodPost, "/arenas", editor, body)
	if w.Code != http.StatusOK {
		t.Fatalf("create arena: %d %s", w.Code, w.Body.String())
	}
	var created struct {
		Data struct {
			Id string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode created arena: %v", err)
	}

	p1 := createTestPlayer(t, pool, "Хинт1")
	p2 := createTestPlayer(t, pool, "Хинт2")
	svc := newMatchService(pool)

	now := time.Now()
	for i := 1; i <= 5; i++ {
		if _, err := svc.AddMatch(ctx, blueMenTenantID, idpkg.ID(gameID), map[idpkg.ID]float64{p1: 100, p2: 50},
			now.Add(-time.Duration(i)*time.Minute), newMatchOpts(t)); err != nil {
			t.Fatalf("AddMatch: %v", err)
		}
	}
	// One more match inside the 6-month window only (100 days ago):
	// cnt60=5, cnt180=6 → deficit = max(20−6, 3−5) = 14 (the bug reported the raw 20).
	if _, err := svc.AddMatch(ctx, blueMenTenantID, idpkg.ID(gameID), map[idpkg.ID]float64{p1: 100, p2: 50},
		now.AddDate(0, 0, -100), newMatchOpts(t)); err != nil {
		t.Fatalf("AddMatch backdated: %v", err)
	}

	// Full replay so the user-created arena is settled deterministically.
	if w := doJSON(t, router, http.MethodPost, "/admin/update-arenas", editor, ""); w.Code != http.StatusOK {
		t.Fatalf("update-arenas: %d %s", w.Code, w.Body.String())
	}

	arenaID, err := idpkg.ParseTolerant(created.Data.Id)
	if err != nil {
		t.Fatalf("parse arena id: %v", err)
	}
	arenas := newArenaService(pool)
	players, err := arenas.GetArenaPlayers(ctx, arenaID)
	if err != nil {
		t.Fatalf("GetArenaPlayers: %v", err)
	}
	for _, p := range players {
		if p.ID != p1 && p.ID != p2 {
			continue
		}
		if p.League == nil || *p.League != "amateur" {
			t.Fatalf("%s league: %v", p.Name, p.League)
		}
		if p.MatchesLeftForElite != 14 {
			t.Fatalf("%s matches_left_for_elite = %d, want 14", p.Name, p.MatchesLeftForElite)
		}
	}
}

// TestArena_Feed_FiltersAndCursor covers the player filter and the cursor
// pagination of the arena feed (ADR-32) — the filter travels inside the token.
func TestArena_Feed_FiltersAndCursor(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	editor := createNamedTestUser(t, pool, "arenas-editor-4", "Арена Редактор 4")
	router := setupRouter(pool)
	_ = editor // reads are public; the editor token exercises nothing extra here

	p1 := createTestPlayer(t, pool, "Фильтр1")
	p2 := createTestPlayer(t, pool, "Фильтр2")
	p3 := createTestPlayer(t, pool, "Фильтр3")
	// Through the service so the per-game arena exists.
	gameSvc := newGameService(pool)
	gameRec, err := gameSvc.AddGame(context.Background(), newID(t), "Фильтр игра", idpkg.ID(""))
	if err != nil {
		t.Fatalf("AddGame: %v", err)
	}
	gameID := gameRec.ID

	svc := newMatchService(pool)
	for i := range 3 {
		if _, err := svc.AddMatch(context.Background(), blueMenTenantID, gameID, map[idpkg.ID]float64{p1: 100, p2: 50, p3: 10 + float64(i)}, time.Now().Add(-time.Duration(i)*time.Hour), newMatchOpts(t)); err != nil {
			t.Fatalf("AddMatch %d: %v", i, err)
		}
	}

	arenaID := gameArenaID(t, pool, gameID)

	var page struct {
		Data []struct {
			Type string `json:"type"`
			Data struct {
				MatchId string `json:"id"`
			} `json:"data"`
		} `json:"data"`
		Next *string `json:"next"`
	}
	decode := func(w *httptest.ResponseRecorder) {
		t.Helper()
		// Responses omit "next" when exhausted; clear the stale pointer so a
		// missing key is not mistaken for a cursor.
		page.Next = nil
		if w.Code != http.StatusOK {
			t.Fatalf("list arena feed: %d %s", w.Code, w.Body.String())
		}
		if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil {
			t.Fatalf("decode page: %v", err)
		}
	}

	// Unfiltered page 1 with limit=1: newest event, cursor for the rest.
	decode(doJSON(t, router, http.MethodGet, "/arenas/"+string(arenaID)+"/feed?limit=1", "", ""))
	if len(page.Data) != 1 || page.Next == nil {
		t.Fatalf("page1 must hold one event and a cursor: %+v", page)
	}
	if page.Data[0].Type != "match" {
		t.Fatalf("non-global arena feed must hold matches only, got %q", page.Data[0].Type)
	}

	// Follow the cursor: continuations use the default page size, so one more
	// request returns the remaining events. Every returned event must be new.
	seen := map[string]bool{page.Data[0].Data.MatchId: true}
	next := *page.Next
	for next != "" {
		decode(doJSON(t, router, http.MethodGet, "/arenas/"+string(arenaID)+"/feed?next="+next, "", ""))
		for _, e := range page.Data {
			if seen[e.Data.MatchId] {
				t.Fatalf("cursor repeated event %s", e.Data.MatchId)
			}
			seen[e.Data.MatchId] = true
		}
		if page.Next == nil {
			break
		}
		next = *page.Next
	}
	if len(seen) != 3 {
		t.Fatalf("expected 3 distinct events over the cursor, got %d", len(seen))
	}

	// Player filter: selects the matches p2 played (each still shows all
	// its players, same as the /matches page).
	decode(doJSON(t, router, http.MethodGet, "/arenas/"+string(arenaID)+"/feed?player_id="+string(p2), "", ""))
	if len(page.Data) != 3 {
		t.Fatalf("player p2 played 3 matches, got %d match groups", len(page.Data))
	}

	// The filter survives inside the cursor: start a filtered walk with
	// limit=1, then follow the token (default page size) to the end.
	decode(doJSON(t, router, http.MethodGet, "/arenas/"+string(arenaID)+"/feed?player_id="+string(p2)+"&limit=1", "", ""))
	if len(page.Data) != 1 || page.Next == nil {
		t.Fatalf("filtered page1 shape: %+v", page)
	}
	filteredGroups := 1
	next = *page.Next
	for {
		decode(doJSON(t, router, http.MethodGet, "/arenas/"+string(arenaID)+"/feed?next="+next, "", ""))
		filteredGroups += len(page.Data)
		if page.Next == nil {
			break
		}
		next = *page.Next
	}
	if filteredGroups != 3 {
		t.Fatalf("expected 3 filtered matches over the cursor, walked %d", filteredGroups)
	}
}
