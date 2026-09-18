//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

// short encodes a canonical uuid to the Base58 wire form.
func short(canonical idpkg.ID) string {
	return string(canonical.Base58())
}

// TestTournament_Migration056RebuildEntity drives a fresh database to 055,
// shapes the pre-ADR-26 state (a camp-shell tournaments row plus a still-
// anchored arena, which 053 should have prevented but the migration defends
// against), migrates on, and verifies the rebuild: the shell row is deleted,
// the arena survives detached, and the widened audit constraints plus the new
// pure-expression membership function behave per ADR-26/28.
func TestTournament_Migration056RebuildEntity(t *testing.T) {
	ctx := context.Background()

	pool, dsn, cleanup := setupTestDBAtVersion(t, 55)
	defer cleanup()

	playerID := createTestPlayer(t, pool, "(Турнир) Миг")
	gameID := createTestGame(t, pool, "Миггра игра")
	shellID := idpkg.ID("00000000-0000-0000-0000-000000000099")
	if _, err := pool.Exec(ctx,
		`INSERT INTO tournaments (id, name) VALUES ($1, 'Старый кэмп-шелл')`, shellID); err != nil {
		t.Fatalf("insert legacy tournament: %v", err)
	}

	// A defensively detached arena: non-camp, so it needs a filter (053 CHECKs).
	filterID := idpkg.NewMonotonic()
	if _, err := pool.Exec(ctx,
		`INSERT INTO match_filters (id, date_from, date_to, game_ids, tag_ids)
		 VALUES ($1, NULL, NULL, $2, '{}')`, filterID, []idpkg.ID{gameID}); err != nil {
		t.Fatalf("insert filter: %v", err)
	}
	arenaID := idpkg.NewMonotonic()
	if _, err := pool.Exec(ctx,
		`INSERT INTO arenas (id, name, match_filter_id, settings, settings_schema_version, tournament_id, camp)
		 VALUES ($1, 'Арена старого кэмпа', $2, '{"starting_rating":900,"leagues":[]}', 1, $3, false)`,
		arenaID, filterID, shellID); err != nil {
		t.Fatalf("insert anchored arena: %v", err)
	}

	migrateToVersion(t, dsn, 0)

	// The shell row is gone; its name is reusable.
	var count int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM tournaments`).Scan(&count); err != nil {
		t.Fatalf("count tournaments: %v", err)
	}
	if count != 0 {
		t.Fatalf("tournaments must be empty after 056, got %d rows", count)
	}

	// The arena survived, detached from the deleted tournament, filter intact.
	var (
		name        string
		anchor      *idpkg.ID
		stillFilter *idpkg.ID
	)
	if err := pool.QueryRow(ctx,
		`SELECT name, tournament_id, match_filter_id FROM arenas WHERE id = $1`, arenaID,
	).Scan(&name, &anchor, &stillFilter); err != nil {
		t.Fatalf("arena lookup after migration: %v", err)
	}
	if name != "Арена старого кэмпа" || anchor != nil || stillFilter == nil {
		t.Fatalf("arena after 056: name=%q anchor=%v filter=%v", name, anchor, stillFilter)
	}

	// Players and games are untouched.
	var players int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM players WHERE id = $1`, playerID).Scan(&players); err != nil {
		t.Fatalf("player lookup: %v", err)
	}
	if players != 1 {
		t.Fatalf("player must survive the migration")
	}

	// The membership function: tournament branch first, then camp, then filter.
	matchID := newID(t)
	if _, err := pool.Exec(ctx,
		`INSERT INTO matches (id, date, game_id) VALUES ($1, NOW(), $2)`, matchID, gameID); err != nil {
		t.Fatalf("insert probe match: %v", err)
	}
	// A live (post-rebuild) tournament whose link table feeds the probe.
	tournID := idpkg.New()
	if _, err := pool.Exec(ctx,
		`INSERT INTO tournaments (id, name, status, elimination) VALUES ($1, 'Миграционный турнир', 'running', 'single')`,
		tournID); err != nil {
		t.Fatalf("insert probe tournament: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO tournament_matches (tournament_id, match_id) VALUES ($1, $2)`, tournID, matchID); err != nil {
		t.Fatalf("insert probe link: %v", err)
	}
	cases := []struct {
		what  string
		query string
		args  []any
		want  bool
	}{
		{
			what: "tournament arena contains a linked match",
			query: `SELECT arena_contains_match(
				false, true,
				false,
				EXISTS (SELECT 1 FROM tournament_matches tm WHERE tm.tournament_id = $1 AND tm.match_id = $2),
				false, NOW(), $3, NULL, NULL, NULL, NULL)`,
			args: []any{tournID, matchID, gameID},
			want: true,
		},
		{
			what: "tournament arena ignores the filter (NULL filter matches nothing)",
			query: `SELECT arena_contains_match(
				false, true,
				false,
				false,
				false, NOW(), $1, NULL, NULL, NULL, NULL)`,
			args: []any{gameID},
			want: false,
		},
		{
			what: "camp arena still link-only",
			query: `SELECT arena_contains_match(
				true, false,
				true,
				false,
				false, NOW(), $1, NULL, NULL, NULL, NULL)`,
			args: []any{gameID},
			want: true,
		},
		{
			what: "filter arena with an empty filter contains every match",
			query: `SELECT arena_contains_match(
				false, false,
				false, false,
				false, NOW(), $1, NULL, NULL, NULL, NULL)`,
			args: []any{gameID},
			want: true,
		},
	}
	for _, tc := range cases {
		var got bool
		if err := pool.QueryRow(ctx, tc.query, tc.args...).Scan(&got); err != nil {
			t.Fatalf("%s: %v", tc.what, err)
		}
		if got != tc.want {
			t.Fatalf("%s: got %v, want %v", tc.what, got, tc.want)
		}
	}

	// The widened audit constraints accept a tournament row with a NULL system
	// actor (the deadline auto-cancel shape, ADR-26).
	if _, err := pool.Exec(ctx,
		`INSERT INTO audit_log (id, actor_user_id, entity_type, entity_id, action, details_kind, details_schema_version, details)
		 VALUES ($1, NULL, 'tournament', $2, 'updated', 'tournament-state', 1, '{"schema_version":1,"from":"running","to":"cancelled","reason":"deadline"}'::jsonb)`,
		idpkg.NewMonotonic(), shellID); err != nil {
		t.Fatalf("insert tournament audit row: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Phase 3: registration-time API (create/update, self-registration, plans)
// ---------------------------------------------------------------------------

type tournamentJSON struct {
	Data struct {
		Id                 string  `json:"id"`
		Name               string  `json:"name"`
		Status             string  `json:"status"`
		Elimination        string  `json:"elimination"`
		GrandFinalDeadline *string `json:"grand_final_deadline"`
		WinnerPlayerId     *string `json:"winner_player_id"`
		Games              []struct {
			GameId     string `json:"game_id"`
			MinPlayers int    `json:"min_players"`
			MaxPlayers int    `json:"max_players"`
		} `json:"games"`
		ParticipantIds []string `json:"participant_ids"`
		CreatedAt      string   `json:"created_at"`
	} `json:"data"`
}

type tournamentListJSON struct {
	Data []tournamentJSON `json:"data"`
}

type bracketPlansJSON struct {
	Data struct {
		Plans []struct {
			Elimination string `json:"elimination"`
			Rounds      []struct {
				Track   string `json:"track"`
				Index   int    `json:"index"`
				Promote int    `json:"promote"`
				Slots   []struct {
					SeatCount int `json:"seat_count"`
					Seats     []struct {
						Kind        string `json:"kind"`
						SourceSlot  int    `json:"source_slot"`
						SourcePlace int    `json:"source_place"`
					} `json:"seats"`
				} `json:"slots"`
			} `json:"rounds"`
		} `json:"plans"`
		Truncated bool `json:"truncated"`
		Cap       int  `json:"cap"`
	} `json:"data"`
}

// TestTournament_CRUDAndRegistration drives the registration-time surface:
// idempotent create with pool + initial participants, config PUT (desired
// participant set), the detail/list reads, and the audit trail (create row,
// update row, and nothing for a no-op PUT).
func TestTournament_CRUDAndRegistration(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	router := setupRouter(pool)

	admin, _ := createTestUserWithID(t, pool, true)
	gameID := createTestGame(t, pool, "Турнирная игра")
	p1 := createTestPlayer(t, pool, "Тур1")
	p2 := createTestPlayer(t, pool, "Тур2")
	p3 := createTestPlayer(t, pool, "Тур3")

	tid := newID(t)
	createBody := fmt.Sprintf(`{
		"id": %q, "name": "Осенний блиц", "elimination": "single",
		"grand_final_deadline": "2099-01-01T00:00:00Z",
		"games": [{"game_id": %q, "min_players": 2, "max_players": 4}],
		"participant_ids": [%q, %q]
	}`, short(tid), short(gameID), short(p1), short(p2))

	w := doJSON(t, router, http.MethodPost, "/tournaments", admin, createBody)
	if w.Code != http.StatusOK {
		t.Fatalf("create tournament: %d %s", w.Code, w.Body.String())
	}
	var created tournamentJSON
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	if created.Data.Status != "registration" || created.Data.Elimination != "single" {
		t.Fatalf("created state: %+v", created.Data)
	}
	if created.Data.GrandFinalDeadline == nil {
		t.Fatalf("deadline must round-trip")
	}
	if len(created.Data.ParticipantIds) != 2 {
		t.Fatalf("participants: %v", created.Data.ParticipantIds)
	}

	// Id replay returns the same row.
	w = doJSON(t, router, http.MethodPost, "/tournaments", admin, createBody)
	if w.Code != http.StatusOK {
		t.Fatalf("id replay: %d %s", w.Code, w.Body.String())
	}

	// PUT: rename, rewrite the pool, extend the participant set.
	updateBody := fmt.Sprintf(`{
		"name": "Осенний блиц 2026", "elimination": "single",
		"games": [{"game_id": %q, "min_players": 2, "max_players": 2}],
		"participant_ids": [%q, %q, %q]
	}`, short(gameID), short(p1), short(p2), short(p3))
	w = doJSON(t, router, http.MethodPut, "/tournaments/"+short(tid), admin, updateBody)
	if w.Code != http.StatusOK {
		t.Fatalf("update tournament: %d %s", w.Code, w.Body.String())
	}
	var updated tournamentJSON
	if err := json.Unmarshal(w.Body.Bytes(), &updated); err != nil {
		t.Fatalf("decode update response: %v", err)
	}
	if updated.Data.Name != "Осенний блиц 2026" || updated.Data.GrandFinalDeadline != nil {
		t.Fatalf("update result: %+v", updated.Data)
	}
	if len(updated.Data.ParticipantIds) != 3 {
		t.Fatalf("desired participant set: %v", updated.Data.ParticipantIds)
	}
	if len(updated.Data.Games) != 1 || updated.Data.Games[0].MaxPlayers != 2 {
		t.Fatalf("pool: %+v", updated.Data.Games)
	}

	// A no-op PUT changes nothing → no second update row.
	w = doJSON(t, router, http.MethodPut, "/tournaments/"+short(tid), admin, updateBody)
	if w.Code != http.StatusOK {
		t.Fatalf("no-op update: %d %s", w.Code, w.Body.String())
	}

	page := listAudit(t, router, "?entity_type=tournament&entity_id="+short(tid))
	if len(page.Data) != 2 {
		t.Fatalf("expected create+update audit rows, got %d", len(page.Data))
	}

	// Detail read.
	w = doJSON(t, router, http.MethodGet, "/tournaments/"+short(tid), "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("get tournament: %d %s", w.Code, w.Body.String())
	}

	// 404 for an unknown id.
	w = doJSON(t, router, http.MethodGet, "/tournaments/"+short(newID(t)), "", "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("unknown tournament must 404, got %d", w.Code)
	}
}

// TestTournament_SelfRegistration exercises the linked-player registration
// endpoints, their 403 for users without a linked player, and the 409 once
// registration is closed.
func TestTournament_SelfRegistration(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	router := setupRouter(pool)

	admin, _ := createTestUserWithID(t, pool, true)
	playerToken, playerUserID := createTestUserWithID(t, pool, false)
	playerNoLinkToken, _ := createTestUserWithID(t, pool, false) // no linked player

	p := createTestPlayer(t, pool, "СебяЗаписал")
	gameID := createTestGame(t, pool, "Регистрационная игра")
	if _, err := pool.Exec(context.Background(),
		`UPDATE users SET player_id = $2 WHERE id = $1`, idpkg.ID(playerUserID), p); err != nil {
		t.Fatalf("link player: %v", err)
	}

	tid := newID(t)
	createBody := fmt.Sprintf(`{"id": %q, "name": "Открытый кубок", "elimination": "double", "games": [{"game_id": %q, "min_players": 2, "max_players": 4}]}`,
		short(tid), short(gameID))
	if w := doJSON(t, router, http.MethodPost, "/tournaments", admin, createBody); w.Code != http.StatusOK {
		t.Fatalf("create tournament: %d %s", w.Code, w.Body.String())
	}

	// Linked player registers; the idempotent replay stays a single row.
	if w := doJSON(t, router, http.MethodPost, "/tournaments/"+short(tid)+"/registration", playerToken, ""); w.Code != http.StatusOK {
		t.Fatalf("register: %d %s", w.Code, w.Body.String())
	}
	if w := doJSON(t, router, http.MethodPost, "/tournaments/"+short(tid)+"/registration", playerToken, ""); w.Code != http.StatusOK {
		t.Fatalf("register replay: %d %s", w.Code, w.Body.String())
	}
	w := doJSON(t, router, http.MethodGet, "/tournaments/"+short(tid), "", "")
	var detail tournamentJSON
	if err := json.Unmarshal(w.Body.Bytes(), &detail); err != nil {
		t.Fatalf("decode detail: %v", err)
	}
	if len(detail.Data.ParticipantIds) != 1 || detail.Data.ParticipantIds[0] != short(p) {
		t.Fatalf("participants after register: %v", detail.Data.ParticipantIds)
	}

	// A user without a linked player is 403 (RequirePlayerID).
	w = doJSON(t, router, http.MethodPost, "/tournaments/"+short(tid)+"/registration", playerNoLinkToken, "")
	if w.Code != http.StatusForbidden {
		t.Fatalf("unlinked user must 403, got %d", w.Code)
	}

	// Withdraw; a second withdraw is an idempotent no-op.
	if w := doJSON(t, router, http.MethodDelete, "/tournaments/"+short(tid)+"/registration", playerToken, ""); w.Code != http.StatusOK {
		t.Fatalf("withdraw: %d %s", w.Code, w.Body.String())
	}
	if w := doJSON(t, router, http.MethodDelete, "/tournaments/"+short(tid)+"/registration", playerToken, ""); w.Code != http.StatusOK {
		t.Fatalf("withdraw replay: %d %s", w.Code, w.Body.String())
	}

	// Closed registration → 409.
	res, err := pool.Exec(context.Background(),
		`UPDATE tournaments SET status = 'running' WHERE id = $1`, tid)
	if err != nil {
		t.Fatalf("close registration: %v", err)
	}
	if n := res.RowsAffected(); n != 1 {
		var status string
		_ = pool.QueryRow(context.Background(), `SELECT status FROM tournaments WHERE id = $1`, tid).Scan(&status)
		t.Fatalf("close registration affected %d rows (status now %q)", n, status)
	}
	w = doJSON(t, router, http.MethodPost, "/tournaments/"+short(tid)+"/registration", playerToken, "")
	var statusNow string
	_ = pool.QueryRow(context.Background(), `SELECT status FROM tournaments WHERE id = $1`, tid).Scan(&statusNow)
	if w.Code != http.StatusConflict {
		t.Fatalf("closed registration must 409, got %d %s (status now %q)", w.Code, w.Body.String(), statusNow)
	}
}

// TestTournament_BracketPlans covers the enumeration endpoint: the 8-player
// 4-seat-only pool offers exactly the flagship shape, and the error paths
// (too few participants, empty pool, closed registration) behave.
func TestTournament_BracketPlans(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	router := setupRouter(pool)

	admin, _ := createTestUserWithID(t, pool, true)
	gameID := createTestGame(t, pool, "Четвёрки")
	gameID2 := createTestGame(t, pool, "Парные")

	tid := newID(t)
	var ids []string
	for i := 0; i < 8; i++ {
		p := createTestPlayer(t, pool, fmt.Sprintf("Сеточник%d", i))
		ids = append(ids, fmt.Sprintf("%q", short(p)))
	}
	createBody := fmt.Sprintf(`{"id": %q, "name": "Кубок четвёрок", "elimination": "single", "games": [{"game_id": %q, "min_players": 4, "max_players": 4}], "participant_ids": [%s]}`,
		short(tid), short(gameID), strings.Join(ids, ","))
	if w := doJSON(t, router, http.MethodPost, "/tournaments", admin, createBody); w.Code != http.StatusOK {
		t.Fatalf("create tournament: %d %s", w.Code, w.Body.String())
	}

	w := doJSON(t, router, http.MethodGet, "/tournaments/"+short(tid)+"/bracket-plans", admin, "")
	if w.Code != http.StatusOK {
		t.Fatalf("bracket-plans: %d %s", w.Code, w.Body.String())
	}
	var plans bracketPlansJSON
	if err := json.Unmarshal(w.Body.Bytes(), &plans); err != nil {
		t.Fatalf("decode plans: %v", err)
	}
	if len(plans.Data.Plans) != 1 || plans.Data.Truncated {
		t.Fatalf("8/{{4}} must offer exactly 1 plan, got %d truncated=%v", len(plans.Data.Plans), plans.Data.Truncated)
	}
	p := plans.Data.Plans[0]
	if len(p.Rounds) != 2 || p.Rounds[0].Promote != 2 || len(p.Rounds[0].Slots) != 2 || p.Rounds[0].Slots[0].SeatCount != 4 {
		t.Fatalf("flagship plan shape: %+v", p.Rounds)
	}
	if p.Rounds[1].Track != "final" || p.Rounds[1].Slots[0].Seats[0].Kind != "source" {
		t.Fatalf("final round must be source-seated: %+v", p.Rounds[1])
	}

	// Too few participants → 400.
	small := newID(t)
	one := createTestPlayer(t, pool, "Один")
	createBody = fmt.Sprintf(`{"id": %q, "name": "Малый кубок", "elimination": "single", "games": [{"game_id": %q, "min_players": 2, "max_players": 4}], "participant_ids": [%q]}`,
		short(small), short(gameID2), short(one))
	if w := doJSON(t, router, http.MethodPost, "/tournaments", admin, createBody); w.Code != http.StatusOK {
		t.Fatalf("create small tournament: %d %s", w.Code, w.Body.String())
	}
	w = doJSON(t, router, http.MethodGet, "/tournaments/"+short(small)+"/bracket-plans", admin, "")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("1 participant must 400, got %d", w.Code)
	}

	// Empty pool → 400.
	empty := newID(t)
	createBody = fmt.Sprintf(`{"id": %q, "name": "Без игр", "elimination": "single"}`, short(empty))
	if w := doJSON(t, router, http.MethodPost, "/tournaments", admin, createBody); w.Code != http.StatusOK {
		t.Fatalf("create empty-pool tournament: %d %s", w.Code, w.Body.String())
	}
	w = doJSON(t, router, http.MethodGet, "/tournaments/"+short(empty)+"/bracket-plans", admin, "")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("empty pool must 400, got %d", w.Code)
	}

	// Closed registration → 409.
	if _, err := pool.Exec(context.Background(),
		`UPDATE tournaments SET status = 'running' WHERE id = $1`, tid); err != nil {
		t.Fatalf("close registration: %v", err)
	}
	w = doJSON(t, router, http.MethodGet, "/tournaments/"+short(tid)+"/bracket-plans", admin, "")
	if w.Code != http.StatusConflict {
		t.Fatalf("closed registration must 409, got %d", w.Code)
	}
}

// ---------------------------------------------------------------------------
// Phase 4: start, materialization, bracket, arena
// ---------------------------------------------------------------------------

type bracketJSON struct {
	Data struct {
		TournamentId   string `json:"tournament_id"`
		Status         string `json:"status"`
		Elimination    string `json:"elimination"`
		WinnerPlayerId string `json:"winner_player_id"`
		Rounds         []struct {
			Track string `json:"track"`
			Index int    `json:"index"`
			Slots []struct {
				Id       string `json:"id"`
				GameId   string `json:"game_id"`
				Position int    `json:"position"`
				Promote  int    `json:"promote"`
				Status   string `json:"status"`
				Seats    []struct {
					Position     int     `json:"position"`
					PlayerId     *string `json:"player_id"`
					SourceSlotId *string `json:"source_slot_id"`
					SourcePlace  *int    `json:"source_place"`
				} `json:"seats"`
				Matches []struct {
					MatchId string `json:"match_id"`
				} `json:"matches"`
				Standings []struct {
					PlayerId string `json:"player_id"`
					Points   int    `json:"points"`
					Place    int    `json:"place"`
					Promoted bool   `json:"promoted"`
				} `json:"standings"`
			} `json:"slots"`
		} `json:"rounds"`
	} `json:"data"`
}

// TestTournament_StartMaterializesBracket drives the start action on the
// flagship 8-player shape: the seeded draw fills both round-1 tables (every
// participant seated exactly once), the final waits on sources, the arena is
// created, and the status flips to running. A hand-forged plan is rejected.
func TestTournament_StartMaterializesBracket(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	router := setupRouter(pool)

	admin, _ := createTestUserWithID(t, pool, true)
	gameID := createTestGame(t, pool, "Стартовая игра")

	tid := newID(t)
	var ids []string
	players := make([]idpkg.ID, 0, 8)
	for i := 0; i < 8; i++ {
		p := createTestPlayer(t, pool, fmt.Sprintf("Стартер%d", i))
		players = append(players, p)
		ids = append(ids, fmt.Sprintf("%q", short(p)))
	}
	createBody := fmt.Sprintf(`{"id": %q, "name": "Стартовый кубок", "elimination": "single", "games": [{"game_id": %q, "min_players": 4, "max_players": 4}], "participant_ids": [%s]}`,
		short(tid), short(gameID), strings.Join(ids, ","))
	if w := doJSON(t, router, http.MethodPost, "/tournaments", admin, createBody); w.Code != http.StatusOK {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}

	// A hand-forged plan (promote 3 against 4-seat tables is fine per bounds,
	// but this shape leaves 3 players output where the final needs 4 — not
	// offered by the enumerator) must be rejected.
	handForged := `{"elimination":"single","rounds":[
		{"track":"winners","index":1,"promote":3,"slots":[
			{"seat_count":4,"seats":[{"kind":"draw"},{"kind":"draw"},{"kind":"draw"},{"kind":"draw"}]},
			{"seat_count":4,"seats":[{"kind":"draw"},{"kind":"draw"},{"kind":"draw"},{"kind":"draw"}]}]},
		{"track":"final","index":1,"promote":1,"slots":[
			{"seat_count":6,"seats":[{"kind":"source","source_slot":0,"source_place":1},{"kind":"source","source_slot":0,"source_place":2},{"kind":"source","source_slot":0,"source_place":3},{"kind":"source","source_slot":1,"source_place":1},{"kind":"source","source_slot":1,"source_place":2},{"kind":"source","source_slot":1,"source_place":3}]}]}]}`
	w := doJSON(t, router, http.MethodPost, "/tournaments/"+short(tid)+"/start", admin, `{"plan":`+handForged+`}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("hand-forged plan must 400, got %d %s", w.Code, w.Body.String())
	}

	// The flagship plan goes through.
	w = doJSON(t, router, http.MethodPost, "/tournaments/"+short(tid)+"/start", admin, `{"plan":{"elimination":"single","rounds":[
		{"track":"winners","index":1,"promote":2,"slots":[
			{"seat_count":4,"seats":[{"kind":"draw"},{"kind":"draw"},{"kind":"draw"},{"kind":"draw"}]},
			{"seat_count":4,"seats":[{"kind":"draw"},{"kind":"draw"},{"kind":"draw"},{"kind":"draw"}]}]},
		{"track":"final","index":1,"promote":1,"slots":[
			{"seat_count":4,"seats":[{"kind":"source","source_slot":0,"source_place":1},{"kind":"source","source_slot":0,"source_place":2},{"kind":"source","source_slot":1,"source_place":1},{"kind":"source","source_slot":1,"source_place":2}]}]}]}}`)
	if w.Code != http.StatusOK {
		t.Fatalf("start: %d %s", w.Code, w.Body.String())
	}

	// A second start is a 409.
	w = doJSON(t, router, http.MethodPost, "/tournaments/"+short(tid)+"/start", admin, `{"plan":{"elimination":"single","rounds":[
		{"track":"winners","index":1,"promote":2,"slots":[
			{"seat_count":4,"seats":[{"kind":"draw"},{"kind":"draw"},{"kind":"draw"},{"kind":"draw"}]},
			{"seat_count":4,"seats":[{"kind":"draw"},{"kind":"draw"},{"kind":"draw"},{"kind":"draw"}]}]},
		{"track":"final","index":1,"promote":1,"slots":[
			{"seat_count":4,"seats":[{"kind":"source","source_slot":0,"source_place":1},{"kind":"source","source_slot":0,"source_place":2},{"kind":"source","source_slot":1,"source_place":1},{"kind":"source","source_slot":1,"source_place":2}]}]}]}}`)
	if w.Code != http.StatusConflict {
		t.Fatalf("second start must 409, got %d", w.Code)
	}

	// The bracket: round 1 fully drawn and playing, the final waiting on
	// sources, the tournament's own game on every slot.
	w = doJSON(t, router, http.MethodGet, "/tournaments/"+short(tid)+"/bracket", "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("bracket: %d %s", w.Code, w.Body.String())
	}
	var br bracketJSON
	if err := json.Unmarshal(w.Body.Bytes(), &br); err != nil {
		t.Fatalf("decode bracket: %v", err)
	}
	if br.Data.Status != "running" || br.Data.Elimination != "single" || len(br.Data.Rounds) != 2 {
		t.Fatalf("bracket head: %+v", br.Data)
	}
	r1 := br.Data.Rounds[0]
	if r1.Track != "winners" || len(r1.Slots) != 2 {
		t.Fatalf("round 1: %+v", r1)
	}
	seen := map[string]bool{}
	for _, slot := range r1.Slots {
		if slot.Status != "playing" || slot.GameId != short(gameID) || slot.Promote != 2 {
			t.Fatalf("round-1 slot: %+v", slot)
		}
		for _, seat := range slot.Seats {
			if seat.PlayerId == nil || seat.SourceSlotId != nil {
				t.Fatalf("round-1 seat must be drawn: %+v", seat)
			}
			seen[*seat.PlayerId] = true
		}
	}
	if len(seen) != 8 {
		t.Fatalf("the draw must seat all 8 participants exactly once, got %d distinct", len(seen))
	}
	final := br.Data.Rounds[1]
	if final.Track != "final" || len(final.Slots) != 1 || len(final.Slots[0].Seats) != 4 {
		t.Fatalf("final: %+v", final)
	}
	for _, seat := range final.Slots[0].Seats {
		if seat.PlayerId != nil || seat.SourceSlotId == nil || seat.SourcePlace == nil {
			t.Fatalf("final seats must wait on sources: %+v", seat)
		}
	}

	// The tournament arena exists and is anchored to the tournament.
	var arenaName string
	if err := pool.QueryRow(context.Background(),
		`SELECT a.name FROM arenas a WHERE a.tournament_id = $1`, tid).Scan(&arenaName); err != nil {
		t.Fatalf("tournament arena: %v", err)
	}
	w = doJSON(t, router, http.MethodGet, "/arenas?tournament_id="+short(tid), "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("arenas?tournament_id: %d %s", w.Code, w.Body.String())
	}

	// Audit: a tournament-start document with the plan, seed, participants.
	page := listAudit(t, router, "?entity_type=tournament&entity_id="+short(tid))
	if len(page.Data) == 0 {
		t.Fatalf("no audit rows for the tournament")
	}
	var startDetails struct {
		Plan           json.RawMessage `json:"plan"`
		Seed           int64           `json:"seed"`
		ParticipantIds []string        `json:"participant_ids"`
	}
	found := false
	for _, e := range page.Data {
		if e.Details == nil {
			continue
		}
		if err := json.Unmarshal(e.Details, &startDetails); err == nil && startDetails.Seed != 0 && len(startDetails.ParticipantIds) == 8 {
			found = true
			var planDoc map[string]any
			if err := json.Unmarshal(startDetails.Plan, &planDoc); err != nil || planDoc["elimination"] != "single" {
				t.Fatalf("start details plan: %v %v", err, planDoc["elimination"])
			}
		}
	}
	if !found {
		t.Fatalf("no tournament-start details document found")
	}

	// Cancel from running works and is audited with reason "organizer".
	w = doJSON(t, router, http.MethodPost, "/tournaments/"+short(tid)+"/cancel", admin, "")
	if w.Code != http.StatusOK {
		t.Fatalf("cancel: %d %s", w.Code, w.Body.String())
	}
	var stateDetails struct {
		From   string `json:"from"`
		To     string `json:"to"`
		Reason string `json:"reason"`
	}
	found = false
	for _, e := range listAudit(t, router, "?entity_type=tournament&entity_id="+short(tid)).Data {
		if e.Details == nil {
			continue
		}
		if err := json.Unmarshal(e.Details, &stateDetails); err == nil && stateDetails.Reason == "organizer" && stateDetails.To == "cancelled" {
			found = true
		}
	}
	if !found {
		t.Fatalf("no tournament-state cancelled document")
	}
	_ = players
}
