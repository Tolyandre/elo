//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

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
		TournamentId   string  `json:"tournament_id"`
		Status         string  `json:"status"`
		Elimination    string  `json:"elimination"`
		WinnerPlayerId *string `json:"winner_player_id"`
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

// ---------------------------------------------------------------------------
// Phase 5: acceptance, placement points, completion
// ---------------------------------------------------------------------------

// matchIDsOf returns the linked match ids of one bracket slot from the wire.
func slotAt(t *testing.T, br *bracketJSON, roundIdx int, pos int) *struct {
	Id       string
	GameId   string
	Position int
	Promote  int
	Status   string
	Seats    []struct {
		Position     int     `json:"position"`
		PlayerId     *string `json:"player_id"`
		SourceSlotId *string `json:"source_slot_id"`
		SourcePlace  *int    `json:"source_place"`
	}
	Matches []struct {
		MatchId string `json:"match_id"`
	} `json:"matches"`
	Standings []struct {
		PlayerId string `json:"player_id"`
		Points   int    `json:"points"`
		Place    int    `json:"place"`
		Promoted bool   `json:"promoted"`
	} `json:"standings"`
} {
	t.Helper()
	slot := br.Data.Rounds[roundIdx].Slots[pos]
	return &struct {
		Id       string
		GameId   string
		Position int
		Promote  int
		Status   string
		Seats    []struct {
			Position     int     `json:"position"`
			PlayerId     *string `json:"player_id"`
			SourceSlotId *string `json:"source_slot_id"`
			SourcePlace  *int    `json:"source_place"`
		}
		Matches []struct {
			MatchId string `json:"match_id"`
		} `json:"matches"`
		Standings []struct {
			PlayerId string `json:"player_id"`
			Points   int    `json:"points"`
			Place    int    `json:"place"`
			Promoted bool   `json:"promoted"`
		} `json:"standings"`
	}{
		Id: slot.Id, GameId: slot.GameId, Position: slot.Position, Promote: slot.Promote,
		Status: slot.Status, Seats: slot.Seats, Matches: slot.Matches, Standings: slot.Standings,
	}
}

// seatPlayer returns the drawn player of a round-1 seat position (base58).
func seatPlayer(t *testing.T, br *bracketJSON, roundIdx, pos, seatPos int) string {
	t.Helper()
	p := br.Data.Rounds[roundIdx].Slots[pos].Seats[seatPos].PlayerId
	if p == nil {
		t.Fatalf("round %d slot %d seat %d has no drawn player", roundIdx, pos, seatPos)
	}
	return *p
}

func getBracket(t *testing.T, router interface {
	ServeHTTP(http.ResponseWriter, *http.Request)
}, tid string) *bracketJSON {
	t.Helper()
	w := doJSON(t, router, http.MethodGet, "/tournaments/"+tid+"/bracket", "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("bracket: %d %s", w.Code, w.Body.String())
	}
	var br bracketJSON
	if err := json.Unmarshal(w.Body.Bytes(), &br); err != nil {
		t.Fatalf("decode bracket: %v", err)
	}
	return &br
}

const flagshipPlanBody = `{"plan":{"elimination":"single","rounds":[
	{"track":"winners","index":1,"promote":2,"slots":[
		{"seat_count":4,"seats":[{"kind":"draw"},{"kind":"draw"},{"kind":"draw"},{"kind":"draw"}]},
		{"seat_count":4,"seats":[{"kind":"draw"},{"kind":"draw"},{"kind":"draw"},{"kind":"draw"}]}]},
	{"track":"final","index":1,"promote":1,"slots":[
		{"seat_count":4,"seats":[{"kind":"source","source_slot":0,"source_place":1},{"kind":"source","source_slot":0,"source_place":2},{"kind":"source","source_slot":1,"source_place":1},{"kind":"source","source_slot":1,"source_place":2}]}]}]}}`

// TestTournament_SingleElimEndToEnd is the ADR-26 rollout's flagship: an
// 8-player single-elimination on a 4-seat-only pool (4+4 promote-2 → final 4
// promote-1) including a slot that needed a replay (shared top game score in
// the first match → no strict cut → the same table plays again).
func TestTournament_SingleElimEndToEnd(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	router := setupRouter(pool)

	admin, _ := createTestUserWithID(t, pool, true)
	gameID := createTestGame(t, pool, "Флажная игра")

	tid := newID(t)
	var ids []string
	players := make([]idpkg.ID, 0, 8)
	for i := 0; i < 8; i++ {
		p := createTestPlayer(t, pool, fmt.Sprintf("Финалист%d", i))
		players = append(players, p)
		ids = append(ids, fmt.Sprintf("%q", short(p)))
	}
	createBody := fmt.Sprintf(`{"id": %q, "name": "Кубок флажков", "elimination": "single", "games": [{"game_id": %q, "min_players": 4, "max_players": 4}], "participant_ids": [%s]}`,
		short(tid), short(gameID), strings.Join(ids, ","))
	if w := doJSON(t, router, http.MethodPost, "/tournaments", admin, createBody); w.Code != http.StatusOK {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	if w := doJSON(t, router, http.MethodPost, "/tournaments/"+short(tid)+"/start", admin, flagshipPlanBody); w.Code != http.StatusOK {
		t.Fatalf("start: %d %s", w.Code, w.Body.String())
	}

	br := getBracket(t, router, short(tid))
	if len(br.Data.Rounds) != 2 {
		t.Fatalf("rounds: %d", len(br.Data.Rounds))
	}

	// Table A (round 1, position 1) — first match ends with a shared top
	// score: 4–4–0–−2, no strict cut, the slot replays.
	aSeat := func(i int) string { return seatPlayer(t, br, 0, 0, i) }
	newMatch := func(mdate string, scores ...string) string {
		mid := newID(t)
		body := fmt.Sprintf(`{"id": %q, "game_id": %q, "date": %q, "score": {%s}}`,
			short(mid), short(gameID), mdate, strings.Join(scores, ","))
		if w := doJSON(t, router, http.MethodPost, "/matches", admin, body); w.Code != http.StatusOK {
			t.Fatalf("post match: %d %s", w.Code, w.Body.String())
		}
		return short(mid)
	}
	sc := func(pid string, v float64) string { return fmt.Sprintf(`%q:%v`, pid, v) }
	day := "2026-09-01T10:0%d:00Z"

	// Match 1: shared top → the slot must stay playing with no promotions.
	m1 := newMatch(fmt.Sprintf(day, 0), sc(aSeat(0), 10), sc(aSeat(1), 10), sc(aSeat(2), 1), sc(aSeat(3), 0))
	br = getBracket(t, router, short(tid))
	slotA := slotAt(t, br, 0, 0)
	if slotA.Status != "playing" {
		t.Fatalf("slot A must still be playing after a tied match: %s", slotA.Status)
	}
	if len(slotA.Matches) != 1 || slotA.Matches[0].MatchId != m1 {
		t.Fatalf("slot A matches: %+v", slotA.Matches)
	}
	// Live standings show the 4-4-0-(-2) points while the slot replays; the
	// promoted flags stay off and the final seat stays unfilled.
	if len(slotA.Standings) != 4 || slotA.Standings[0].Points != 4 || slotA.Standings[1].Points != 4 ||
		slotA.Standings[0].Promoted || slotA.Standings[1].Promoted ||
		br.Data.Rounds[1].Slots[0].Seats[0].PlayerId != nil {
		t.Fatalf("tied match: live standings but no promotion: %+v", slotA.Standings)
	}

	// The match DTO carries the tournament badge.
	w := doJSON(t, router, http.MethodGet, "/matches/"+m1, "", "")
	var matchResp struct {
		Data struct {
			Tournament *struct {
				Id     string `json:"id"`
				Name   string `json:"name"`
				SlotId string `json:"slot_id"`
			} `json:"tournament"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &matchResp); err != nil {
		t.Fatalf("decode match: %v", err)
	}
	if matchResp.Data.Tournament == nil || matchResp.Data.Tournament.Id != short(tid) || matchResp.Data.Tournament.SlotId != slotA.Id {
		t.Fatalf("match badge: %+v", matchResp.Data.Tournament)
	}

	// Match 2 (the replay): 2–4–0–−2 → cumulative 6–8–0–−4 → strict top-2.
	newMatch(fmt.Sprintf(day, 1), sc(aSeat(0), 5), sc(aSeat(1), 10), sc(aSeat(2), 1), sc(aSeat(3), 0))
	br = getBracket(t, router, short(tid))
	slotA = slotAt(t, br, 0, 0)
	if slotA.Status != "completed" || len(slotA.Matches) != 2 {
		t.Fatalf("slot A after the replay: %s with %d matches", slotA.Status, len(slotA.Matches))
	}
	// Standings: 8–6–0–−4, promoted {seat1, seat0}.
	if len(slotA.Standings) != 4 || slotA.Standings[0].PlayerId != aSeat(1) || slotA.Standings[1].PlayerId != aSeat(0) ||
		!slotA.Standings[0].Promoted || !slotA.Standings[1].Promoted || slotA.Standings[0].Points != 8 || slotA.Standings[1].Points != 6 {
		t.Fatalf("slot A standings: %+v", slotA.Standings)
	}

	// Table B: a decisive first match completes the slot immediately.
	bSeat := func(i int) string { return seatPlayer(t, br, 0, 1, i) }
	newMatch(fmt.Sprintf(day, 2), sc(bSeat(0), 10), sc(bSeat(1), 2), sc(bSeat(2), 1), sc(bSeat(3), 0))
	br = getBracket(t, router, short(tid))
	slotB := slotAt(t, br, 0, 1)
	if slotB.Status != "completed" {
		t.Fatalf("slot B must complete on a strict cut: %s", slotB.Status)
	}

	// The final's seat caches are refilled with the promoted players.
	finalSeats := br.Data.Rounds[1].Slots[0].Seats
	gotFinal := map[string]bool{}
	for _, seat := range finalSeats {
		if seat.PlayerId == nil {
			t.Fatalf("final seat not refilled: %+v", seat)
		}
		gotFinal[*seat.PlayerId] = true
	}
	if len(gotFinal) != 4 || !gotFinal[aSeat(1)] || !gotFinal[aSeat(0)] || !gotFinal[bSeat(0)] || !gotFinal[bSeat(1)] {
		t.Fatalf("final participants: %v", gotFinal)
	}

	// The grand final: one match with a strict cut crowns the champion.
	finalDate := "2026-09-02T10:00:00Z"
	newMatch(finalDate, sc(aSeat(1), 10), sc(bSeat(0), 6), sc(aSeat(0), 2), sc(bSeat(1), 0))
	br = getBracket(t, router, short(tid))
	if br.Data.Status != "completed" {
		t.Fatalf("tournament must be completed, got %s", br.Data.Status)
	}
	if br.Data.WinnerPlayerId == nil || *br.Data.WinnerPlayerId != aSeat(1) {
		t.Fatalf("winner: %v", br.Data.WinnerPlayerId)
	}

	// The tournament arena counts the matches (rating and medals for free).
	var arenaID idpkg.ID
	if err := pool.QueryRow(context.Background(),
		`SELECT id FROM arenas WHERE tournament_id = $1`, tid).Scan(&arenaID); err != nil {
		t.Fatalf("arena lookup: %v", err)
	}
	w = doJSON(t, router, http.MethodGet, "/arenas/"+short(arenaID)+"/players", "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("arena players: %d %s", w.Code, w.Body.String())
	}
	var arenaPlayers struct {
		Data []struct {
			PlayerId     string `json:"player_id"`
			MatchesCount int    `json:"matches_count"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &arenaPlayers); err != nil {
		t.Fatalf("decode arena players: %v", err)
	}
	if len(arenaPlayers.Data) != 8 {
		t.Fatalf("arena must count all 8 players, got %d", len(arenaPlayers.Data))
	}

	// Audit: six slot-link attaches + the state documents.
	page := listAudit(t, router, "?entity_type=tournament&entity_id="+short(tid))
	attaches, states := 0, 0
	for _, e := range page.Data {
		if e.Details == nil {
			continue
		}
		var d map[string]any
		if err := json.Unmarshal(e.Details, &d); err != nil {
			continue
		}
		if d["op"] == "attach" {
			attaches++
		}
		if d["reason"] == "grand-final" {
			states++
		}
	}
	if attaches != 4 || states != 1 {
		t.Fatalf("audit: %d attaches, %d grand-final states (want 4, 1)", attaches, states)
	}
}

// TestTournament_MatchSkipAndNonFit covers the acceptance opt-outs: the
// explicit skip flag keeps a fitting match out of the bracket, and a
// non-fitting roster never links.
func TestTournament_MatchSkipAndNonFit(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	router := setupRouter(pool)

	admin, _ := createTestUserWithID(t, pool, true)
	gameID := createTestGame(t, pool, "Пропускная игра")

	tid := newID(t)
	var ids []string
	for i := 0; i < 4; i++ {
		p := createTestPlayer(t, pool, fmt.Sprintf("Пропуск%d", i))
		ids = append(ids, fmt.Sprintf("%q", short(p)))
	}
	createBody := fmt.Sprintf(`{"id": %q, "name": "Кубок пропусков", "elimination": "single", "games": [{"game_id": %q, "min_players": 4, "max_players": 4}], "participant_ids": [%s]}`,
		short(tid), short(gameID), strings.Join(ids, ","))
	if w := doJSON(t, router, http.MethodPost, "/tournaments", admin, createBody); w.Code != http.StatusOK {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	smallPlan := `{"plan":{"elimination":"single","rounds":[
		{"track":"final","index":1,"promote":1,"slots":[
			{"seat_count":4,"seats":[{"kind":"draw"},{"kind":"draw"},{"kind":"draw"},{"kind":"draw"}]}]}]}}`
	if w := doJSON(t, router, http.MethodPost, "/tournaments/"+short(tid)+"/start", admin, smallPlan); w.Code != http.StatusOK {
		t.Fatalf("start: %d %s", w.Code, w.Body.String())
	}
	br := getBracket(t, router, short(tid))
	s0 := short(createTestPlayer(t, pool, "n0"))
	p1 := br.Data.Rounds[0].Slots[0].Seats[0].PlayerId
	p2 := br.Data.Rounds[0].Slots[0].Seats[1].PlayerId
	p3 := br.Data.Rounds[0].Slots[0].Seats[2].PlayerId
	p4 := br.Data.Rounds[0].Slots[0].Seats[3].PlayerId
	_ = s0

	// Fitting roster with the skip flag: accepted into the arena but not the
	// bracket.
	scores := fmt.Sprintf(`%q:10, %q:2, %q:1, %q:0`, *p1, *p2, *p3, *p4)
	skippedID := short(newID(t))
	body := fmt.Sprintf(`{"id": %q, "game_id": %q, "score": {%s}, "skip_tournament_link": true}`, skippedID, short(gameID), scores)
	if w := doJSON(t, router, http.MethodPost, "/matches", admin, body); w.Code != http.StatusOK {
		t.Fatalf("post skipped match: %d %s", w.Code, w.Body.String())
	}
	w := doJSON(t, router, http.MethodGet, "/matches/"+skippedID, "", "")
	var mr struct {
		Data struct {
			Tournament *string `json:"tournament"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &mr); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if mr.Data.Tournament != nil {
		t.Fatalf("skipped match must be unlinked: %+v", mr.Data.Tournament)
	}
	br = getBracket(t, router, short(tid))
	if len(br.Data.Rounds[0].Slots[0].Matches) != 0 {
		t.Fatalf("skipped match must not count for the slot")
	}

	// A non-fitting roster (a stranger at the table) never links.
	stranger := createTestPlayer(t, pool, "Посторонний")
	strangerID := short(newID(t))
	body = fmt.Sprintf(`{"id": %q, "game_id": %q, "score": {%q:10, %q:2, %q:1, %q:0}}`,
		strangerID, short(gameID), *p1, *p2, *p3, short(stranger))
	if w := doJSON(t, router, http.MethodPost, "/matches", admin, body); w.Code != http.StatusOK {
		t.Fatalf("post stranger match: %d %s", w.Code, w.Body.String())
	}
	w = doJSON(t, router, http.MethodGet, "/matches/"+strangerID, "", "")
	mr.Data.Tournament = nil
	if err := json.Unmarshal(w.Body.Bytes(), &mr); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if mr.Data.Tournament != nil {
		t.Fatalf("non-fitting match must be unlinked")
	}

	// And the fitting roster without the flag links and completes the slot
	// (strict cut 4–2–0–−2).
	fittingID := short(newID(t))
	body = fmt.Sprintf(`{"id": %q, "game_id": %q, "score": {%s}}`, fittingID, short(gameID), scores)
	if w := doJSON(t, router, http.MethodPost, "/matches", admin, body); w.Code != http.StatusOK {
		t.Fatalf("post fitting match: %d %s", w.Code, w.Body.String())
	}
	br = getBracket(t, router, short(tid))
	slot := br.Data.Rounds[0].Slots[0]
	if slot.Status != "completed" || len(slot.Matches) != 1 || slot.Matches[0].MatchId != fittingID {
		t.Fatalf("fitting match must complete the slot: %+v", slot)
	}
	if br.Data.Status != "completed" || br.Data.WinnerPlayerId == nil || *br.Data.WinnerPlayerId != *p1 {
		t.Fatalf("tournament completed with the highest scorer: %+v", br.Data)
	}
}

// ---------------------------------------------------------------------------
// Phase 6: edit consistency — 409 guards, recompute, cascade void
// ---------------------------------------------------------------------------

// TestTournament_EditCascadeAndGuards drives the ADR-26 edit story: an edit
// that overturns a promoted set reopens the slot, clears the downstream seats
// and voids the already-played final (audited with the origin chain); a
// completed tournament reverts to running; association-breaking edits are
// 409 while score edits stay free.
func TestTournament_EditCascadeAndGuards(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	router := setupRouter(pool)

	admin, _ := createTestUserWithID(t, pool, true)
	gameID := createTestGame(t, pool, "Каскадная игра")

	tid := newID(t)
	var ids []string
	for i := 0; i < 8; i++ {
		p := createTestPlayer(t, pool, fmt.Sprintf("Каскад%d", i))
		ids = append(ids, fmt.Sprintf("%q", short(p)))
	}
	createBody := fmt.Sprintf(`{"id": %q, "name": "Каскадный кубок", "elimination": "single", "games": [{"game_id": %q, "min_players": 4, "max_players": 4}], "participant_ids": [%s]}`,
		short(tid), short(gameID), strings.Join(ids, ","))
	if w := doJSON(t, router, http.MethodPost, "/tournaments", admin, createBody); w.Code != http.StatusOK {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	if w := doJSON(t, router, http.MethodPost, "/tournaments/"+short(tid)+"/start", admin, flagshipPlanBody); w.Code != http.StatusOK {
		t.Fatalf("start: %d %s", w.Code, w.Body.String())
	}
	br := getBracket(t, router, short(tid))
	aSeat := func(i int) string { return seatPlayer(t, br, 0, 0, i) }
	bSeat := func(i int) string { return seatPlayer(t, br, 0, 1, i) }

	newMatch := func(mdate string, scores ...string) string {
		mid := newID(t)
		body := fmt.Sprintf(`{"id": %q, "game_id": %q, "date": %q, "score": {%s}}`,
			short(mid), short(gameID), mdate, strings.Join(scores, ","))
		if w := doJSON(t, router, http.MethodPost, "/matches", admin, body); w.Code != http.StatusOK {
			t.Fatalf("post match: %d %s", w.Code, w.Body.String())
		}
		return short(mid)
	}
	editMatch := func(mid string, scores ...string) int {
		body := fmt.Sprintf(`{"game_id": %q, "date": "2026-09-01T10:00:00Z", "score": {%s}}`,
			short(gameID), strings.Join(scores, ","))
		return doJSON(t, router, http.MethodPut, "/matches/"+mid, admin, body).Code
	}
	sc := func(pid string, v float64) string { return fmt.Sprintf(`%q:%v`, pid, v) }
	day := "2026-09-01T10:0%d:00Z"

	// A: tie, then decisive → completed {seat1, seat0}.
	m1 := newMatch(fmt.Sprintf(day, 0), sc(aSeat(0), 10), sc(aSeat(1), 10), sc(aSeat(2), 1), sc(aSeat(3), 0))
	m2 := newMatch(fmt.Sprintf(day, 1), sc(aSeat(0), 5), sc(aSeat(1), 10), sc(aSeat(2), 1), sc(aSeat(3), 0))
	// B: decisive.
	newMatch(fmt.Sprintf(day, 2), sc(bSeat(0), 10), sc(bSeat(1), 2), sc(bSeat(2), 1), sc(bSeat(3), 0))
	// Final: one strict-cut match → the tournament completes.
	newMatch("2026-09-02T10:00:00Z", sc(aSeat(1), 10), sc(bSeat(0), 6), sc(aSeat(0), 2), sc(bSeat(1), 0))
	br = getBracket(t, router, short(tid))
	if br.Data.Status != "completed" || br.Data.WinnerPlayerId == nil || *br.Data.WinnerPlayerId != aSeat(1) {
		t.Fatalf("pre-cascade completion: %+v", br.Data)
	}

	// The overturning edit: m2's scores become a shared top → the cumulative
	// standings tie inside the promoted set → slot A reopens, the final's
	// already-played match is voided, the champion is unrecorded.
	code := editMatch(m2, sc(aSeat(0), 10), sc(aSeat(1), 10), sc(aSeat(2), 1), sc(aSeat(3), 0))
	if code != http.StatusOK {
		t.Fatalf("overturning edit: %d", code)
	}
	br = getBracket(t, router, short(tid))
	if br.Data.Status != "running" || br.Data.WinnerPlayerId != nil {
		t.Fatalf("completed tournament must revert to running: %+v", br.Data)
	}
	slotA := slotAt(t, br, 0, 0)
	if slotA.Status != "playing" {
		t.Fatalf("slot A must reopen: %s", slotA.Status)
	}
	finalSlot := slotAt(t, br, 1, 0)
	if len(finalSlot.Matches) != 0 || finalSlot.Status != "waiting" {
		t.Fatalf("final must be voided back to waiting: %+v", finalSlot)
	}
	for _, seat := range finalSlot.Seats {
		// Only the seats fed by the reopened slot A must clear; slot B's
		// outcome stands, so its fed seats keep their caches.
		if seat.SourceSlotId != nil && *seat.SourceSlotId == slotA.Id && seat.PlayerId != nil {
			t.Fatalf("final seat cache from reopened slot A must be cleared: %+v", seat)
		}
	}

	// The audit origin chain: the void on the final slot names the triggering
	// match edit; the revert is a cascade state transition.
	page := listAudit(t, router, "?entity_type=tournament&entity_id="+short(tid))
	voidsWithOrigin, cascadeStates := 0, 0
	for _, e := range page.Data {
		if e.Details == nil {
			continue
		}
		var d map[string]any
		if err := json.Unmarshal(e.Details, &d); err != nil {
			continue
		}
		if d["op"] == "void" && d["origin_kind"] == "match-edit" && d["origin_id"] == m2 {
			voidsWithOrigin++
		}
		if d["reason"] == "cascade" && d["from"] == "completed" && d["to"] == "running" {
			cascadeStates++
		}
	}
	if voidsWithOrigin != 1 || cascadeStates != 1 {
		t.Fatalf("audit chain: %d voids with match-edit origin, %d cascade reverts", voidsWithOrigin, cascadeStates)
	}

	// Association guards on a linked match (m1, slot A):
	//   player set change → 409;
	guard := fmt.Sprintf(`{"game_id": %q, "date": "2026-09-01T10:00:00Z", "score": {%q:9, %q:5, %q:1, %q:0}}`,
		short(gameID), aSeat(0), aSeat(1), aSeat(2), short(createTestPlayer(t, pool, "Подменный")))
	if w := doJSON(t, router, http.MethodPut, "/matches/"+m1, admin, guard); w.Code != http.StatusConflict {
		t.Fatalf("player-set change must 409, got %d %s", w.Code, w.Body.String())
	}
	//   game change → 409;
	otherGame := createTestGame(t, pool, "Другая игра")
	guard = fmt.Sprintf(`{"game_id": %q, "date": "2026-09-01T10:00:00Z", "score": {%s}}`,
		short(otherGame), strings.Join([]string{sc(aSeat(0), 9), sc(aSeat(1), 5), sc(aSeat(2), 1), sc(aSeat(3), 0)}, ","))
	if w := doJSON(t, router, http.MethodPut, "/matches/"+m1, admin, guard); w.Code != http.StatusConflict {
		t.Fatalf("game change must 409, got %d", w.Code)
	}
	//   score-only edit → allowed (200).
	code = editMatch(m1, sc(aSeat(0), 9), sc(aSeat(1), 10), sc(aSeat(2), 1), sc(aSeat(3), 0))
	if code != http.StatusOK {
		t.Fatalf("score edit must pass: %d", code)
	}

	// A non-linked match can never become linked by editing: post one with
	// the skip flag, then edit it to an exactly-fitting roster.
	skipBody := fmt.Sprintf(`{"id": %q, "game_id": %q, "date": "2026-09-03T10:00:00Z", "score": {%s}, "skip_tournament_link": true}`,
		short(newID(t)), short(gameID), strings.Join([]string{sc(aSeat(0), 3), sc(aSeat(1), 10), sc(aSeat(2), 1), sc(aSeat(3), 0)}, ","))
	if w := doJSON(t, router, http.MethodPost, "/matches", admin, skipBody); w.Code != http.StatusOK {
		t.Fatalf("post skipped: %d %s", w.Code, w.Body.String())
	}

	// Re-complete: the decisive m2 restores slot A (already re-decided by the
	// score edit above via m1's 9/10 reversal), the final is re-played with a
	// fresh match, and the tournament completes again.
	br = getBracket(t, router, short(tid))
	slotA = slotAt(t, br, 0, 0)
	if slotA.Status != "completed" {
		t.Fatalf("slot A must re-complete after the decisive edits: %s", slotA.Status)
	}
	finalSeats := br.Data.Rounds[1].Slots[0].Seats
	refilled := 0
	for _, seat := range finalSeats {
		if seat.PlayerId != nil {
			refilled++
		}
	}
	if refilled != 4 {
		t.Fatalf("final seats must refill (%d/4)", refilled)
	}
	newMatch("2026-09-04T10:00:00Z", sc(aSeat(1), 10), sc(bSeat(0), 6), sc(aSeat(0), 2), sc(bSeat(1), 0))
	br = getBracket(t, router, short(tid))
	if br.Data.Status != "completed" || br.Data.WinnerPlayerId == nil || *br.Data.WinnerPlayerId != aSeat(1) {
		t.Fatalf("re-completion: %+v", br.Data)
	}
}

// ---------------------------------------------------------------------------
// Phase 7: rulings, attach/detach, WB+LB, deadline
// ---------------------------------------------------------------------------

// TestTournament_RulingAttachDetach covers the organizer corrections: attach
// of a mistakenly-unchecked match, a hand ruling that completes the slot,
// ruling persistence over a detach, and the audit documents.
func TestTournament_RulingAttachDetach(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	router := setupRouter(pool)

	admin, _ := createTestUserWithID(t, pool, true)
	gameID := createTestGame(t, pool, "Судейская игра")

	tid := newID(t)
	var ids []string
	for i := 0; i < 4; i++ {
		p := createTestPlayer(t, pool, fmt.Sprintf("Судья%d", i))
		ids = append(ids, fmt.Sprintf("%q", short(p)))
	}
	createBody := fmt.Sprintf(`{"id": %q, "name": "Кубок судей", "elimination": "single", "games": [{"game_id": %q, "min_players": 4, "max_players": 4}], "participant_ids": [%s]}`,
		short(tid), short(gameID), strings.Join(ids, ","))
	if w := doJSON(t, router, http.MethodPost, "/tournaments", admin, createBody); w.Code != http.StatusOK {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	// One 4-seat grand final: the whole tournament is one table.
	plan := `{"plan":{"elimination":"single","rounds":[
		{"track":"final","index":1,"promote":1,"slots":[
			{"seat_count":4,"seats":[{"kind":"draw"},{"kind":"draw"},{"kind":"draw"},{"kind":"draw"}]}]}]}}`
	if w := doJSON(t, router, http.MethodPost, "/tournaments/"+short(tid)+"/start", admin, plan); w.Code != http.StatusOK {
		t.Fatalf("start: %d %s", w.Code, w.Body.String())
	}
	br := getBracket(t, router, short(tid))
	slot := br.Data.Rounds[0].Slots[0]
	seat := func(i int) string {
		p := slot.Seats[i].PlayerId
		if p == nil {
			t.Fatalf("seat %d not drawn", i)
		}
		return *p
	}

	// The organizer forgot the checkbox: the match was posted skipped.
	mid := short(newID(t))
	// Posted with the skip flag: the organizer forgot the checkbox.
	body := fmt.Sprintf(`{"id": %q, "game_id": %q, "date": "2026-09-05T10:00:00Z", "score": {%q:10, %q:10, %q:1, %q:0}, "skip_tournament_link": true}`,
		mid, short(gameID), seat(0), seat(1), seat(2), seat(3))
	if w := doJSON(t, router, http.MethodPost, "/matches", admin, body); w.Code != http.StatusOK {
		t.Fatalf("post skipped match: %d %s", w.Code, w.Body.String())
	}

	// Attach repairs it; the tie means no strict cut — the slot keeps playing.
	w := doJSON(t, router, http.MethodPost, "/tournaments/"+short(tid)+"/slots/"+slot.Id+"/matches", admin, `{"match_id":`+`"`+mid+`"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("attach: %d %s", w.Code, w.Body.String())
	}
	br = getBracket(t, router, short(tid))
	if len(br.Data.Rounds[0].Slots[0].Matches) != 1 {
		t.Fatalf("attach must link the match")
	}

	// A second attach of the same match is a 409.
	if w := doJSON(t, router, http.MethodPost, "/tournaments/"+short(tid)+"/slots/"+slot.Id+"/matches", admin, `{"match_id":"`+mid+`"}`); w.Code != http.StatusConflict {
		t.Fatalf("double attach must 409, got %d", w.Code)
	}

	// The ruling completes the slot by hand (abandoned table).
	ruling := fmt.Sprintf(`{"player_ids": [%q]}`, seat(1))
	if w := doJSON(t, router, http.MethodPost, "/tournaments/"+short(tid)+"/slots/"+slot.Id+"/ruling", admin, ruling); w.Code != http.StatusOK {
		t.Fatalf("ruling: %d %s", w.Code, w.Body.String())
	}
	br = getBracket(t, router, short(tid))
	if br.Data.Status != "completed" || br.Data.WinnerPlayerId == nil || *br.Data.WinnerPlayerId != seat(1) {
		t.Fatalf("ruling must crown seat 1: %+v", br.Data)
	}

	// Detaching the (tie) match keeps the ruling in force — the slot stays
	// completed through the recompute.
	if w := doJSON(t, router, http.MethodDelete, "/tournaments/"+short(tid)+"/slots/"+slot.Id+"/matches/"+mid, admin, ""); w.Code != http.StatusOK {
		t.Fatalf("detach: %d %s", w.Code, w.Body.String())
	}
	br = getBracket(t, router, short(tid))
	if br.Data.Status != "completed" {
		t.Fatalf("the ruling must stand after the detach: %s", br.Data.Status)
	}

	// Audit: attach (organizer), ruling set, detach.
	page := listAudit(t, router, "?entity_type=tournament&entity_id="+short(tid))
	var attaches, rulings, detaches int
	for _, e := range page.Data {
		if e.Details == nil {
			continue
		}
		var d map[string]any
		if err := json.Unmarshal(e.Details, &d); err != nil {
			continue
		}
		switch {
		case d["op"] == "attach" && d["origin_kind"] == "organizer":
			attaches++
		case d["op"] == "set" && d["after_player_ids"] != nil:
			rulings++
		case d["op"] == "detach":
			detaches++
		}
	}
	if attaches != 1 || rulings != 1 || detaches != 1 {
		t.Fatalf("audit: %d attaches, %d rulings, %d detaches (want 1 each)", attaches, rulings, detaches)
	}
}

// TestTournament_DeadlineAutoCancel verifies the lazy enforcement: a stale
// running status flips to cancelled (system actor, reason "deadline") on the
// next bracket read or match write, and a past deadline blocks start.
func TestTournament_DeadlineAutoCancel(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	router := setupRouter(pool)

	admin, _ := createTestUserWithID(t, pool, true)
	gameID := createTestGame(t, pool, "Дедлайнная игра")

	tid := newID(t)
	var ids []string
	for i := 0; i < 4; i++ {
		p := createTestPlayer(t, pool, fmt.Sprintf("Дедлайн%d", i))
		ids = append(ids, fmt.Sprintf("%q", short(p)))
	}
	createBody := fmt.Sprintf(`{"id": %q, "name": "Дедлайнный кубок", "elimination": "single", "grand_final_deadline": "2099-01-01T00:00:00Z", "games": [{"game_id": %q, "min_players": 4, "max_players": 4}], "participant_ids": [%s]}`,
		short(tid), short(gameID), strings.Join(ids, ","))
	if w := doJSON(t, router, http.MethodPost, "/tournaments", admin, createBody); w.Code != http.StatusOK {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}

	// Backdate the deadline, then start: a past deadline is rejected.
	if _, err := pool.Exec(context.Background(),
		`UPDATE tournaments SET grand_final_deadline = NOW() - INTERVAL '1 hour' WHERE id = $1`, tid); err != nil {
		t.Fatalf("backdate deadline: %v", err)
	}
	if w := doJSON(t, router, http.MethodPost, "/tournaments/"+short(tid)+"/start", admin, `{"plan":{"elimination":"single","rounds":[
		{"track":"final","index":1,"promote":1,"slots":[
			{"seat_count":4,"seats":[{"kind":"draw"},{"kind":"draw"},{"kind":"draw"},{"kind":"draw"}]}]}]}}`); w.Code != http.StatusBadRequest {
		t.Fatalf("start with past deadline must 400, got %d", w.Code)
	}

	// Move the deadline to the future, start, then backdate again: the next
	// bracket read cancels the running tournament with the system actor.
	if _, err := pool.Exec(context.Background(),
		`UPDATE tournaments SET grand_final_deadline = NOW() + INTERVAL '1 hour' WHERE id = $1`, tid); err != nil {
		t.Fatalf("refuture deadline: %v", err)
	}
	if w := doJSON(t, router, http.MethodPost, "/tournaments/"+short(tid)+"/start", admin, `{"plan":{"elimination":"single","rounds":[
		{"track":"final","index":1,"promote":1,"slots":[
			{"seat_count":4,"seats":[{"kind":"draw"},{"kind":"draw"},{"kind":"draw"},{"kind":"draw"}]}]}]}}`); w.Code != http.StatusOK {
		t.Fatalf("start: %d %s", w.Code, w.Body.String())
	}
	if _, err := pool.Exec(context.Background(),
		`UPDATE tournaments SET grand_final_deadline = NOW() - INTERVAL '1 minute' WHERE id = $1`, tid); err != nil {
		t.Fatalf("backdate deadline: %v", err)
	}
	getBracket(t, router, short(tid))

	var status string
	if err := pool.QueryRow(context.Background(),
		`SELECT status FROM tournaments WHERE id = $1`, tid).Scan(&status); err != nil {
		t.Fatalf("status: %v", err)
	}
	if status != "cancelled" {
		t.Fatalf("deadline must cancel the tournament, got %s", status)
	}
	var (
		actorNull bool
		reason    string
	)
	if err := pool.QueryRow(context.Background(),
		`SELECT a.actor_user_id IS NULL, a.details->>'reason' FROM audit_log a
		 WHERE a.entity_type = 'tournament' AND a.entity_id = $1 AND a.details_kind = 'tournament-state'
		 ORDER BY a.created_at DESC LIMIT 1`, tid).Scan(&actorNull, &reason); err != nil {
		t.Fatalf("deadline audit: %v", err)
	}
	if !actorNull || reason != "deadline" {
		t.Fatalf("deadline audit: actor_null=%v reason=%s", actorNull, reason)
	}

	// A cancelled tournament takes no matches: the fit query excludes it.
	p1 := createTestPlayer(t, pool, "Поздний1")
	p2 := createTestPlayer(t, pool, "Поздний2")
	mid := short(newID(t))
	body := fmt.Sprintf(`{"id": %q, "game_id": %q, "score": {%q:10, %q:2}}`, mid, short(gameID), short(p1), short(p2))
	if w := doJSON(t, router, http.MethodPost, "/matches", admin, body); w.Code != http.StatusOK {
		t.Fatalf("post match: %d %s", w.Code, w.Body.String())
	}
	w := doJSON(t, router, http.MethodGet, "/matches/"+mid, "", "")
	var mr struct {
		Data struct {
			Tournament *string `json:"tournament"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &mr); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if mr.Data.Tournament != nil {
		t.Fatalf("a cancelled tournament must not accept matches")
	}
}

// TestTournament_WBLBRunWithMerge plays a double-elimination tournament
// end-to-end: the organizer picks the first offered plan from the plans
// endpoint (a real round-trip of the enumerator's document), and a driver
// plays every playing slot in bracket order until a champion emerges.
func TestTournament_WBLBRunWithMerge(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	router := setupRouter(pool)

	admin, _ := createTestUserWithID(t, pool, true)
	gameID := createTestGame(t, pool, "Парный дедлайн")

	tid := newID(t)
	var ids []string
	for i := 0; i < 8; i++ {
		p := createTestPlayer(t, pool, fmt.Sprintf("Дабл%d", i))
		ids = append(ids, fmt.Sprintf("%q", short(p)))
	}
	createBody := fmt.Sprintf(`{"id": %q, "name": "Дабл-кубок", "elimination": "double", "games": [{"game_id": %q, "min_players": 2, "max_players": 2}], "participant_ids": [%s]}`,
		short(tid), short(gameID), strings.Join(ids, ","))
	if w := doJSON(t, router, http.MethodPost, "/tournaments", admin, createBody); w.Code != http.StatusOK {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}

	// The plans endpoint offers double-elimination shapes; take the head
	// (fewest rounds) and submit it verbatim.
	w := doJSON(t, router, http.MethodGet, "/tournaments/"+short(tid)+"/bracket-plans", admin, "")
	if w.Code != http.StatusOK {
		t.Fatalf("plans: %d %s", w.Code, w.Body.String())
	}
	var plans bracketPlansJSON
	if err := json.Unmarshal(w.Body.Bytes(), &plans); err != nil {
		t.Fatalf("decode plans: %v", err)
	}
	if len(plans.Data.Plans) == 0 {
		t.Fatalf("no plans offered")
	}
	// Take the first plan that actually runs the losers track (the
	// fewest-rounds head may be the valid pause-the-LB-forever variant).
	var chosen map[string]any
	for _, p := range plans.Data.Plans {
		hasLosers := false
		for _, r := range p.Rounds {
			if r.Track == "losers" {
				hasLosers = true
			}
		}
		if hasLosers {
			chosen = mustPlanMap(t, p)
			break
		}
	}
	if chosen == nil {
		t.Fatalf("no plan with a losers track offered")
	}
	planRaw, err := json.Marshal(chosen)
	if err != nil {
		t.Fatalf("encode plan: %v", err)
	}
	if w := doJSON(t, router, http.MethodPost, "/tournaments/"+short(tid)+"/start", admin, `{"plan":`+string(planRaw)+`}`); w.Code != http.StatusOK {
		t.Fatalf("start: %d %s", w.Code, w.Body.String())
	}

	// Driver: play every fully-seated playing slot (distinct scores → strict
	// cut for any promote count), then repeat until the champion emerges.
	gameShort := short(gameID)
	mday := 10
	for round := 0; ; round++ {
		if round > 30 {
			t.Fatalf("the bracket did not finish playing")
		}
		br := getBracket(t, router, short(tid))
		if br.Data.Status == "completed" {
			if br.Data.WinnerPlayerId == nil || *br.Data.WinnerPlayerId == "" {
				t.Fatalf("completed without a champion")
			}
			var hasLosers bool
			for _, r := range br.Data.Rounds {
				if r.Track == "losers" {
					hasLosers = true
				}
			}
			if !hasLosers {
				t.Fatalf("double-elimination bracket without a losers track")
			}
			break
		}
		played := 0
		for _, r := range br.Data.Rounds {
			for _, slot := range r.Slots {
				if slot.Status != "playing" || len(slot.Matches) > 0 {
					continue
				}
				seated := true
				var scores []string
				v := float64(len(slot.Seats)) * 10
				for _, seat := range slot.Seats {
					if seat.PlayerId == nil {
						seated = false
						break
					}
					scores = append(scores, fmt.Sprintf(`%q:%v`, *seat.PlayerId, v))
					v -= 3
				}
				if !seated {
					continue
				}
				mid := short(newID(t))
				// Dates walk backwards from now, staying inside the 30-day
				// window the match-write validation allows.
				mdate := time.Now().UTC().Add(-time.Duration(mday) * 24 * time.Hour).Truncate(time.Second).Format(time.RFC3339)
				body := fmt.Sprintf(`{"id": %q, "game_id": %q, "date": %q, "score": {%s}}`,
					mid, gameShort, mdate, strings.Join(scores, ","))
				if w := doJSON(t, router, http.MethodPost, "/matches", admin, body); w.Code != http.StatusOK {
					t.Fatalf("driver match: %d %s", w.Code, w.Body.String())
				}
				mday++
				if mday > 20 {
					mday = 1
				}
				played++
			}
		}
		if played == 0 {
			t.Fatalf("no playable slot and the tournament is not completed: %+v", br.Data)
		}
	}
}

// mustPlanMap converts a decoded plan object to a generic map for verbatim
// resubmission.
func mustPlanMap(t *testing.T, p any) map[string]any {
	t.Helper()
	raw, err := json.Marshal(p)
	if err != nil {
		t.Fatalf("re-encode plan: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("decode plan: %v", err)
	}
	return m
}
