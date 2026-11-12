//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"testing"
	"time"

	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

// TestArena_SettlementsLedgerEndpoint verifies the offline client's hydration
// endpoint (ADR-38): the arena's settlement ledger in ascending (date, id)
// replay order, keyset-paginated so a page boundary never splits or skips
// same-date rows.
func TestArena_SettlementsLedgerEndpoint(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	editor := createNamedTestUser(t, pool, "settle-editor", "Леджер Редактор")
	router := setupRouter(pool)

	gameID := string(newID(t))
	if w := doJSON(t, router, http.MethodPost, "/games", editor, `{"id":"`+gameID+`","name":"Леджерная игра"}`); w.Code != http.StatusOK {
		t.Fatalf("create game: %d %s", w.Code, w.Body.String())
	}

	p1 := createTestPlayer(t, pool, "Леджер1")
	p2 := createTestPlayer(t, pool, "Леджер2")
	p3 := createTestPlayer(t, pool, "Леджер3")

	svc := newMatchService(pool)
	// Two matches in the same game arena, an hour apart: 3 settlements each.
	first := time.Now().Add(-2 * time.Hour).Truncate(time.Second)
	second := first.Add(time.Hour)
	for i, date := range []time.Time{first, second} {
		if _, err := svc.AddMatch(context.Background(), blueMenTenantID, idpkg.ID(gameID), map[idpkg.ID]float64{p1: 100, p2: 50, p3: 10}, date, newMatchOpts(t)); err != nil {
			t.Fatalf("AddMatch %d: %v", i, err)
		}
	}

	arenaID := gameArenaID(t, pool, idpkg.ID(gameID))
	path := "/arenas/" + string(arenaID) + "/settlements"

	type settlementRow struct {
		Id            string  `json:"id"`
		PlayerId      string  `json:"player_id"`
		Date          string  `json:"date"`
		RatingAfter   float64 `json:"rating_after"`
		EloAfter      float64 `json:"elo_after"`
		Discriminator string  `json:"discriminator"`
		MatchId       *string `json:"match_id"`
		League        *string `json:"league"`
	}
	type pageJSON struct {
		Data []settlementRow `json:"data"`
		Next *string         `json:"next"`
	}

	// Page 1 with a small limit: full page, token present.
	w := doJSON(t, router, http.MethodGet, path+"?limit=4", "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET settlements: %d %s", w.Code, w.Body.String())
	}
	var page1 pageJSON
	if err := json.Unmarshal(w.Body.Bytes(), &page1); err != nil {
		t.Fatalf("decode page 1: %v", err)
	}
	if len(page1.Data) != 4 || page1.Next == nil {
		t.Fatalf("page 1: want 4 rows + next token, got %d rows, next=%v", len(page1.Data), page1.Next)
	}

	// Walk the cursor to the end: 6 rows total (2 matches × 3 players), all
	// ascending, all match-settlements of the arena.
	seen := page1.Data
	next := *page1.Next
	for i := 0; i < 10; i++ {
		w = doJSON(t, router, http.MethodGet, path+"?limit=4&next="+url.QueryEscape(next), "", "")
		if w.Code != http.StatusOK {
			t.Fatalf("GET settlements page: %d %s", w.Code, w.Body.String())
		}
		var page pageJSON
		if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil {
			t.Fatalf("decode page: %v", err)
		}
		seen = append(seen, page.Data...)
		if page.Next == nil {
			break
		}
		next = *page.Next
	}
	if len(seen) != 6 {
		t.Fatalf("want 6 settlements total, got %d", len(seen))
	}
	for i := 1; i < len(seen); i++ {
		prev, cur := seen[i-1], seen[i]
		if cur.Date < prev.Date || (cur.Date == prev.Date && cur.Id <= prev.Id) {
			t.Fatalf("rows not in ascending (date, id) order at %d: %v %v", i, prev, cur)
		}
		if cur.Discriminator != "match" || cur.MatchId == nil {
			t.Fatalf("unexpected row: %+v", cur)
		}
	}

	// A broken cursor is a 400, not a 500.
	if w := doJSON(t, router, http.MethodGet, path+"?next=garbage", "", ""); w.Code != http.StatusBadRequest {
		t.Fatalf("bad cursor: want 400, got %d %s", w.Code, w.Body.String())
	}

	// An unknown arena is a 404.
	missing := fmt.Sprintf("/arenas/%s/settlements", idpkg.ID(newID(t)).Base58())
	if w := doJSON(t, router, http.MethodGet, missing, "", ""); w.Code != http.StatusNotFound {
		t.Fatalf("unknown arena: want 404, got %d %s", w.Code, w.Body.String())
	}

	// The out-of-range limit is a 400.
	if w := doJSON(t, router, http.MethodGet, path+"?limit=9999", "", ""); w.Code != http.StatusBadRequest {
		t.Fatalf("limit 9999: want 400, got %d %s", w.Code, w.Body.String())
	}
}
