//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/tolyandre/elo-web-service/pkg/db"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

// newTeseraStub serves the two Tesera endpoints the suggestion flow uses,
// with a small fixture set (see details below). The base game "Каркассон"
// has a localized title; "The Bottle Imp" matches a custom local name
// ("Бутылочка") as alias; the river is an addition that must be filtered
// out; "Другая игра" never matches any local name exactly.
func newTeseraStub(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()

	mux.HandleFunc("/search/games", func(w http.ResponseWriter, r *http.Request) {
		query := strings.ToLower(r.URL.Query().Get("query"))
		rows := []map[string]any{}
		switch {
		case strings.Contains(query, "каркассон"):
			rows = []map[string]any{
				{"type": "Game", "alias": "carcassonne", "teseraId": 707, "title": "Каркассон", "title2": "Carcassonne, 2"},
				{"type": "Game", "alias": "carcassonne-river", "teseraId": 26664, "title": "Каркассон. Река", "title2": "2001"},
			}
		case strings.Contains(query, "бутыл") || strings.Contains(query, "bottle"):
			rows = []map[string]any{
				{"type": "Game", "alias": "the-bottle-imp", "teseraId": 555, "title": "Тень в бутылке", "title2": "The Bottle Imp"},
			}
		default:
			rows = []map[string]any{
				{"type": "Game", "alias": "other-game", "teseraId": 999, "title": "Другая игра", "title2": "Other Game"},
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(rows)
	})

	details := map[string]map[string]any{
		"carcassonne":       {"teseraId": 707, "bggId": 822, "title": "Каркассон", "title2": "Carcassonne", "alias": "carcassonne", "year": 2000, "isAddition": false},
		"carcassonne-river": {"teseraId": 26664, "bggId": 4101, "title": "Каркассон. Река", "title2": "2001", "isAddition": true},
		"the-bottle-imp":    {"teseraId": 555, "bggId": 12345, "title": "Тень в бутылке", "title2": "The Bottle Imp", "year": 2011, "isAddition": false},
		"other-game":        {"teseraId": 999, "bggId": 999, "title": "Другая игра", "title2": "Other Game", "isAddition": false},
	}
	mux.HandleFunc("/games/", func(w http.ResponseWriter, r *http.Request) {
		alias := strings.TrimPrefix(r.URL.Path, "/games/")
		d, ok := details[alias]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(map[string]any{"message": "not found"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"game": d})
	})

	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server
}

func TestGameSuggestionsEndpoint(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	stub := newTeseraStub(t)
	router := setupRouterWithTesera(pool, stub.URL)

	editorToken, _ := createTestUserWithID(t, pool, true)
	viewerToken, _ := createTestUserWithID(t, pool, false)

	path := "/games/suggestions?query=" + url.QueryEscape("каркассон")

	if w := doJSON(t, router, http.MethodGet, path, "", ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated: %d %s", w.Code, w.Body.String())
	}
	if w := doJSON(t, router, http.MethodGet, path, viewerToken, ""); w.Code != http.StatusForbidden {
		t.Fatalf("non-editor: %d %s", w.Code, w.Body.String())
	}
	if w := doJSON(t, router, http.MethodGet, "/games/suggestions?query=", editorToken, ""); w.Code != http.StatusBadRequest {
		t.Fatalf("empty query: %d %s", w.Code, w.Body.String())
	}

	w := doJSON(t, router, http.MethodGet, path, editorToken, "")
	if w.Code != http.StatusOK {
		t.Fatalf("suggest: %d %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data struct {
			Games []struct {
				TeseraRef    int     `json:"tesera_ref"`
				BggRef       *int    `json:"bgg_ref"`
				NameRu       *string `json:"name_ru"`
				NameOriginal *string `json:"name_original"`
				Title        string  `json:"title"`
				IsAddition   bool    `json:"is_addition"`
			} `json:"games"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	if len(resp.Data.Games) != 2 {
		t.Fatalf("games = %+v, want the base game and the addition", resp.Data.Games)
	}
	// Exact base-game match sorts first; the Tesera-flagged addition (the
	// river) follows, marked rather than filtered — the flag is unreliable.
	g := resp.Data.Games[0]
	if g.TeseraRef != 707 || g.BggRef == nil || *g.BggRef != 822 || g.IsAddition {
		t.Errorf("first candidate = %+v, want tesera 707 / bgg 822 / base game", g)
	}
	if g.NameRu == nil || *g.NameRu != "Каркассон" || g.NameOriginal == nil || *g.NameOriginal != "Carcassonne" {
		t.Errorf("names = %+v, want Каркассон / Carcassonne", g)
	}
	river := resp.Data.Games[1]
	if river.TeseraRef != 26664 || !river.IsAddition {
		t.Errorf("second candidate = %+v, want the river addition flagged", river)
	}
}

func TestAutoMatchEndpoint(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	stub := newTeseraStub(t)
	router := setupRouterWithTesera(pool, stub.URL)
	editorToken, _ := createTestUserWithID(t, pool, true)

	// Created through the service so the name_original invariant holds.
	createGame := func(name string) idpkg.ID {
		t.Helper()
		gid := newID(t)
		body := fmt.Sprintf(`{"id":%q,"name":%q}`, gid.String(), name)
		if w := doJSON(t, router, http.MethodPost, "/games", editorToken, body); w.Code != http.StatusOK {
			t.Fatalf("create game %q: %d %s", name, w.Code, w.Body.String())
		}
		return gid
	}
	latin := createGame("Каркассон")        // equals the localized title: no alias
	custom := createGame("Бутылочка")       // custom name: becomes alias
	noMatch := createGame("Несуществующая") // stub has no exact match for it

	w := doJSON(t, router, http.MethodPost, "/games/auto-match", editorToken, "")
	if w.Code != http.StatusOK {
		t.Fatalf("auto-match: %d %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data struct {
			Games []struct {
				Id      string  `json:"id"`
				Matched bool    `json:"matched"`
				Reason  *string `json:"reason"`
			} `json:"games"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	byID := map[string]bool{}
	reasonOf := map[string]string{}
	for _, g := range resp.Data.Games {
		byID[g.Id] = g.Matched
		if g.Reason != nil {
			reasonOf[g.Id] = *g.Reason
		}
	}
	if !byID[shortOf(t, latin)] {
		t.Errorf("Каркассон must match, got %+v", resp.Data.Games)
	}
	// Auto-match applies only exact name matches: the custom alias and the
	// unknown game stay unmatched for the admin picker.
	if byID[shortOf(t, custom)] || reasonOf[shortOf(t, custom)] != "no exact match" {
		t.Errorf("Бутылочка must be reported as \"no exact match\", got %+v", resp.Data.Games)
	}
	if byID[shortOf(t, noMatch)] {
		t.Errorf("Несуществующая must not match, got %+v", resp.Data.Games)
	}

	q := db.New(pool)
	ctx := context.Background()

	got, err := q.GetGameByID(ctx, latin)
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "Каркассон" || !got.NameRu.Valid || got.NameRu.String != "Каркассон" ||
		!got.NameOriginal.Valid || got.NameOriginal.String != "Carcassonne" || got.Alias.Valid {
		t.Errorf("Каркассон row = %+v", got)
	}
	if !got.BggID.Valid || got.BggID.Int32 != 822 || !got.TeseraID.Valid || got.TeseraID.Int32 != 707 {
		t.Errorf("Каркассон refs = %+v", got)
	}

	// The unmatched game keeps its original single-name state.
	got, err = q.GetGameByID(ctx, custom)
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "Бутылочка" || got.Alias.Valid || got.NameRu.Valid || got.BggID.Valid {
		t.Errorf("Бутылочка row = %+v, want untouched", got)
	}

	// A second run revisits only the two unmatched games.
	w = doJSON(t, router, http.MethodPost, "/games/auto-match", editorToken, "")
	if w.Code != http.StatusOK {
		t.Fatalf("second auto-match: %d %s", w.Code, w.Body.String())
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Data.Games) != 2 {
		t.Errorf("second run games = %+v, want the two unmatched ones", resp.Data.Games)
	}
}

func TestPatchGameMetadataEndpoint(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	router := setupRouterWithTesera(pool, newTeseraStub(t).URL)
	editorToken, _ := createTestUserWithID(t, pool, true)

	createGame := func(name string) idpkg.ID {
		t.Helper()
		gid := newID(t)
		body := fmt.Sprintf(`{"id":%q,"name":%q}`, gid.String(), name)
		if w := doJSON(t, router, http.MethodPost, "/games", editorToken, body); w.Code != http.StatusOK {
			t.Fatalf("create game %q: %d %s", name, w.Code, w.Body.String())
		}
		return gid
	}

	game := createGame("Бутылочка")

	// Set the metadata; the typed name stays as the alias.
	patch := `{"alias":"Бутылочка","name_original":"The Bottle Imp","name_ru":"Тень в бутылке","bgg_ref":12345,"tesera_ref":555}`
	if w := doJSON(t, router, http.MethodPatch, "/games/"+game.String(), editorToken, patch); w.Code != http.StatusOK {
		t.Fatalf("patch metadata: %d %s", w.Code, w.Body.String())
	}

	// Removing the alias falls the display back to the localized name.
	if w := doJSON(t, router, http.MethodPatch, "/games/"+game.String(), editorToken, `{"name_original":"The Bottle Imp","name_ru":"Тень в бутылке","bgg_ref":12345,"tesera_ref":555}`); w.Code != http.StatusOK {
		t.Fatalf("clear alias: %d %s", w.Code, w.Body.String())
	}

	// Clearing every name is rejected.
	if w := doJSON(t, router, http.MethodPatch, "/games/"+game.String(), editorToken, `{}`); w.Code != http.StatusBadRequest {
		t.Fatalf("all names cleared: %d %s", w.Code, w.Body.String())
	}

	// A display-name collision with another game is a conflict.
	other := createGame("The Bottle Imp")
	if w := doJSON(t, router, http.MethodPatch, "/games/"+other.String(), editorToken, `{"name_ru":"Тень в бутылке"}`); w.Code != http.StatusConflict {
		t.Fatalf("collision: %d %s", w.Code, w.Body.String())
	}

	// The list endpoint carries the metadata for the admin page.
	w := doJSON(t, router, http.MethodGet, "/games", "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("list games: %d", w.Code)
	}
	var list struct {
		Data struct {
			Games []struct {
				Id     string  `json:"id"`
				Name   string  `json:"name"`
				Alias  *string `json:"alias"`
				NameRu *string `json:"name_ru"`
				BggRef *int    `json:"bgg_ref"`
			} `json:"games"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	var patched *struct {
		Id     string  `json:"id"`
		Name   string  `json:"name"`
		Alias  *string `json:"alias"`
		NameRu *string `json:"name_ru"`
		BggRef *int    `json:"bgg_ref"`
	}
	for i := range list.Data.Games {
		if list.Data.Games[i].Id == shortOf(t, game) {
			patched = &list.Data.Games[i]
		}
	}
	if patched == nil {
		t.Fatal("patched game missing from list")
	}
	if patched.Name != "Тень в бутылке" || patched.Alias != nil || patched.NameRu == nil || *patched.NameRu != "Тень в бутылке" || patched.BggRef == nil || *patched.BggRef != 12345 {
		t.Errorf("list item = %+v", patched)
	}
}

func TestCreateGameWithSuggestionMetadata(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	router := setupRouterWithTesera(pool, newTeseraStub(t).URL)
	editorToken, _ := createTestUserWithID(t, pool, true)

	// A custom typed name over accepted canonical names becomes the alias.
	gid := newID(t)
	body := fmt.Sprintf(`{"id":%q,"name":"Бутылочка","name_original":"The Bottle Imp","name_ru":"Тень в бутылке","bgg_ref":12345,"tesera_ref":555}`, gid.String())
	if w := doJSON(t, router, http.MethodPost, "/games", editorToken, body); w.Code != http.StatusOK {
		t.Fatalf("create with meta: %d %s", w.Code, w.Body.String())
	}

	// A typed name equal to the localized name is canonicalized, not aliased.
	gid2 := newID(t)
	body2 := fmt.Sprintf(`{"id":%q,"name":"тень в бутылке","name_original":"The Bottle Imp","name_ru":"Тень в бутылке"}`, gid2.String())
	if w := doJSON(t, router, http.MethodPost, "/games", editorToken, body2); w.Code != http.StatusOK {
		t.Fatalf("create canonical: %d %s", w.Code, w.Body.String())
	}

	q := db.New(pool)
	ctx := context.Background()
	got2, err := q.GetGameByID(ctx, gid2)
	if err != nil {
		t.Fatal(err)
	}
	if got2.Name != "Тень в бутылке" || got2.Alias.Valid {
		t.Errorf("canonical row = %+v, want display Тень в бутылке without alias", got2)
	}

	got, err := q.GetGameByID(ctx, gid)
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "Бутылочка" || !got.Alias.Valid || got.Alias.String != "Бутылочка" ||
		!got.NameRu.Valid || got.NameRu.String != "Тень в бутылке" ||
		!got.NameOriginal.Valid || got.NameOriginal.String != "The Bottle Imp" ||
		!got.BggID.Valid || got.BggID.Int32 != 12345 || !got.TeseraID.Valid || got.TeseraID.Int32 != 555 {
		t.Errorf("row = %+v", got)
	}
}
