//go:build integration

package integration_test

// The player game collection ("Коллекция игр"): public read; writes only for
// the user linked to the player (users.player_id). Add/remove are idempotent
// (ON CONFLICT DO NOTHING / missing-row DELETE); unknown player or game is a
// foreign-key violation the handler maps to 400.

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/tolyandre/elo-web-service/pkg/db"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

type collectionGame struct {
	Id            string  `json:"id"`
	Name          string  `json:"name"`
	ImageThumbURL *string `json:"image_thumb_url"`
	MatchesCount  int     `json:"matches_count"`
}

type collectionPayload struct {
	Total int              `json:"total"`
	Games []collectionGame `json:"games"`
}

func getCollection(t *testing.T, router interface {
	ServeHTTP(http.ResponseWriter, *http.Request)
}, path, token string) (int, *collectionPayload) {
	t.Helper()
	w := doJSON(t, router, http.MethodGet, path, token, "")
	if w.Code != http.StatusOK {
		return w.Code, nil
	}
	var resp struct {
		Data collectionPayload `json:"data"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode collection response: %v", err)
	}
	return w.Code, &resp.Data
}

func TestPlayerGameCollection_Lifecycle(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	router := setupRouter(pool)
	q := db.New(pool)
	ctx := context.Background()

	player := createTestPlayer(t, pool, "Коллекционер")
	g1 := createTestGame(t, pool, "Абстрактная игра")
	g2 := createTestGame(t, pool, "Библиотечная игра")
	g3 := createTestGame(t, pool, "Вечерняя игра")

	// The linked user: their users.player_id points at the profile's player.
	myToken, myUserID := createTestUserWithID(t, pool, false)
	if err := q.UpdateUserPlayerID(ctx, db.UpdateUserPlayerIDParams{ID: idpkg.ID(myUserID), PlayerID: &player}); err != nil {
		t.Fatalf("link my player: %v", err)
	}
	// Another authenticated user linked to a different player, plus a bare
	// editor: neither may manage this shelf.
	otherToken, otherUserID := createTestUserWithID(t, pool, false)
	other := createTestPlayer(t, pool, "Посторонний")
	if err := q.UpdateUserPlayerID(ctx, db.UpdateUserPlayerIDParams{ID: idpkg.ID(otherUserID), PlayerID: &other}); err != nil {
		t.Fatalf("link other player: %v", err)
	}
	editorToken, _ := createTestUserWithID(t, pool, true)

	// Anonymous GET reads the (empty) collection — no 401 on reads.
	if code, data := getCollection(t, router, "/players/"+player.String()+"/collection", ""); code != http.StatusOK || data == nil || data.Total != 0 {
		t.Fatalf("anonymous GET = %d, %+v; want 200 with empty collection", code, data)
	}

	// Writes are closed to the anonymous, the foreign, and the editor user.
	for _, tc := range []struct{ name, token string }{
		{"anonymous", ""},
		{"foreign user", otherToken},
		{"editor", editorToken},
	} {
		want := http.StatusForbidden
		if tc.token == "" {
			want = http.StatusUnauthorized
		}
		w := doJSON(t, router, http.MethodPost, "/players/"+player.String()+"/collection", tc.token, `{"game_id":"`+g1.String()+`"}`)
		if w.Code != want {
			t.Fatalf("%s POST = %d, want %d", tc.name, w.Code, want)
		}
		w = doJSON(t, router, http.MethodDelete, "/players/"+player.String()+"/collection/"+g1.String(), tc.token, "")
		if w.Code != want {
			t.Fatalf("%s DELETE = %d, want %d", tc.name, w.Code, want)
		}
	}

	// The linked user adds two games; a duplicate add is an idempotent no-op.
	for _, game := range []idpkg.ID{g2, g1, g1} {
		w := doJSON(t, router, http.MethodPost, "/players/"+player.String()+"/collection", myToken, `{"game_id":"`+game.String()+`"}`)
		if w.Code != http.StatusOK {
			t.Fatalf("linked POST %s = %d: %s", game, w.Code, w.Body.String())
		}
	}
	code, data := getCollection(t, router, "/players/"+player.String()+"/collection", "")
	if code != http.StatusOK || data.Total != 2 || len(data.Games) != 2 {
		t.Fatalf("after adds: total=%d len=%d, want 2/2 (duplicate collapsed)", data.Total, len(data.Games))
	}
	// Alphabetical ordering by the display name (nothing played yet).
	if data.Games[0].Name != "Абстрактная игра" || data.Games[1].Name != "Библиотечная игра" {
		t.Fatalf("order = [%s, %s], want alphabetical", data.Games[0].Name, data.Games[1].Name)
	}

	// Two matches of «Вечерняя игра» move it to the front once collected:
	// most played by this player first, ties stay alphabetical. The guest
	// fills the second seat.
	guest := createBareTestPlayer(t, pool, "Гость-коллекционера")
	addMatchDaysAgo(t, ctx, pool, g3, 1, map[idpkg.ID]float64{player: 10, guest: 5})
	addMatchDaysAgo(t, ctx, pool, g3, 2, map[idpkg.ID]float64{player: 8, guest: 6})
	w := doJSON(t, router, http.MethodPost, "/players/"+player.String()+"/collection", myToken, `{"game_id":"`+g3.String()+`"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("linked POST %s = %d: %s", g3, w.Code, w.Body.String())
	}
	code, data = getCollection(t, router, "/players/"+player.String()+"/collection", "")
	if code != http.StatusOK || len(data.Games) != 3 {
		t.Fatalf("after third add: len=%d, want 3", len(data.Games))
	}
	if data.Games[0].Name != "Вечерняя игра" || data.Games[0].MatchesCount != 2 {
		t.Fatalf("first = %s (%d plays), want Вечерняя игра (2)", data.Games[0].Name, data.Games[0].MatchesCount)
	}
	if data.Games[1].Name != "Абстрактная игра" || data.Games[2].Name != "Библиотечная игра" {
		t.Fatalf("rest = [%s, %s], want the untouched games alphabetical", data.Games[1].Name, data.Games[2].Name)
	}

	// Remove empties the shelf again; removing a non-member is a no-op.
	for _, game := range []idpkg.ID{g1, g3} {
		w := doJSON(t, router, http.MethodDelete, "/players/"+player.String()+"/collection/"+game.String(), myToken, "")
		if w.Code != http.StatusOK {
			t.Fatalf("linked DELETE %s = %d: %s", game, w.Code, w.Body.String())
		}
	}
	if code, data := getCollection(t, router, "/players/"+player.String()+"/collection", ""); code != http.StatusOK || data.Total != 1 || len(data.Games) != 1 {
		t.Fatalf("after removes: total=%d len=%d, want 1/1 (g3 was never added)", data.Total, len(data.Games))
	}

	// Unknown references fail: a missing player is a 404 (same as the public
	// GET), a missing game a foreign-key 400.
	w = doJSON(t, router, http.MethodPost, "/players/"+player.String()+"/collection", myToken, `{"game_id":"`+newID(t).String()+`"}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("unknown game POST = %d, want 400", w.Code)
	}
	w = doJSON(t, router, http.MethodPost, "/players/"+newID(t).String()+"/collection", myToken, `{"game_id":"`+g1.String()+`"}`)
	if w.Code != http.StatusNotFound {
		t.Fatalf("unknown player POST = %d, want 404", w.Code)
	}

	// The profile page of an unknown player reads as 404.
	if code, _ := getCollection(t, router, "/players/"+newID(t).String()+"/collection", ""); code != http.StatusNotFound {
		t.Fatalf("unknown player GET = %d, want 404", code)
	}
	if code, _ := getCollection(t, router, "/players/garbage/collection", ""); code != http.StatusNotFound {
		t.Fatalf("garbage id GET = %d, want 404", code)
	}
}
