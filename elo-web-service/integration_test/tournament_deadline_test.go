//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

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
	createBody := fmt.Sprintf(`{"id": %q, "name": "Дедлайнный кубок", "grand_final_deadline": "2099-01-01T00:00:00Z", "games": [{"game_id": %q, "min_players": 4, "max_players": 4}], "participant_ids": [%s]}`,
		short(tid), short(gameID), strings.Join(ids, ","))
	if w := doJSON(t, router, http.MethodPost, "/tenants/00000000-0000-0000-0000-000000000101/tournaments", admin, createBody); w.Code != http.StatusOK {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}

	// Backdate the deadline, then start: a past deadline is rejected.
	if _, err := pool.Exec(context.Background(),
		`UPDATE tournaments SET grand_final_deadline = NOW() - INTERVAL '1 hour' WHERE id = $1`, tid); err != nil {
		t.Fatalf("backdate deadline: %v", err)
	}
	if w := doJSON(t, router, http.MethodPost, "/tournaments/"+short(tid)+"/start", admin, `{"plan":{"elimination":"single","rounds":[
		{"track":"final","index":1,"advance":1,"slots":[
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
		{"track":"final","index":1,"advance":1,"slots":[
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
	if w := doJSON(t, router, http.MethodPost, "/tenants/"+blueMenTenantUUID+"/matches", admin, body); w.Code != http.StatusOK {
		t.Fatalf("post match: %d %s", w.Code, w.Body.String())
	}
	w := doJSON(t, router, http.MethodGet, "/matches/"+mid+"?tenant="+blueMenTenantUUID, "", "")
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
