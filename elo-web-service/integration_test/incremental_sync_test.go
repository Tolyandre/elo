//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/elo"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

// TestMatches_UpdatedAtIncrementalSync verifies the offline replica's match
// cursor (ADR-39): every match carries an updated_at change stamp, a score
// edit bumps it (the match_scores trigger), and ?updated_since= returns only
// the rows changed after the client's stored cursor.
func TestMatches_UpdatedAtIncrementalSync(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	p1 := createTestPlayer(t, pool, "Инкр1")
	p2 := createTestPlayer(t, pool, "Инкр2")
	p3 := createTestPlayer(t, pool, "Инкр3")
	gameID := createTestGame(t, pool, "Инкрементальная")

	svc := newMatchService(pool)
	older, err := svc.AddMatch(ctx, blueMenTenantID, gameID, map[idpkg.ID]float64{p1: 100, p2: 50, p3: 10}, time.Now().Add(-2*time.Hour), newMatchOpts(t))
	if err != nil {
		t.Fatalf("AddMatch older: %v", err)
	}
	newer, err := svc.AddMatch(ctx, blueMenTenantID, gameID, map[idpkg.ID]float64{p1: 10, p2: 5, p3: 1}, time.Now().Add(-time.Hour), newMatchOpts(t))
	if err != nil {
		t.Fatalf("AddMatch newer: %v", err)
	}

	type matchRow struct {
		Id        string `json:"id"`
		Date      string `json:"date"`
		UpdatedAt string `json:"updated_at"`
	}
	type page struct {
		Data []matchRow `json:"data"`
		Next *string    `json:"next"`
	}
	decode := func(path string) page {
		t.Helper()
		w := doJSON(t, setupRouter(pool), http.MethodGet, path, "", "")
		if w.Code != http.StatusOK {
			t.Fatalf("GET %s: %d %s", path, w.Code, w.Body.String())
		}
		var resp page
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode matches: %v", err)
		}
		return resp
	}

	list := decode("/matches?tenant=" + blueMenTenantUUID)
	if len(list.Data) != 2 {
		t.Fatalf("want 2 matches, got %d", len(list.Data))
	}
	stamps := map[string]string{}
	for _, m := range list.Data {
		if m.UpdatedAt == "" {
			t.Fatalf("match %s: empty updated_at", m.Id)
		}
		stamps[m.Id] = m.UpdatedAt
	}
	// Wire ids are Base58 (ADR-12); key the stamps by them.
	newerStamp := stamps[string(newer.ID.Base58())]
	olderStamp := stamps[string(older.ID.Base58())]
	if newerStamp == "" || olderStamp == "" {
		t.Fatalf("missing stamps: %v", stamps)
	}

	// A score-only edit of the older match (same date, same game) bumps its
	// stamp via the match_scores trigger.
	if _, err := svc.UpdateMatch(ctx, blueMenTenantID, older.ID, gameID, map[idpkg.ID]float64{p1: 90, p2: 40, p3: 5}, older.Date.Time, elo.UpdateMatchOpts{}); err != nil {
		t.Fatalf("UpdateMatch: %v", err)
	}

	// The incremental pull from the newer match's stamp sees exactly the
	// edited match — the untouched one is not re-downloaded.
	delta := decode("/matches?tenant=" + blueMenTenantUUID + "&updated_since=" + url.QueryEscape(newerStamp))
	if len(delta.Data) != 1 || delta.Data[0].Id != string(older.ID.Base58()) {
		t.Fatalf("updated_since delta: want only %s, got %+v", older.ID, delta.Data)
	}
	// The pull from the older match's original stamp still sees the newer one.
	both := decode("/matches?tenant=" + blueMenTenantUUID + "&updated_since=" + url.QueryEscape(olderStamp))
	if len(both.Data) != 2 {
		t.Fatalf("updated_since from older stamp: want 2 matches, got %d", len(both.Data))
	}
}

// TestArena_SettlementsFingerprint verifies the arena's settlement-fingerprint
// triple (ADR-39): present on the detail and list reads, zero for an empty
// ledger, and changed by a settlement-affecting write — the signal the offline
// client compares before re-draining GET /arenas/{id}/settlements.
func TestArena_SettlementsFingerprint(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	editor := createNamedTestUser(t, pool, "fp-editor", "Фингерпринт Редактор")
	router := setupRouter(pool)

	gameID := string(newID(t))
	if w := doJSON(t, router, http.MethodPost, "/games", editor, `{"id":"`+gameID+`","name":"Фингерпринтная игра"}`); w.Code != http.StatusOK {
		t.Fatalf("create game: %d %s", w.Code, w.Body.String())
	}

	type fpJSON struct {
		Id                  string  `json:"id"`
		SettlementsCount    *int    `json:"settlements_count"`
		SettlementsLastDate *string `json:"settlements_last_date"`
		SettlementsLastId   *string `json:"settlements_last_id"`
	}
	decodeArenaData := func(path string) json.RawMessage {
		t.Helper()
		w := doJSON(t, router, http.MethodGet, path, "", "")
		if w.Code != http.StatusOK {
			t.Fatalf("GET %s: %d %s", path, w.Code, w.Body.String())
		}
		var resp struct {
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode arena: %v", err)
		}
		return resp.Data
	}
	decodeArena := func(path string) fpJSON {
		t.Helper()
		var one fpJSON
		if err := json.Unmarshal(decodeArenaData(path), &one); err != nil || one.Id == "" {
			t.Fatalf("decode arena detail %s: %v", path, err)
		}
		return one
	}

	// A fresh game arena: zero settlements, no last-row columns.
	arenaID := gameArenaID(t, pool, idpkg.ID(gameID))
	empty := decodeArena("/arenas/" + string(arenaID))
	if empty.SettlementsCount == nil || *empty.SettlementsCount != 0 {
		t.Fatalf("empty arena: want settlements_count 0, got %v", empty.SettlementsCount)
	}
	if empty.SettlementsLastId != nil || empty.SettlementsLastDate != nil {
		t.Fatalf("empty arena: last-row columns must be absent, got %v/%v", empty.SettlementsLastId, empty.SettlementsLastDate)
	}

	// One match (3 players) → the triple appears.
	p1 := createTestPlayer(t, pool, "ФП1")
	p2 := createTestPlayer(t, pool, "ФП2")
	p3 := createTestPlayer(t, pool, "ФП3")
	svc := newMatchService(pool)
	if _, err := svc.AddMatch(context.Background(), blueMenTenantID, idpkg.ID(gameID), map[idpkg.ID]float64{p1: 10, p2: 5, p3: 1}, time.Now(), newMatchOpts(t)); err != nil {
		t.Fatalf("AddMatch: %v", err)
	}

	detail := decodeArena("/arenas/" + string(arenaID))
	if detail.SettlementsCount == nil || *detail.SettlementsCount != 3 || detail.SettlementsLastId == nil || detail.SettlementsLastDate == nil {
		t.Fatalf("after one match: got %+v", detail)
	}

	// The list read (by-game branch) carries the same triple. The lookup
	// returns every arena matching the game (the global unconditional one
	// included) — pick the game arena's entry.
	var listItems []fpJSON
	if err := json.Unmarshal(decodeArenaData("/arenas?game_id="+url.QueryEscape(gameID)), &listItems); err != nil || len(listItems) == 0 {
		t.Fatalf("decode arena list: %v", err)
	}
	var listItem *fpJSON
	for i := range listItems {
		if listItems[i].Id == string(arenaID.Base58()) {
			listItem = &listItems[i]
		}
	}
	if listItem == nil {
		t.Fatalf("list read: game arena %s missing among %d entries", arenaID, len(listItems))
	}
	if listItem.SettlementsCount == nil || *listItem.SettlementsCount != 3 || listItem.SettlementsLastId == nil {
		t.Fatalf("list read: got %+v", listItem)
	}

	// A second match changes the triple (new count, new last row).
	before := *detail.SettlementsLastId
	if _, err := svc.AddMatch(context.Background(), blueMenTenantID, idpkg.ID(gameID), map[idpkg.ID]float64{p1: 9, p2: 4, p3: 2}, time.Now().Add(time.Hour), newMatchOpts(t)); err != nil {
		t.Fatalf("AddMatch second: %v", err)
	}
	after := decodeArena("/arenas/" + string(arenaID))
	if after.SettlementsCount == nil || *after.SettlementsCount != 6 {
		t.Fatalf("after two matches: want count 6, got %v", after.SettlementsCount)
	}
	if after.SettlementsLastId == nil || *after.SettlementsLastId == before {
		t.Fatalf("after two matches: last id must change, got %v (was %s)", after.SettlementsLastId, before)
	}
}
