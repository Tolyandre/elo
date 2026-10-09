//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

func TestTournament_ArenaMembershipFunction(t *testing.T) {
	ctx := context.Background()

	pool, cleanup := setupTestDB(t)
	defer cleanup()

	gameID := createTestGame(t, pool, "Миггра игра")

	// A tournament arena: non-camp, no filter, anchor set; one linked match.
	matchID := newID(t)
	if _, err := pool.Exec(ctx,
		`INSERT INTO matches (id, date, game_id) VALUES ($1, NOW(), $2)`, matchID, gameID); err != nil {
		t.Fatalf("insert probe match: %v", err)
	}
	tournID := idpkg.New()
	if _, err := pool.Exec(ctx,
		`INSERT INTO tournaments (id, tenant_id, name, status, elimination) VALUES ($1, '00000000-0000-0000-0000-000000000101', 'Миграционный турнир', 'running', 'single')`,
		tournID); err != nil {
		t.Fatalf("insert probe tournament: %v", err)
	}
	tournArenaID := idpkg.NewMonotonic()
	if _, err := pool.Exec(ctx,
		`INSERT INTO arenas (id, name, settings, settings_schema_version, tournament_id, camp)
		 VALUES ($1, 'Миграционная арена', '{"starting_rating":900,"catch_up":{"earned_min":2,"earned_max":64,"tau":100},"leagues":[]}', 2, $2, false)`,
		tournArenaID, tournID); err != nil {
		t.Fatalf("insert probe arena: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO arena_matches (arena_id, match_id) VALUES ($1, $2)`, tournArenaID, matchID); err != nil {
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
				'competitive',
				true,
				EXISTS (SELECT 1 FROM arena_matches am WHERE am.arena_id = $1 AND am.match_id = $2),
				false, NOW(), $3, NULL, NULL, NULL, NULL)`,
			args: []any{tournArenaID, matchID, gameID},
			want: true,
		},
		{
			what: "coop match belongs to no arena, even when linked (ADR-33)",
			query: `SELECT arena_contains_match(
				'coop',
				true,
				true,
				false, NOW(), $1, NULL, NULL, NULL, NULL)`,
			args: []any{gameID},
			want: false,
		},
		{
			what: "tournament arena ignores the filter (NULL filter matches nothing)",
			query: `SELECT arena_contains_match(
				'competitive',
				true,
				false,
				false, NOW(), $1, NULL, NULL, NULL, NULL)`,
			args: []any{gameID},
			want: false,
		},
		{
			what: "camp arena still link-only",
			query: `SELECT arena_contains_match(
				'competitive',
				true,
				true,
				false, NOW(), $1, NULL, NULL, NULL, NULL)`,
			args: []any{gameID},
			want: true,
		},
		{
			what: "filter arena with an empty filter contains every match",
			query: `SELECT arena_contains_match(
				'competitive',
				false,
				false,
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
		idpkg.NewMonotonic(), tournID); err != nil {
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
		Elimination        *string `json:"elimination"`
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

type bracketPlanDoc struct {
	Elimination string `json:"elimination"`
	Rounds      []struct {
		Track   string `json:"track"`
		Index   int    `json:"index"`
		Advance int    `json:"advance"`
		Slots   []struct {
			SeatCount int `json:"seat_count"`
			Seats     []struct {
				Kind        string `json:"kind"`
				SourceSlot  *int   `json:"source_slot"`
				SourcePlace int    `json:"source_place"`
			} `json:"seats"`
		} `json:"slots"`
	} `json:"rounds"`
}

// planHasRematch reports whether some slot seats two places of one
// previous-round slot — an immediate rematch of tablemates.
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
		"id": %q, "name": "Осенний блиц",
		"grand_final_deadline": "2099-01-01T00:00:00Z",
		"games": [{"game_id": %q, "min_players": 2, "max_players": 4}],
		"participant_ids": [%q, %q]
	}`, short(tid), short(gameID), short(p1), short(p2))

	w := doJSON(t, router, http.MethodPost, "/tenants/00000000-0000-0000-0000-000000000101/tournaments", admin, createBody)
	if w.Code != http.StatusOK {
		t.Fatalf("create tournament: %d %s", w.Code, w.Body.String())
	}
	var created tournamentJSON
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	// The elimination family is decided with the plan at start, not here.
	if created.Data.Status != "registration" || created.Data.Elimination != nil {
		t.Fatalf("created state: %+v", created.Data)
	}
	if created.Data.GrandFinalDeadline == nil {
		t.Fatalf("deadline must round-trip")
	}
	if len(created.Data.ParticipantIds) != 2 {
		t.Fatalf("participants: %v", created.Data.ParticipantIds)
	}

	// Id replay returns the same row.
	w = doJSON(t, router, http.MethodPost, "/tenants/00000000-0000-0000-0000-000000000101/tournaments", admin, createBody)
	if w.Code != http.StatusOK {
		t.Fatalf("id replay: %d %s", w.Code, w.Body.String())
	}

	// PUT: rename, rewrite the pool, extend the participant set.
	updateBody := fmt.Sprintf(`{
		"name": "Осенний блиц 2026",
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
	createBody := fmt.Sprintf(`{"id": %q, "name": "Открытый кубок", "games": [{"game_id": %q, "min_players": 2, "max_players": 4}]}`,
		short(tid), short(gameID))
	if w := doJSON(t, router, http.MethodPost, "/tenants/00000000-0000-0000-0000-000000000101/tournaments", admin, createBody); w.Code != http.StatusOK {
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
