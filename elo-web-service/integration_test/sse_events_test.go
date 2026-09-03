//go:build integration

package integration_test

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/elo"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

// openSSE starts a streaming GET against the router and returns a channel of
// SSE data-frame payloads ("data: ..." lines, payload only). The stream is
// torn down via the returned func / t.Cleanup.
func openSSE(t *testing.T, router *gin.Engine, path, token string) <-chan string {
	t.Helper()

	server := httptest.NewServer(router)
	t.Cleanup(server.Close)

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+path, nil)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := server.Client().Do(req)
	if err != nil {
		t.Fatalf("open SSE stream: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		t.Fatalf("GET %s: %d", path, resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "text/event-stream" {
		resp.Body.Close()
		t.Fatalf("Content-Type = %q, want text/event-stream", ct)
	}
	t.Cleanup(func() { resp.Body.Close() })

	frames := make(chan string, 16)
	go func() {
		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "data: ") {
				frames <- strings.TrimPrefix(line, "data: ")
			}
		}
		close(frames)
	}()
	return frames
}

// nextSSEFrame waits for the next data frame (or hub message) with a timeout.
func nextSSEFrame(t *testing.T, frames <-chan []byte, what string) string {
	t.Helper()
	select {
	case frame, ok := <-frames:
		if !ok {
			t.Fatalf("stream closed while waiting for %s", what)
		}
		return string(frame)
	case <-time.After(10 * time.Second):
		t.Fatalf("timeout waiting for frame %s", what)
		return ""
	}
}

// wait_for helper: collect frames until predicate passes or timeout.
func waitForSSEFrame(t *testing.T, frames <-chan string, what string, match func(payload string) bool) string {
	t.Helper()
	deadline := time.After(10 * time.Second)
	for {
		select {
		case frame, ok := <-frames:
			if !ok {
				t.Fatalf("SSE stream closed while waiting for %s", what)
			}
			if match(frame) {
				return frame
			}
		case <-deadline:
			t.Fatalf("timeout waiting for SSE frame %s", what)
		}
	}
}

func isSignal(payload, eventType string) bool {
	var evt struct {
		Type string `json:"type"`
	}
	return json.Unmarshal([]byte(payload), &evt) == nil && evt.Type == eventType
}

// TestSSE_DataEvents_MatchAdded: adding a match through the HTTP handler must
// broadcast matches-changed + players-changed on the global data stream so
// every connected client refreshes (ADR-13).
func TestSSE_DataEvents_MatchAdded(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	token, _ := createTestUserWithID(t, pool, true)
	router := setupRouter(pool)

	playerA := createTestPlayer(t, pool, "SsePlayerA")
	playerB := createTestPlayer(t, pool, "SsePlayerB")
	gameID := createTestGame(t, pool, "SseGame")

	frames := openSSE(t, router, "/data/events", token)

	// POST a match through the same router; the handler broadcasts after commit.
	body, _ := json.Marshal(map[string]any{
		"id":      newID(t),
		"game_id": gameID,
		"score":   map[string]float64{string(playerA): 5, string(playerB): 3},
	})
	req, _ := http.NewRequest(http.MethodPost, "/matches", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("POST /matches: %d: %s", w.Code, w.Body.String())
	}

	waitForSSEFrame(t, frames, "matches-changed", func(p string) bool { return isSignal(p, "matches-changed") })
	waitForSSEFrame(t, frames, "players-changed", func(p string) bool { return isSignal(p, "players-changed") })
}

// TestSSE_MeEvents_MatchRecorded: when an editor adds a match, the users
// controlling the match players (except the actor) get a match-recorded event
// on their personal stream.
func TestSSE_MeEvents_MatchRecorded(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	editorToken, _ := createTestUserWithID(t, pool, true)
	// A second, non-editing user controls playerB.
	playerToken, playerUserID := createTestUserWithID(t, pool, false)
	router := setupRouter(pool)
	q := db.New(pool)

	playerA := createTestPlayer(t, pool, "NotifyA")
	playerB := createTestPlayer(t, pool, "NotifyB")
	gameID := createTestGame(t, pool, "NotifyGame")
	if err := q.UpdateUserPlayerID(context.Background(), db.UpdateUserPlayerIDParams{
		ID:       idpkg.ID(playerUserID),
		PlayerID: &playerB,
	}); err != nil {
		t.Fatalf("link player: %v", err)
	}

	frames := openSSE(t, router, "/me/events", playerToken)

	body, _ := json.Marshal(map[string]any{
		"id":      newID(t),
		"game_id": gameID,
		"score":   map[string]float64{string(playerA): 5, string(playerB): 3},
	})
	req, _ := http.NewRequest(http.MethodPost, "/matches", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+editorToken)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("POST /matches: %d: %s", w.Code, w.Body.String())
	}

	frame := waitForSSEFrame(t, frames, "match-recorded", func(p string) bool { return isSignal(p, "match-recorded") })
	var evt struct {
		Type string `json:"type"`
		Data struct {
			MatchID   string `json:"match_id"`
			ActorName string `json:"actor_name"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(frame), &evt); err != nil {
		t.Fatalf("parse match-recorded frame: %v", err)
	}
	if _, err := idpkg.ParseTolerant(evt.Data.MatchID); err != nil {
		t.Errorf("match_id %q is not a valid wire-form id: %v", evt.Data.MatchID, err)
	}
}

// TestSkullKing_CreateTableInvitesLinkedUsers: creating a table with picked
// players sends a table-invite to the user controlling each picked player
// (except the host) and a tables-changed signal to the lobby.
func TestSkullKing_CreateTableInvitesLinkedUsers(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	q := db.New(pool)
	_, hostUserID := createTestUserWithID(t, pool, true)
	_, guestUserID := createTestUserWithID(t, pool, false)

	hostPlayer := createTestPlayer(t, pool, "SkHost")
	guestPlayer := createTestPlayer(t, pool, "SkGuest")
	guestPID := guestPlayer
	if err := q.UpdateUserPlayerID(context.Background(), db.UpdateUserPlayerIDParams{
		ID:       idpkg.ID(guestUserID),
		PlayerID: &guestPID,
	}); err != nil {
		t.Fatalf("link guest player: %v", err)
	}

	hub := elo.NewHub()
	svc := elo.NewSkullKingTableService(pool, hub)
	guestCh, cancelGuest := hub.Subscribe(elo.UserTopic(idpkg.ID(guestUserID)))
	defer cancelGuest()
	hostCh, cancelHost := hub.Subscribe(elo.UserTopic(idpkg.ID(hostUserID)))
	defer cancelHost()
	lobbyCh, cancelLobby := hub.Subscribe(elo.TopicLobbySkullKing)
	defer cancelLobby()

	state, _ := json.Marshal(map[string]any{
		"phase":              "waiting-for-bids",
		"players":            []map[string]any{{"id": string(hostPlayer), "name": "SkHost"}, {"id": string(guestPlayer), "name": "SkGuest"}},
		"currentRound":       1,
		"currentPlayerIndex": 0,
		"rounds":             [][]any{nil},
	})
	tableID := newID(t)
	if _, err := svc.CreateTable(context.Background(), tableID, idpkg.ID(hostUserID), state); err != nil {
		t.Fatalf("CreateTable: %v", err)
	}

	select {
	case msg := <-guestCh:
		var evt struct {
			Type string `json:"type"`
			Data struct {
				TableID  string `json:"table_id"`
				HostName string `json:"host_name"`
			} `json:"data"`
		}
		if err := json.Unmarshal(msg, &evt); err != nil {
			t.Fatalf("parse invite: %v", err)
		}
		if evt.Type != "table-invite" {
			t.Errorf("type = %q, want table-invite", evt.Type)
		}
		if evt.Data.TableID != string(tableID.Base58()) {
			t.Errorf("table_id = %q, want wire form of %s", evt.Data.TableID, tableID)
		}
		if evt.Data.HostName == "" {
			t.Error("host_name is empty")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no invite received on the guest user topic")
	}

	select {
	case msg := <-hostCh:
		t.Errorf("host must not receive an invite, got %s", msg)
	case <-time.After(100 * time.Millisecond):
	}

	if frame := nextSSEFrame(t, lobbyCh, "tables-changed"); !isSignal(frame, "tables-changed") {
		t.Errorf("lobby frame = %s, want tables-changed", frame)
	}
}

// createSkullKingTableHTTP creates a live table through the API as the given
// host (who must have a linked player) and returns the wire-form table id.
func createSkullKingTableHTTP(t *testing.T, router *gin.Engine, hostToken string, tableID idpkg.ID, gameState map[string]any) string {
	t.Helper()
	wire := string(tableID.Base58())
	body, _ := json.Marshal(map[string]any{"id": wire, "game_state": gameState})
	req, _ := http.NewRequest(http.MethodPost, "/skull-king/tables", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+hostToken)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("POST /skull-king/tables: %d: %s", w.Code, w.Body.String())
	}
	return wire
}

// TestSkullKing_TableEvents_HostEditPropagatesToSubscribers: when the host
// PATCHes the table state — e.g. editing a cell in an already-completed round —
// every table subscriber must receive the updated full snapshot (regression
// for connected players freezing on host edits of previous rounds).
func TestSkullKing_TableEvents_HostEditPropagatesToSubscribers(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	q := db.New(pool)
	hostToken, hostUserID := createTestUserWithID(t, pool, true)
	router := setupRouter(pool)

	playerA := createTestPlayer(t, pool, "SkEditA")
	playerB := createTestPlayer(t, pool, "SkEditB")
	if err := q.UpdateUserPlayerID(context.Background(), db.UpdateUserPlayerIDParams{
		ID:       idpkg.ID(hostUserID),
		PlayerID: &playerA,
	}); err != nil {
		t.Fatalf("link host player: %v", err)
	}

	initialState := map[string]any{
		"phase":              "round-complete",
		"players":            []map[string]any{{"id": string(playerA), "name": "SkEditA"}, {"id": string(playerB), "name": "SkEditB"}},
		"currentRound":       1,
		"currentPlayerIndex": 0,
		"rounds":             []any{[]any{map[string]any{"bid": 3, "actual": 2, "bonus": 0}, nil}},
	}
	wire := createSkullKingTableHTTP(t, router, hostToken, newID(t), initialState)

	frames := openSSE(t, router, "/skull-king/tables/"+wire+"/events", "")
	// Consume the connect snapshot, then edit player B's cell in round 1.
	waitForSSEFrame(t, frames, "initial state", func(p string) bool { return isSignal(p, "state") })

	editedState := map[string]any{
		"phase":              "round-complete",
		"players":            initialState["players"],
		"currentRound":       1,
		"currentPlayerIndex": 0,
		"rounds":             []any{[]any{map[string]any{"bid": 3, "actual": 2, "bonus": 0}, map[string]any{"bid": 1, "actual": 1, "bonus": 30}}},
	}
	body, _ := json.Marshal(map[string]any{"game_state": editedState})
	req, _ := http.NewRequest(http.MethodPatch, "/skull-king/tables/"+wire+"/state", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+hostToken)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("PATCH state: %d: %s", w.Code, w.Body.String())
	}

	frame := waitForSSEFrame(t, frames, "edited state", func(p string) bool { return isSignal(p, "state") })
	var evt struct {
		Type string              `json:"type"`
		Data elo.SkullKingTableSummary `json:"data"`
	}
	if err := json.Unmarshal([]byte(frame), &evt); err != nil {
		t.Fatalf("parse state frame: %v", err)
	}
	if len(evt.Data.GameState.Rounds) != 1 || len(evt.Data.GameState.Rounds[0]) != 2 {
		t.Fatalf("rounds shape = %v, want 1 round × 2 entries", evt.Data.GameState.Rounds)
	}
	var edited elo.SkullKingEntry
	if err := json.Unmarshal(evt.Data.GameState.Rounds[0][1], &edited); err != nil {
		t.Fatalf("parse edited entry: %v", err)
	}
	if edited.Bid != 1 || edited.Actual == nil || *edited.Actual != 1 || edited.Bonus != 30 {
		t.Errorf("edited entry = %+v, want bid=1 actual=1 bonus=30", edited)
	}
}

// TestSkullKing_TableEvents_ClosedOnHostReset: deleting a table without a
// saved match (host pressed "new game") must broadcast a payload-less "closed"
// event so connected players exit gracefully instead of hitting a 404 later.
func TestSkullKing_TableEvents_ClosedOnHostReset(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	q := db.New(pool)
	hostToken, hostUserID := createTestUserWithID(t, pool, true)
	router := setupRouter(pool)

	playerA := createTestPlayer(t, pool, "SkCloseA")
	playerB := createTestPlayer(t, pool, "SkCloseB")
	if err := q.UpdateUserPlayerID(context.Background(), db.UpdateUserPlayerIDParams{
		ID:       idpkg.ID(hostUserID),
		PlayerID: &playerA,
	}); err != nil {
		t.Fatalf("link host player: %v", err)
	}

	state := map[string]any{
		"phase":              "waiting-for-bids",
		"players":            []map[string]any{{"id": string(playerA), "name": "SkCloseA"}, {"id": string(playerB), "name": "SkCloseB"}},
		"currentRound":       1,
		"currentPlayerIndex": 0,
		"rounds":             []any{nil},
	}
	wire := createSkullKingTableHTTP(t, router, hostToken, newID(t), state)

	frames := openSSE(t, router, "/skull-king/tables/"+wire+"/events", "")
	waitForSSEFrame(t, frames, "initial state", func(p string) bool { return isSignal(p, "state") })

	req, _ := http.NewRequest(http.MethodDelete, "/skull-king/tables/"+wire, nil)
	req.Header.Set("Authorization", "Bearer "+hostToken)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusNoContent {
		t.Fatalf("DELETE table: %d: %s", w.Code, w.Body.String())
	}

	waitForSSEFrame(t, frames, "closed", func(p string) bool { return isSignal(p, "closed") })
}

// TestSSE_HeartbeatNamedEventAndRetryHint: the stream must advertise a retry
// interval up front and send heartbeats as *named* events — comment frames are
// discarded by EventSource before any handler runs, so a JS liveness watchdog
// can only observe named `event: heartbeat` frames.
func TestSSE_HeartbeatNamedEventAndRetryHint(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	token, _ := createTestUserWithID(t, pool, true)
	router := setupRouter(pool)

	server := httptest.NewServer(router)
	t.Cleanup(server.Close)

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"/data/events", nil)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := server.Client().Do(req)
	if err != nil {
		t.Fatalf("open SSE stream: %v", err)
	}
	t.Cleanup(func() { resp.Body.Close() })

	lines := make(chan string, 16)
	go func() {
		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			lines <- scanner.Text()
		}
		close(lines)
	}()

	// The retry hint is written before any frame.
	select {
	case line := <-lines:
		if line != "retry: 5000" {
			t.Fatalf("first line = %q, want retry: 5000", line)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("no first line received")
	}

	// The 15s heartbeat ticker fires within ~15s of stream open.
	deadline := time.After(20 * time.Second)
	for {
		select {
		case line, ok := <-lines:
			if !ok {
				t.Fatal("stream closed while waiting for heartbeat")
			}
			if line == "event: heartbeat" {
				return
			}
		case <-deadline:
			t.Fatal("no named heartbeat event within 20s")
		}
	}
}
