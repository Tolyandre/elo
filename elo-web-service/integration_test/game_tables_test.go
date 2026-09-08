//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/elo"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

// linkPlayer binds the user's player_id (playerAuth requires it for hosts and
// submitters alike).
func linkPlayer(t *testing.T, q *db.Queries, userID string, playerID idpkg.ID) {
	t.Helper()
	pid := playerID
	if err := q.UpdateUserPlayerID(context.Background(), db.UpdateUserPlayerIDParams{
		ID:       idpkg.ID(userID),
		PlayerID: &pid,
	}); err != nil {
		t.Fatalf("link player: %v", err)
	}
}

// iawwTableState builds a valid initial IAWW table state for the given players.
func iawwTableState(playerA, playerB idpkg.ID, nameA, nameB string) map[string]any {
	return map[string]any{
		"phase": "scoring",
		"players": []map[string]any{
			{"id": string(playerA), "name": nameA},
			{"id": string(playerB), "name": nameB},
		},
		"entries": []map[string]any{
			{"playerId": string(playerA), "directVp": nil, "cells": []any{}, "done": false},
			{"playerId": string(playerB), "directVp": nil, "cells": []any{}, "done": false},
		},
	}
}

// submitTableHTTP posts a player submission and returns the status code.
func submitTableHTTP(t *testing.T, router *gin.Engine, token, tableWire string, payload map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest(http.MethodPost, "/tables/"+tableWire+"/submit", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

// patchTableStateHTTP replaces the table state (host) with the given version.
func patchTableStateHTTP(t *testing.T, router *gin.Engine, token, tableWire string, version int64, state map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"version": version, "game_state": state})
	req, _ := http.NewRequest(http.MethodPatch, "/tables/"+tableWire+"/state", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

// parseIawwEntries extracts the entries array from a TableSummary JSON body.
func parseIawwEntries(t *testing.T, body []byte) []struct {
	PlayerID string `json:"playerId"`
	DirectVp *int   `json:"directVp"`
	Done     bool   `json:"done"`
	Cells    []struct {
		Row   string `json:"row"`
		Coeff int    `json:"coeff"`
		Count int    `json:"count"`
	} `json:"cells"`
} {
	t.Helper()
	var resp struct {
		Data struct {
			GameState struct {
				Entries []struct {
					PlayerID string `json:"playerId"`
					DirectVp *int   `json:"directVp"`
					Done     bool   `json:"done"`
					Cells    []struct {
						Row   string `json:"row"`
						Coeff int    `json:"coeff"`
						Count int    `json:"count"`
					} `json:"cells"`
				} `json:"entries"`
			} `json:"game_state"`
			Version int64 `json:"version"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		t.Fatalf("parse response: %v (%s)", err, body)
	}
	return resp.Data.GameState.Entries
}

// TestGameTables_IawwLifecycle: a connected player joins an IAWW table,
// submits their scoring once, cannot resubmit, and the host can still correct
// the entry afterwards.
func TestGameTables_IawwLifecycle(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	q := db.New(pool)
	hostToken, hostUserID := createTestUserWithID(t, pool, true)
	guestToken, guestUserID := createTestUserWithID(t, pool, true)
	router := setupRouter(pool)

	playerA := createTestPlayer(t, pool, "IawwHost")
	linkPlayer(t, q, hostUserID, playerA)
	playerB := createTestPlayer(t, pool, "IawwGuest")
	playerBID := playerB
	if err := q.UpdateUserPlayerID(context.Background(), db.UpdateUserPlayerIDParams{
		ID:       idpkg.ID(guestUserID),
		PlayerID: &playerBID,
	}); err != nil {
		t.Fatalf("link guest player: %v", err)
	}

	wire := createTableHTTP(t, router, hostToken, newID(t), elo.GameIDIAWW, iawwTableState(playerA, playerB, "IawwHost", "IawwGuest"))

	// Guest joins the table.
	req, _ := http.NewRequest(http.MethodPost, "/tables/"+wire+"/join", nil)
	req.Header.Set("Authorization", "Bearer "+guestToken)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("join: %d: %s", w.Code, w.Body.String())
	}

	// Valid submission: direct VP + one single row + one pair row.
	valid := map[string]any{
		"directVp": 12,
		"cells": []map[string]any{
			{"row": "structure", "coeff": 3, "count": 2},
			{"row": "str-res", "coeff": 6, "count": 1},
		},
	}
	submitResp := submitTableHTTP(t, router, guestToken, wire, valid)
	if submitResp.Code != http.StatusOK {
		t.Fatalf("submit: %d: %s", submitResp.Code, submitResp.Body.String())
	}
	entries := parseIawwEntries(t, submitResp.Body.Bytes())
	if len(entries) != 2 {
		t.Fatalf("entries = %d, want 2", len(entries))
	}
	guest := entries[1]
	if !guest.Done || guest.DirectVp == nil || *guest.DirectVp != 12 {
		t.Errorf("guest entry = %+v, want done with directVp=12", guest)
	}
	if len(guest.Cells) != 2 || guest.Cells[1].Row != "str-res" || guest.Cells[1].Coeff != 6 {
		t.Errorf("guest cells = %+v", guest.Cells)
	}

	// Second submission is rejected: a player cannot change posted data.
	if w := submitTableHTTP(t, router, guestToken, wire, valid); w.Code != http.StatusConflict {
		t.Errorf("resubmit: %d, want 409 (%s)", w.Code, w.Body.String())
	}

	// The host corrects the guest's typo via a state patch.
	state := iawwTableState(playerA, playerB, "IawwHost", "IawwGuest")
	state["entries"].([]map[string]any)[1]["done"] = true
	state["entries"].([]map[string]any)[1]["directVp"] = 13
	patchResp := patchTableStateHTTP(t, router, hostToken, wire, 2, state)
	if patchResp.Code != http.StatusOK {
		t.Fatalf("host patch after submit: %d: %s", patchResp.Code, patchResp.Body.String())
	}
	entries = parseIawwEntries(t, patchResp.Body.Bytes())
	if entries[1].DirectVp == nil || *entries[1].DirectVp != 13 {
		t.Errorf("host edit not applied: %+v", entries[1])
	}
}

// TestGameTables_IawwSubmitValidation: player input is validated against the
// known scoring rows before it is merged.
func TestGameTables_IawwSubmitValidation(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	q := db.New(pool)
	hostToken, hostUserID := createTestUserWithID(t, pool, true)
	guestToken, guestUserID := createTestUserWithID(t, pool, true)
	router := setupRouter(pool)

	playerA := createTestPlayer(t, pool, "IawwValHost")
	linkPlayer(t, q, hostUserID, playerA)
	playerB := createTestPlayer(t, pool, "IawwValGuest")
	playerBID := playerB
	if err := q.UpdateUserPlayerID(context.Background(), db.UpdateUserPlayerIDParams{
		ID:       idpkg.ID(guestUserID),
		PlayerID: &playerBID,
	}); err != nil {
		t.Fatalf("link guest player: %v", err)
	}

	wire := createTableHTTP(t, router, hostToken, newID(t), elo.GameIDIAWW, iawwTableState(playerA, playerB, "IawwValHost", "IawwValGuest"))

	cases := []struct {
		name    string
		payload map[string]any
	}{
		{"unknown row", map[string]any{"directVp": 0, "cells": []map[string]any{{"row": "nope", "coeff": 1, "count": 1}}}},
		{"wrong pair coeff", map[string]any{"directVp": 0, "cells": []map[string]any{{"row": "str-res", "coeff": 5, "count": 1}}}},
		{"duplicate row", map[string]any{"directVp": 0, "cells": []map[string]any{
			{"row": "structure", "coeff": 1, "count": 1},
			{"row": "structure", "coeff": 2, "count": 1},
		}}},
		{"negative count", map[string]any{"directVp": 0, "cells": []map[string]any{{"row": "structure", "coeff": 1, "count": -1}}}},
		{"negative direct vp", map[string]any{"directVp": -1, "cells": []any{}}},
		// Omitted directVp is valid now: a partial cell-only submit keeps the
		// current value (covered in TestGameTables_IawwPartialSubmits).
		{"skull king fields", map[string]any{"bid": 3}},
	}
	for _, tc := range cases {
		if w := submitTableHTTP(t, router, guestToken, wire, tc.payload); w.Code != http.StatusBadRequest {
			t.Errorf("%s: %d, want 400 (%s)", tc.name, w.Code, w.Body.String())
		}
	}

	// A player not in the game state gets 409, not a merge.
	outsiderToken, outsiderUserID := createTestUserWithID(t, pool, true)
	outsider := createTestPlayer(t, pool, "IawwOutsider")
	if err := q.UpdateUserPlayerID(context.Background(), db.UpdateUserPlayerIDParams{
		ID:       idpkg.ID(outsiderUserID),
		PlayerID: &outsider,
	}); err != nil {
		t.Fatalf("link outsider player: %v", err)
	}
	if w := submitTableHTTP(t, router, outsiderToken, wire, map[string]any{"directVp": 0, "cells": []any{}}); w.Code != http.StatusConflict {
		t.Errorf("outsider submit: %d, want 409", w.Code)
	}
}

// TestGameTables_VersionConflict: a host state patch based on a stale version
// must fail with 409 and return the current table instead of erasing the
// player's submission (optimistic lock, ADR-16).
func TestGameTables_VersionConflict(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	q := db.New(pool)
	hostToken, hostUserID := createTestUserWithID(t, pool, true)
	guestToken, guestUserID := createTestUserWithID(t, pool, true)
	router := setupRouter(pool)

	playerA := createTestPlayer(t, pool, "VcHost")
	linkPlayer(t, q, hostUserID, playerA)
	playerB := createTestPlayer(t, pool, "VcGuest")
	playerBID := playerB
	if err := q.UpdateUserPlayerID(context.Background(), db.UpdateUserPlayerIDParams{
		ID:       idpkg.ID(guestUserID),
		PlayerID: &playerBID,
	}); err != nil {
		t.Fatalf("link guest player: %v", err)
	}

	state := iawwTableState(playerA, playerB, "VcHost", "VcGuest")
	wire := createTableHTTP(t, router, hostToken, newID(t), elo.GameIDIAWW, state)

	// The player submits (version 1 -> 2) while the host is editing offline.
	if w := submitTableHTTP(t, router, guestToken, wire, map[string]any{
		"directVp": 7, "cells": []map[string]any{{"row": "culture", "coeff": 2, "count": 3}},
	}); w.Code != http.StatusOK {
		t.Fatalf("player submit: %d: %s", w.Code, w.Body.String())
	}

	// Host patches based on the stale version 1: 409 with the current table.
	stale := iawwTableState(playerA, playerB, "VcHost", "VcGuest")
	w := patchTableStateHTTP(t, router, hostToken, wire, 1, stale)
	if w.Code != http.StatusConflict {
		t.Fatalf("stale patch: %d, want 409 (%s)", w.Code, w.Body.String())
	}
	entries := parseIawwEntries(t, w.Body.Bytes())
	if !entries[1].Done {
		t.Error("conflict response must carry the current state (player's submission present)")
	}

	// Retrying with the fresh version from the 409 body succeeds.
	var conflictResp struct {
		Data struct {
			Version int64 `json:"version"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &conflictResp); err != nil {
		t.Fatalf("parse conflict body: %v", err)
	}
	merged := iawwTableState(playerA, playerB, "VcHost", "VcGuest")
	merged["entries"].([]map[string]any)[1]["done"] = true
	merged["entries"].([]map[string]any)[1]["directVp"] = 8
	retryResp := patchTableStateHTTP(t, router, hostToken, wire, conflictResp.Data.Version, merged)
	if retryResp.Code != http.StatusOK {
		t.Fatalf("retry with fresh version: %d: %s", retryResp.Code, retryResp.Body.String())
	}
	if entries := parseIawwEntries(t, retryResp.Body.Bytes()); entries[1].DirectVp == nil || *entries[1].DirectVp != 8 {
		t.Errorf("merged entry = %+v, want directVp=8", entries[1])
	}
}

// TestGameTables_SkullKingSubmitViaGenericEndpoint: bids and results flow
// through the generic submit endpoint, dispatched by the table's game.
func TestGameTables_SkullKingSubmitViaGenericEndpoint(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	q := db.New(pool)
	hostToken, hostUserID := createTestUserWithID(t, pool, true)
	guestToken, guestUserID := createTestUserWithID(t, pool, true)
	router := setupRouter(pool)

	playerA := createTestPlayer(t, pool, "SkSubHost")
	linkPlayer(t, q, hostUserID, playerA)
	playerB := createTestPlayer(t, pool, "SkSubGuest")
	playerBID := playerB
	if err := q.UpdateUserPlayerID(context.Background(), db.UpdateUserPlayerIDParams{
		ID:       idpkg.ID(guestUserID),
		PlayerID: &playerBID,
	}); err != nil {
		t.Fatalf("link guest player: %v", err)
	}

	state := map[string]any{
		"phase":              "waiting-for-bids",
		"players":            []map[string]any{{"id": string(playerA), "name": "SkSubHost"}, {"id": string(playerB), "name": "SkSubGuest"}},
		"currentRound":       1,
		"currentPlayerIndex": 0,
		"rounds":             []any{nil},
	}
	wire := createTableHTTP(t, router, hostToken, newID(t), elo.GameIDSkullKing, state)

	// Guest bids.
	if w := submitTableHTTP(t, router, guestToken, wire, map[string]any{"bid": 1}); w.Code != http.StatusOK {
		t.Fatalf("bid: %d: %s", w.Code, w.Body.String())
	}
	// Same bid again: slot taken.
	if w := submitTableHTTP(t, router, guestToken, wire, map[string]any{"bid": 0}); w.Code != http.StatusConflict {
		t.Errorf("re-bid: %d, want 409", w.Code)
	}
	// Result before the phase moves on: wrong phase.
	if w := submitTableHTTP(t, router, guestToken, wire, map[string]any{"actual": 1, "bonus": 0}); w.Code != http.StatusConflict {
		t.Errorf("result during bids: %d, want 409", w.Code)
	}

	// Host moves the game to result-entry; the guest submits the result.
	resultState := map[string]any{
		"phase":              "result-entry",
		"players":            state["players"],
		"currentRound":       1,
		"currentPlayerIndex": 0,
		"rounds":             []any{[]any{map[string]any{"bid": 2, "actual": nil, "bonus": 0}, map[string]any{"bid": 1, "actual": nil, "bonus": 0}}},
	}
	if w := patchTableStateHTTP(t, router, hostToken, wire, 2, resultState); w.Code != http.StatusOK {
		t.Fatalf("phase transition: %d: %s", w.Code, w.Body.String())
	}
	if w := submitTableHTTP(t, router, guestToken, wire, map[string]any{"actual": 1, "bonus": 10}); w.Code != http.StatusOK {
		t.Fatalf("result: %d: %s", w.Code, w.Body.String())
	}
	// Re-submitting the result is a conflict.
	if w := submitTableHTTP(t, router, guestToken, wire, map[string]any{"actual": 0, "bonus": 0}); w.Code != http.StatusConflict {
		t.Errorf("re-result: %d, want 409", w.Code)
	}
}

// TestGameTables_UnknownGameRejected: creating a table for an unknown game id
// is a 400, not a silent skull-king table.
func TestGameTables_UnknownGameRejected(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	hostToken, hostUserID := createTestUserWithID(t, pool, true)
	router := setupRouter(pool)
	q := db.New(pool)
	linkPlayer(t, q, hostUserID, createTestPlayer(t, pool, "UnknownGameHost"))

	body, _ := json.Marshal(map[string]any{
		"id":         string(newID(t).Base58()),
		"game_id":    string(newID(t).Base58()),
		"game_state": iawwTableState(newID(t), newID(t), "A", "B"),
	})
	req, _ := http.NewRequest(http.MethodPost, "/tables", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+hostToken)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("create with unknown game: %d, want 400 (%s)", w.Code, w.Body.String())
	}
}

// takeTableHTTP posts a takeover request and returns the recorder.
// takeTableHTTP claims hosting for a device token; returns the recorder.
func takeTableHTTP(t *testing.T, router *gin.Engine, token, tableWire, clientToken string) *httptest.ResponseRecorder {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"host_client_token": clientToken})
	req, _ := http.NewRequest(http.MethodPost, "/tables/"+tableWire+"/takeover", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

type takeoverSummary struct {
	Data struct {
		HostUserID      string `json:"host_user_id"`
		HostClientToken string `json:"host_client_token"`
	} `json:"data"`
}

// TestGameTables_Takeover: hosting is claimed per device — the current host
// may always re-claim (host resume on another device refreshes the client
// token), any other user needs edit permission; a transfer moves host
// authority (the old host's writes become 403s).
func TestGameTables_Takeover(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	q := db.New(pool)
	// The host is a non-editor on purpose: creating needs only a linked
	// player, and re-claiming ones own table must not need edit rights.
	hostToken, hostUserID := createTestUserWithID(t, pool, false)
	editorToken, editorUserID := createTestUserWithID(t, pool, true)
	router := setupRouter(pool)

	playerA := createTestPlayer(t, pool, "TkHost")
	playerB := createTestPlayer(t, pool, "TkEditor")
	linkPlayer(t, q, hostUserID, playerA)
	linkPlayer(t, q, editorUserID, playerB)

	wire := createTableHTTP(t, router, hostToken, newID(t), elo.GameIDIAWW, iawwTableState(playerA, playerB, "TkHost", "TkEditor"))

	// Table reads are never cacheable; the creating device holds the claim.
	req, _ := http.NewRequest(http.MethodGet, "/tables/"+wire, nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if cc := w.Header().Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", cc)
	}
	var summary takeoverSummary
	if err := json.Unmarshal(w.Body.Bytes(), &summary); err != nil {
		t.Fatalf("parse summary: %v", err)
	}
	if summary.Data.HostClientToken != "creator-device" {
		t.Errorf("host_client_token = %q, want the creating device's token", summary.Data.HostClientToken)
	}

	// The non-editor host re-claims from a second device: allowed, and
	// moves the claim to that device's token (the first device steps down
	// client-side on the next snapshot).
	reclaimed := takeTableHTTP(t, router, hostToken, wire, "device-b-token")
	if reclaimed.Code != http.StatusOK {
		t.Fatalf("host re-claim: %d: %s", reclaimed.Code, reclaimed.Body.String())
	}
	if err := json.Unmarshal(reclaimed.Body.Bytes(), &summary); err != nil {
		t.Fatalf("parse re-claim summary: %v", err)
	}
	if summary.Data.HostClientToken != "device-b-token" {
		t.Errorf("host_client_token = %q, want the re-claiming device's token", summary.Data.HostClientToken)
	}
	if summary.Data.HostUserID != string(idpkg.ID(hostUserID).Base58()) {
		t.Errorf("host_user_id = %q, want unchanged on same-user re-claim", summary.Data.HostUserID)
	}

	// Another editor claims hosting — no participant requirement.
	taken := takeTableHTTP(t, router, editorToken, wire, "editor-device")
	if taken.Code != http.StatusOK {
		t.Fatalf("editor takeover: %d: %s", taken.Code, taken.Body.String())
	}
	if err := json.Unmarshal(taken.Body.Bytes(), &summary); err != nil {
		t.Fatalf("parse takeover summary: %v", err)
	}
	if summary.Data.HostUserID != string(idpkg.ID(editorUserID).Base58()) {
		t.Errorf("host_user_id = %q, want the editor after takeover", summary.Data.HostUserID)
	}
	if summary.Data.HostClientToken != "editor-device" {
		t.Errorf("host_client_token = %q, want the claiming device's token", summary.Data.HostClientToken)
	}

	// Idempotent for the new host (same user, same device token).
	if w := takeTableHTTP(t, router, editorToken, wire, "editor-device"); w.Code != http.StatusOK {
		t.Errorf("idempotent takeover: %d, want 200", w.Code)
	}

	// A user without edit permission cannot claim someone else's table.
	plainToken, plainUserID := createTestUserWithID(t, pool, false)
	linkPlayer(t, q, plainUserID, createTestPlayer(t, pool, "TkPlain"))
	if w := takeTableHTTP(t, router, plainToken, wire, "plain-device"); w.Code != http.StatusForbidden {
		t.Errorf("non-editor takeover: %d, want 403", w.Code)
	}

	// Host authority moved: the old host's patch is a 403, the new host's is a 200.
	state := iawwTableState(playerA, playerB, "TkHost", "TkEditor")
	if w := patchTableStateHTTP(t, router, hostToken, wire, 1, state); w.Code != http.StatusForbidden {
		t.Errorf("old host patch after takeover: %d, want 403", w.Code)
	}
	if w := patchTableStateHTTP(t, router, editorToken, wire, 1, state); w.Code != http.StatusOK {
		t.Errorf("new host patch after takeover: %d, want 200 (%s)", w.Code, w.Body.String())
	}
}

// TestGameTables_JoinSignalsLobby: a player joining a table lands in
// connected_player_ids and signals the lobby, so the joining player's header
// table indicator and the lobby lists update live (no page reload).
func TestGameTables_JoinSignalsLobby(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	_, hostUserID := createTestUserWithID(t, pool, true)
	hostPlayer := createTestPlayer(t, pool, "JlHost")

	hub := elo.NewHub()
	svc := elo.NewTableService(pool, hub)
	lobbyCh, cancelLobby := hub.Subscribe(elo.TopicLobbyTables)
	defer cancelLobby()

	state, _ := json.Marshal(map[string]any{
		"phase":              "waiting-for-bids",
		"players":            []map[string]any{{"id": string(hostPlayer), "name": "JlHost"}},
		"currentRound":       1,
		"currentPlayerIndex": 0,
		"rounds":             [][]any{nil},
	})
	tableID := newID(t)
	if _, err := svc.CreateTable(context.Background(), tableID, idpkg.ID(hostUserID), elo.GameIDSkullKing, "test-device", state); err != nil {
		t.Fatalf("CreateTable: %v", err)
	}
	// Drain the create-time lobby signal so the next frame is the join's.
	nextSSEFrame(t, lobbyCh, "create tables-changed")

	guestPlayer := createTestPlayer(t, pool, "JlGuest")
	summary, err := svc.JoinTable(context.Background(), tableID, guestPlayer)
	if err != nil {
		t.Fatalf("JoinTable: %v", err)
	}
	found := false
	for _, pid := range summary.ConnectedPlayerIDs {
		if pid == string(guestPlayer.Base58()) {
			found = true
		}
	}
	if !found {
		t.Errorf("connected_player_ids = %v, want the joined player %s", summary.ConnectedPlayerIDs, guestPlayer.Base58())
	}

	if frame := nextSSEFrame(t, lobbyCh, "join tables-changed"); !isSignal(frame, "tables-changed") {
		t.Errorf("lobby frame after join = %s, want tables-changed", frame)
	}
}

// TestGameTables_IawwSubmitMergesHostCells: the host may enter values into a
// player's entry while that player is still filling their grid. "Готово"
// carries only the cells the player typed, so the submit must merge — the
// player's values win on the rows they sent, the host's other rows survive —
// not replace the entry.
func TestGameTables_IawwSubmitMergesHostCells(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	q := db.New(pool)
	hostToken, hostUserID := createTestUserWithID(t, pool, true)
	guestToken, guestUserID := createTestUserWithID(t, pool, true)
	router := setupRouter(pool)

	playerA := createTestPlayer(t, pool, "IawwMergeHost")
	linkPlayer(t, q, hostUserID, playerA)
	playerB := createTestPlayer(t, pool, "IawwMergeGuest")
	playerBID := playerB
	if err := q.UpdateUserPlayerID(context.Background(), db.UpdateUserPlayerIDParams{
		ID:       idpkg.ID(guestUserID),
		PlayerID: &playerBID,
	}); err != nil {
		t.Fatalf("link guest player: %v", err)
	}

	wire := createTableHTTP(t, router, hostToken, newID(t), elo.GameIDIAWW, iawwTableState(playerA, playerB, "IawwMergeHost", "IawwMergeGuest"))

	req, _ := http.NewRequest(http.MethodPost, "/tables/"+wire+"/join", nil)
	req.Header.Set("Authorization", "Bearer "+guestToken)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("join: %d: %s", w.Code, w.Body.String())
	}

	// The host pre-fills the guest's direct VP and two cells (a correction the
	// guest has not seen yet) and syncs the patch.
	state := iawwTableState(playerA, playerB, "IawwMergeHost", "IawwMergeGuest")
	state["entries"].([]map[string]any)[1]["directVp"] = 5
	state["entries"].([]map[string]any)[1]["cells"] = []map[string]any{
		{"row": "vehicle", "coeff": 2, "count": 3},
		{"row": "str-res", "coeff": 6, "count": 1},
	}
	if w := patchTableStateHTTP(t, router, hostToken, wire, 1, state); w.Code != http.StatusOK {
		t.Fatalf("host pre-fill patch: %d: %s", w.Code, w.Body.String())
	}

	// The guest submits their own column: one new row and str-res typed over.
	// vehicle is not in the draft — the host's value there must survive.
	submission := map[string]any{
		"directVp": 12,
		"cells": []map[string]any{
			{"row": "structure", "coeff": 3, "count": 2},
			{"row": "str-res", "coeff": 6, "count": 4},
		},
	}
	submitResp := submitTableHTTP(t, router, guestToken, wire, submission)
	if submitResp.Code != http.StatusOK {
		t.Fatalf("submit: %d: %s", submitResp.Code, submitResp.Body.String())
	}
	entries := parseIawwEntries(t, submitResp.Body.Bytes())
	guest := entries[1]
	if !guest.Done {
		t.Errorf("guest entry not done: %+v", guest)
	}
	if guest.DirectVp == nil || *guest.DirectVp != 12 {
		t.Errorf("directVp = %v, want the player's 12", guest.DirectVp)
	}
	byRow := map[string]struct {
		Coeff int
		Count int
	}{}
	for _, c := range guest.Cells {
		byRow[c.Row] = struct {
			Coeff int
			Count int
		}{c.Coeff, c.Count}
	}
	if len(guest.Cells) != 3 {
		t.Fatalf("cells = %+v, want 3 merged rows", guest.Cells)
	}
	if c := byRow["structure"]; c.Count != 2 || c.Coeff != 3 {
		t.Errorf("structure = %+v, want the player's 3x2", c)
	}
	if c := byRow["str-res"]; c.Count != 4 || c.Coeff != 6 {
		t.Errorf("str-res = %+v, want the player's 6x4 (player wins the row)", c)
	}
	if c := byRow["vehicle"]; c.Count != 3 || c.Coeff != 2 {
		t.Errorf("vehicle = %+v, want the host's 2x3 kept", c)
	}
}

// TestGameTables_IawwPartialSubmits: a connected player's cell edits sync
// instantly as partial submits — done stays false, directVp/cells merge into
// the entry (count 0 clears a row) — and the explicit done closes the column.
func TestGameTables_IawwPartialSubmits(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	q := db.New(pool)
	hostToken, hostUserID := createTestUserWithID(t, pool, true)
	guestToken, guestUserID := createTestUserWithID(t, pool, true)
	router := setupRouter(pool)

	playerA := createTestPlayer(t, pool, "IawwPartHost")
	linkPlayer(t, q, hostUserID, playerA)
	playerB := createTestPlayer(t, pool, "IawwPartGuest")
	playerBID := playerB
	if err := q.UpdateUserPlayerID(context.Background(), db.UpdateUserPlayerIDParams{
		ID:       idpkg.ID(guestUserID),
		PlayerID: &playerBID,
	}); err != nil {
		t.Fatalf("link guest player: %v", err)
	}

	wire := createTableHTTP(t, router, hostToken, newID(t), elo.GameIDIAWW, iawwTableState(playerA, playerB, "IawwPartHost", "IawwPartGuest"))

	req, _ := http.NewRequest(http.MethodPost, "/tables/"+wire+"/join", nil)
	req.Header.Set("Authorization", "Bearer "+guestToken)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("join: %d: %s", w.Code, w.Body.String())
	}

	// Cell edit 1: a directVp + one row; the entry must not be done.
	submitResp := submitTableHTTP(t, router, guestToken, wire, map[string]any{
		"done":     false,
		"directVp": 8,
		"cells":    []map[string]any{{"row": "structure", "coeff": 3, "count": 2}},
	})
	if submitResp.Code != http.StatusOK {
		t.Fatalf("partial submit 1: %d: %s", submitResp.Code, submitResp.Body.String())
	}
	entries := parseIawwEntries(t, submitResp.Body.Bytes())
	if entries[1].Done {
		t.Errorf("partial submit marked the entry done: %+v", entries[1])
	}
	if entries[1].DirectVp == nil || *entries[1].DirectVp != 8 {
		t.Errorf("directVp = %v, want 8", entries[1].DirectVp)
	}

	// Cell edit 2: add a pair row and clear the structure row (count 0);
	// directVp omitted keeps its value.
	submitResp = submitTableHTTP(t, router, guestToken, wire, map[string]any{
		"done":  false,
		"cells": []map[string]any{{"row": "str-res", "coeff": 6, "count": 1}, {"row": "structure", "coeff": 0, "count": 0}},
	})
	if submitResp.Code != http.StatusOK {
		t.Fatalf("partial submit 2: %d: %s", submitResp.Code, submitResp.Body.String())
	}
	entries = parseIawwEntries(t, submitResp.Body.Bytes())
	if entries[1].Done {
		t.Errorf("partial submit 2 marked the entry done: %+v", entries[1])
	}
	if entries[1].DirectVp == nil || *entries[1].DirectVp != 8 {
		t.Errorf("directVp = %v, want kept 8", entries[1].DirectVp)
	}
	if len(entries[1].Cells) != 1 || entries[1].Cells[0].Row != "str-res" {
		t.Errorf("cells = %+v, want only str-res (structure cleared)", entries[1].Cells)
	}

	// "Готово": done without carrying any values.
	submitResp = submitTableHTTP(t, router, guestToken, wire, map[string]any{
		"done":  true,
		"cells": []map[string]any{},
	})
	if submitResp.Code != http.StatusOK {
		t.Fatalf("finalize: %d: %s", submitResp.Code, submitResp.Body.String())
	}
	entries = parseIawwEntries(t, submitResp.Body.Bytes())
	if !entries[1].Done || entries[1].DirectVp == nil || *entries[1].DirectVp != 8 {
		t.Errorf("finalized entry = %+v, want done with directVp 8", entries[1])
	}

	// After done, any further submit is a 409.
	if w := submitTableHTTP(t, router, guestToken, wire, map[string]any{
		"done":  true,
		"cells": []map[string]any{},
	}); w.Code != http.StatusConflict {
		t.Errorf("submit after done: %d, want 409", w.Code)
	}
}
