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
	"github.com/tolyandre/elo-web-service/pkg/db"
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
	if _, err := svc.AddMatch(ctx, idpkg.ID(gameID), map[idpkg.ID]float64{p1: 100, p2: 50, p3: 10}, time.Now(), newMatchOpts(t)); err != nil {
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

// TestArena_TournamentArenaCreatedAndUpdated verifies the tournament lifecycle
// (arena created on tournament create, filled by the update-arenas admin
// method) and that its filter only counts attached matches.
func TestArena_TournamentArenaCreatedAndUpdated(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	editor := createNamedTestUser(t, pool, "arenas-editor-2", "Арена Редактор 2")
	router := setupRouter(pool)

	tSvc := newTournamentService(pool)
	start := time.Now().Add(-24 * time.Hour)
	end := time.Now().Add(24 * time.Hour)
	tournament, err := tSvc.CreateTournament(ctx, newID(t), "Арена Турнир", start, end, nil)
	if err != nil {
		t.Fatalf("CreateTournament: %v", err)
	}

	// Tournament arenas have no leagues (ADR-24 decision).
	var settingsRaw []byte
	var leagueCheck struct {
		Leagues []any `json:"leagues"`
	}
	if err := pool.QueryRow(ctx, `SELECT settings FROM arenas WHERE tournament_id = $1`, tournament.ID).Scan(&settingsRaw); err != nil {
		t.Fatalf("tournament arena missing: %v", err)
	}
	if err := json.Unmarshal(settingsRaw, &leagueCheck); err != nil {
		t.Fatalf("decode settings: %v", err)
	}
	if len(leagueCheck.Leagues) != 0 {
		t.Fatalf("tournament arena must have no leagues, got %v", leagueCheck.Leagues)
	}

	// Add a match inside the tournament window with its players enrolled —
	// the match auto-attaches to the tournament, whose arena drains in-tx.
	p1 := createTestPlayer(t, pool, "Тур1")
	p2 := createTestPlayer(t, pool, "Тур2")
	q := db.New(pool)
	if err := q.AddTournamentMember(ctx, db.AddTournamentMemberParams{TournamentID: tournament.ID, PlayerID: p1}); err != nil {
		t.Fatalf("add member: %v", err)
	}
	if err := q.AddTournamentMember(ctx, db.AddTournamentMemberParams{TournamentID: tournament.ID, PlayerID: p2}); err != nil {
		t.Fatalf("add member: %v", err)
	}
	svc := newMatchService(pool)
	if _, err := svc.AddMatch(ctx, createTestGame(t, pool, "Турнирная игра"), map[idpkg.ID]float64{p1: 80, p2: 20}, time.Now(), newMatchOpts(t)); err != nil {
		t.Fatalf("AddMatch: %v", err)
	}

	// The tournament arena is fresh (stale) — request the admin update, which
	// recalculates every arena; afterwards the players tab shows the players.
	if w := doJSON(t, router, http.MethodPost, "/admin/update-arenas", editor, ""); w.Code != http.StatusOK {
		t.Fatalf("POST /admin/update-arenas: %d %s", w.Code, w.Body.String())
	}

	var arenaID idpkg.ID
	if err := pool.QueryRow(ctx, `SELECT id FROM arenas WHERE tournament_id = $1`, tournament.ID).Scan(&arenaID); err != nil {
		t.Fatalf("arena lookup: %v", err)
	}
	w := doJSON(t, router, http.MethodGet, "/arenas/"+string(arenaID)+"/players", "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET arena players: %d %s", w.Code, w.Body.String())
	}
	var players arenaPlayersJSON
	if err := json.Unmarshal(w.Body.Bytes(), &players); err != nil {
		t.Fatalf("decode players: %v", err)
	}
	if len(players.Data) != 2 {
		t.Fatalf("expected 2 players in tournament arena, got %d", len(players.Data))
	}
	for _, p := range players.Data {
		if p.League != nil {
			t.Fatalf("league-less arena must have null league, got %q", *p.League)
		}
		if p.MatchesCount != 1 {
			t.Fatalf("player %s matches_count = %d, want 1", p.PlayerID, p.MatchesCount)
		}
	}

	// The /tournaments view lookup: GET /arenas?tournament_id= returns the arena.
	w = doJSON(t, router, http.MethodGet, "/arenas?tournament_id="+string(tournament.ID), "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET /arenas?tournament_id: %d %s", w.Code, w.Body.String())
	}
	var list arenasListJSON
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode arenas: %v", err)
	}
	if len(list.Data) != 1 || list.Data[0].TournamentId == nil {
		t.Fatalf("tournament arena lookup: %+v", list.Data)
	}
	returnedID, err := idpkg.ParseTolerant(*list.Data[0].TournamentId)
	if err != nil || returnedID != tournament.ID {
		t.Fatalf("tournament arena id: returned=%v err=%v want=%s", list.Data[0].TournamentId, err, tournament.ID)
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

// TestArena_GlobalArenaBacksPlayersPage pins the invariant that /players is
// the global arena: after a match the player's rating shows up in both.
func TestArena_GlobalArenaBacksPlayersPage(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	p1 := createTestPlayer(t, pool, "Глобал1")
	p2 := createTestPlayer(t, pool, "Глобал2")

	svc := newMatchService(pool)
	if _, err := svc.AddMatch(ctx, createTestGame(t, pool, "Глобальная игра"), map[idpkg.ID]float64{p1: 60, p2: 20}, time.Now(), newMatchOpts(t)); err != nil {
		t.Fatalf("AddMatch: %v", err)
	}

	globalRating := latestRating(t, pool, p1)

	// The global arena's players tab agrees with /players' data source.
	arenas := newArenaService(pool)
	players, err := arenas.GetArenaPlayers(ctx, elo.GlobalArenaID)
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

// TestArena_MatchesFiltersAndCursor covers the player filter and the cursor
// pagination of the arena match list (the filter travels inside the token).
func TestArena_MatchesFiltersAndCursor(t *testing.T) {
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
		if _, err := svc.AddMatch(context.Background(), gameID, map[idpkg.ID]float64{p1: 100, p2: 50, p3: 10 + float64(i)}, time.Now().Add(-time.Duration(i)*time.Hour), newMatchOpts(t)); err != nil {
			t.Fatalf("AddMatch %d: %v", i, err)
		}
	}

	arenaID := gameArenaID(t, pool, gameID)

	var page struct {
		Data []struct {
			MatchId string `json:"id"`
			Score   map[string]struct {
				PlayerScore float64 `json:"score"`
			} `json:"score"`
		} `json:"data"`
		Next *string `json:"next"`
	}
	decode := func(w *httptest.ResponseRecorder) {
		t.Helper()
		// Responses omit "next" when exhausted; clear the stale pointer so a
		// missing key is not mistaken for a cursor.
		page.Next = nil
		if w.Code != http.StatusOK {
			t.Fatalf("list arena matches: %d %s", w.Code, w.Body.String())
		}
		if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil {
			t.Fatalf("decode page: %v", err)
		}
	}

	// Unfiltered page 1 with limit=1: newest match, cursor for the rest.
	decode(doJSON(t, router, http.MethodGet, "/arenas/"+string(arenaID)+"/matches?limit=1", "", ""))
	if len(page.Data) != 1 || page.Next == nil {
		t.Fatalf("page1 must hold one match and a cursor: %+v", page)
	}

	// Follow the cursor: continuations use the default page size, so one more
	// request returns the remaining matches. Every returned match must be new.
	seen := map[string]bool{page.Data[0].MatchId: true}
	next := *page.Next
	for next != "" {
		decode(doJSON(t, router, http.MethodGet, "/arenas/"+string(arenaID)+"/matches?next="+next, "", ""))
		for _, m := range page.Data {
			if seen[m.MatchId] {
				t.Fatalf("cursor repeated match %s", m.MatchId)
			}
			seen[m.MatchId] = true
		}
		if page.Next == nil {
			break
		}
		next = *page.Next
	}
	if len(seen) != 3 {
		t.Fatalf("expected 3 distinct matches over the cursor, got %d", len(seen))
	}

	// Player filter: selects the matches p2 played (each still shows all
	// its players, same as the /matches page).
	decode(doJSON(t, router, http.MethodGet, "/arenas/"+string(arenaID)+"/matches?player_id="+string(p2), "", ""))
	if len(page.Data) != 3 {
		t.Fatalf("player p2 played 3 matches, got %d match groups", len(page.Data))
	}

	// The filter survives inside the cursor: start a filtered walk with
	// limit=1, then follow the token (default page size) to the end.
	decode(doJSON(t, router, http.MethodGet, "/arenas/"+string(arenaID)+"/matches?player_id="+string(p2)+"&limit=1", "", ""))
	if len(page.Data) != 1 || page.Next == nil {
		t.Fatalf("filtered page1 shape: %+v", page)
	}
	filteredGroups := 1
	next = *page.Next
	for {
		decode(doJSON(t, router, http.MethodGet, "/arenas/"+string(arenaID)+"/matches?next="+next, "", ""))
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
