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
		case strings.Contains(query, "старая"):
			rows = []map[string]any{
				// A Tesera entry that knows no BGG link (bggId 0 in the detail).
				{"type": "Game", "alias": "old-game", "teseraId": 888, "title": "Старая игра", "title2": "Old Game"},
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
		"old-game":          {"teseraId": 888, "bggId": 0, "title": "Старая игра", "title2": "Old Game", "isAddition": false},
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

// newBggSuggestStub serves /xmlapi2/search and /xmlapi2/thing the way BGG
// does for the suggestion flow. «Каркассон» resolves to Carcassonne (822) via
// its Russian alternate name and to the River expansion (4101); the thing for
// 822 carries several Russian spellings plus nothing disambiguating, so the
// script heuristics stay empty and the Tesera fallback fills the name.
// «бутыл» finds nothing on BGG — that query exercises the Tesera-only path.
// «eclipse» returns the exact base game, a flood of expansions, and the
// Second Dawn base game buried last — BGG's raw order must not decide what
// the user sees.
func newBggSuggestStub(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()

	mux.HandleFunc("/xmlapi2/search", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-token" {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte("Unauthorized"))
			return
		}
		query := strings.ToLower(r.URL.Query().Get("query"))
		items := ""
		if strings.Contains(query, "каркассон") {
			items = `<item type="boardgame" id="822">` +
				`<name type="alternate" value="Каркассон"/><yearpublished value="2000"/></item>` +
				`<item type="boardgame" id="4101">` +
				`<name type="primary" value="Carcassonne: The River"/><yearpublished value="2001"/></item>`
		} else if strings.Contains(query, "eclipse") {
			items = `<item type="boardgame" id="100"><name type="primary" value="Eclipse"/><yearpublished value="2011"/></item>` +
				`<item type="boardgame" id="101"><name type="primary" value="Eclipse: Rise of the Ancients"/><yearpublished value="2012"/></item>` +
				`<item type="boardgame" id="102"><name type="primary" value="Eclipse: Shadow of the Rift"/><yearpublished value="2015"/></item>` +
				`<item type="boardgame" id="103"><name type="primary" value="Eclipse: Ship Pack One"/><yearpublished value="2013"/></item>` +
				`<item type="boardgame" id="104"><name type="primary" value="Eclipse: Microcosm"/><yearpublished value="2017"/></item>` +
				`<item type="boardgame" id="105"><name type="primary" value="Eclipse: Nebula"/></item>` +
				`<item type="boardgame" id="106"><name type="primary" value="Quel Eclipse"/></item>` +
				`<item type="boardgame" id="246900"><name type="primary" value="Eclipse: Second Dawn for the Galaxy"/><yearpublished value="2020"/></item>`
		}
		w.Header().Set("Content-Type", "text/xml; charset=UTF-8")
		_, _ = w.Write([]byte(`<items total="0" termsofuse="https://boardgamegeek.com/xmlapi/termsofuse">` + items + `</items>`))
	})

	mux.HandleFunc("/xmlapi2/thing", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-token" {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte("Unauthorized"))
			return
		}
		var items strings.Builder
		for _, id := range strings.Split(r.URL.Query().Get("id"), ",") {
			switch id {
			case "822":
				items.WriteString(`<item type="boardgame" id="822">` +
					`<name type="primary" sortindex="1" value="Carcassonne"/>` +
					`<name type="alternate" sortindex="1" value="Каркасон"/>` +
					`<name type="alternate" sortindex="1" value="Каркассон"/>` +
					`<yearpublished value="2000"/>` +
					`<thumbnail>https://cf.geekdo-images.com/c__small/img/c.png</thumbnail></item>`)
			case "4101":
				items.WriteString(`<item type="boardgameexpansion" id="4101">` +
					`<name type="primary" sortindex="1" value="Carcassonne: The River"/>` +
					`<link type="boardgameexpansion" id="822" inbound="true" value="Carcassonne"/>` +
					`<yearpublished value="2001"/></item>`)
			case "100":
				items.WriteString(`<item type="boardgame" id="100">` +
					`<name type="primary" sortindex="1" value="Eclipse"/><yearpublished value="2011"/></item>`)
			case "101", "102", "103", "104", "105":
				items.WriteString(`<item type="boardgameexpansion" id="` + id + `">` +
					`<link type="boardgameexpansion" id="100" inbound="true" value="Eclipse"/></item>`)
			case "246900":
				// A base game lists its expansions with outbound links (the
				// Gamemat here) — that must NOT mark it an expansion.
				items.WriteString(`<item type="boardgame" id="246900">` +
					`<name type="primary" sortindex="1" value="Eclipse: Second Dawn for the Galaxy"/>` +
					`<link type="boardgameexpansion" id="375216" value="Eclipse: Second Dawn for the Galaxy – Gamemat"/>` +
					`<yearpublished value="2020"/></item>`)
			}
		}
		w.Header().Set("Content-Type", "text/xml; charset=UTF-8")
		_, _ = w.Write([]byte(`<items termsofuse="https://boardgamegeek.com/xmlapi/termsofuse">` + items.String() + `</items>`))
	})

	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server
}

// suggestion is the decoded suggestion row of the /games/suggestions answer.
type suggestion struct {
	TeseraRef  *int    `json:"tesera_ref"`
	BggRef     *int    `json:"bgg_ref"`
	NameRu     *string `json:"name_ru"`
	NameEn     *string `json:"name_en"`
	Title      string  `json:"title"`
	Year       *int    `json:"year"`
	IsAddition bool    `json:"is_addition"`
}

type suggestionsResponse struct {
	Data struct {
		Games             []suggestion `json:"games"`
		TeseraUnavailable *bool        `json:"tesera_unavailable"`
		BggUnavailable    *bool        `json:"bgg_unavailable"`
	} `json:"data"`
}

func TestGameSuggestionsEndpoint(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	teseraStub := newTeseraStub(t)
	bggStub := newBggSuggestStub(t)
	router := setupRouterWithClients(pool, teseraStub.URL, bggStub.URL)

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
	var resp suggestionsResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	if len(resp.Data.Games) != 2 {
		t.Fatalf("games = %+v, want the BGG base game and the expansion", resp.Data.Games)
	}
	if resp.Data.TeseraUnavailable != nil || resp.Data.BggUnavailable != nil {
		t.Errorf("flags must stay unset when both catalogues answer, got %+v", resp.Data)
	}
	// The BGG base game sorts first (the query equals its Tesera-provided
	// Russian title), the expansion follows, flagged from BGG's expansion
	// link. Both carry their Tesera ids — matched by the BGG id Tesera knows.
	g := resp.Data.Games[0]
	if g.TeseraRef == nil || *g.TeseraRef != 707 || g.BggRef == nil || *g.BggRef != 822 || g.IsAddition {
		t.Errorf("first candidate = %+v, want tesera 707 / bgg 822 / base game", g)
	}
	if g.NameEn == nil || *g.NameEn != "Carcassonne" || g.Title != "Carcassonne" {
		t.Errorf("names = %+v, want Carcassonne", g)
	}
	// The Russian name comes from the attached Tesera row — its curated
	// localization wins (BGG's alternates «Каркасон»/«Каркассон» are a
	// scoring tie anyway).
	if g.NameRu == nil || *g.NameRu != "Каркассон" {
		t.Errorf("name_ru = %+v, want the Tesera title Каркассон", g.NameRu)
	}
	river := resp.Data.Games[1]
	if river.TeseraRef == nil || *river.TeseraRef != 26664 || river.BggRef == nil || *river.BggRef != 4101 || !river.IsAddition {
		t.Errorf("second candidate = %+v, want the river expansion flagged", river)
	}

	// A query BGG does not know falls back to the Tesera-only row, which
	// still carries its BGG id.
	w = doJSON(t, router, http.MethodGet, "/games/suggestions?query="+url.QueryEscape("бутыл"), editorToken, "")
	if w.Code != http.StatusOK {
		t.Fatalf("tesera-only suggest: %d %s", w.Code, w.Body.String())
	}
	resp = suggestionsResponse{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	if len(resp.Data.Games) != 1 {
		t.Fatalf("games = %+v, want the single Tesera row", resp.Data.Games)
	}
	imp := resp.Data.Games[0]
	if imp.TeseraRef == nil || *imp.TeseraRef != 555 || imp.BggRef == nil || *imp.BggRef != 12345 ||
		imp.NameRu == nil || *imp.NameRu != "Тень в бутылке" || imp.NameEn == nil || *imp.NameEn != "The Bottle Imp" {
		t.Errorf("tesera-only candidate = %+v", imp)
	}
	if resp.Data.BggUnavailable != nil || resp.Data.TeseraUnavailable != nil {
		t.Errorf("absent-on-BGG is not an outage, got flags %+v/%+v", resp.Data.BggUnavailable, resp.Data.TeseraUnavailable)
	}
}

// A query like «eclipse» must surface the base games — the exact «Eclipse»
// and the prefix-matched «Eclipse: Second Dawn for the Galaxy» — ahead of the
// expansion flood, whatever order BGG's search returned (the fixture buries
// Second Dawn last).
func TestGameSuggestionsRankBaseGamesAboveExpansions(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	router := setupRouterWithClients(pool, newTeseraStub(t).URL, newBggSuggestStub(t).URL)
	editorToken, _ := createTestUserWithID(t, pool, true)

	w := doJSON(t, router, http.MethodGet, "/games/suggestions?query=eclipse", editorToken, "")
	if w.Code != http.StatusOK {
		t.Fatalf("suggest: %d %s", w.Code, w.Body.String())
	}
	var resp suggestionsResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	if len(resp.Data.Games) != 6 {
		t.Fatalf("games = %d rows, want the suggestResultLimit cap of 6: %+v", len(resp.Data.Games), resp.Data.Games)
	}
	if resp.Data.Games[0].Title != "Eclipse" || resp.Data.Games[0].IsAddition {
		t.Errorf("first = %+v, want the exact base game Eclipse", resp.Data.Games[0])
	}
	if resp.Data.Games[1].Title != "Eclipse: Second Dawn for the Galaxy" || resp.Data.Games[1].IsAddition {
		t.Errorf("second = %+v, want the prefix-matched base game", resp.Data.Games[1])
	}
	for i, g := range resp.Data.Games[2:] {
		if !g.IsAddition {
			t.Errorf("candidate %d %+v: the tail must be expansions", i+2, g)
		}
	}
}

// When the Tesera guard rejects the search, the answer degrades to the BGG
// rows with the flag set — and the guard's HTML body must not surface
// anywhere in the response.
func TestGameSuggestionsDegradeWhenTeseraGuarded(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	guard := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte("<!doctype html><html><head><title>DDoS-Guard</title></head></html>"))
	}))
	defer guard.Close()
	router := setupRouterWithClients(pool, guard.URL, newBggSuggestStub(t).URL)
	editorToken, _ := createTestUserWithID(t, pool, true)

	w := doJSON(t, router, http.MethodGet, "/games/suggestions?query="+url.QueryEscape("каркассон"), editorToken, "")
	if w.Code != http.StatusOK {
		t.Fatalf("guarded suggest: %d %s", w.Code, w.Body.String())
	}
	var resp suggestionsResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	if len(resp.Data.Games) != 2 {
		t.Fatalf("games = %+v, want the two BGG rows", resp.Data.Games)
	}
	g := resp.Data.Games[0]
	if g.BggRef == nil || *g.BggRef != 822 || g.TeseraRef != nil {
		t.Errorf("first candidate = %+v, want BGG-only", g)
	}
	// With Tesera gone, its Russian-name fallback is gone too.
	if resp.Data.TeseraUnavailable == nil || !*resp.Data.TeseraUnavailable {
		t.Errorf("tesera_unavailable = %+v, want true", resp.Data.TeseraUnavailable)
	}
	if resp.Data.BggUnavailable != nil {
		t.Errorf("bgg_unavailable must stay unset, got %+v", resp.Data.BggUnavailable)
	}
	for _, leak := range []string{"DDoS", "<html", "<body"} {
		if strings.Contains(w.Body.String(), leak) {
			t.Errorf("response leaks guard HTML (%q): %s", leak, w.Body.String())
		}
	}
}

// When BGG fails, the Tesera rows carry the answer and the flag explains it.
func TestGameSuggestionsDegradeWhenBggUnavailable(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	broken := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte("Unauthorized"))
	}))
	defer broken.Close()
	router := setupRouterWithClients(pool, newTeseraStub(t).URL, broken.URL)
	editorToken, _ := createTestUserWithID(t, pool, true)

	w := doJSON(t, router, http.MethodGet, "/games/suggestions?query="+url.QueryEscape("каркассон"), editorToken, "")
	if w.Code != http.StatusOK {
		t.Fatalf("bgg-outage suggest: %d %s", w.Code, w.Body.String())
	}
	var resp suggestionsResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	if len(resp.Data.Games) != 2 {
		t.Fatalf("games = %+v, want the two Tesera rows", resp.Data.Games)
	}
	g := resp.Data.Games[0]
	if g.TeseraRef == nil || *g.TeseraRef != 707 || g.NameRu == nil || *g.NameRu != "Каркассон" {
		t.Errorf("first candidate = %+v, want the Tesera row with its Russian title", g)
	}
	if resp.Data.BggUnavailable == nil || !*resp.Data.BggUnavailable {
		t.Errorf("bgg_unavailable = %+v, want true", resp.Data.BggUnavailable)
	}
	if resp.Data.TeseraUnavailable != nil {
		t.Errorf("tesera_unavailable must stay unset, got %+v", resp.Data.TeseraUnavailable)
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
	patch := `{"alias":"Бутылочка","name_en":"The Bottle Imp","name_ru":"Тень в бутылке","bgg_ref":12345,"tesera_ref":555}`
	if w := doJSON(t, router, http.MethodPatch, "/games/"+game.String(), editorToken, patch); w.Code != http.StatusOK {
		t.Fatalf("patch metadata: %d %s", w.Code, w.Body.String())
	}

	// Removing the alias falls the display back to the localized name.
	if w := doJSON(t, router, http.MethodPatch, "/games/"+game.String(), editorToken, `{"name_en":"The Bottle Imp","name_ru":"Тень в бутылке","bgg_ref":12345,"tesera_ref":555}`); w.Code != http.StatusOK {
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
	body := fmt.Sprintf(`{"id":%q,"name":"Бутылочка","name_en":"The Bottle Imp","name_ru":"Тень в бутылке","bgg_ref":12345,"tesera_ref":555}`, gid.String())
	if w := doJSON(t, router, http.MethodPost, "/games", editorToken, body); w.Code != http.StatusOK {
		t.Fatalf("create with meta: %d %s", w.Code, w.Body.String())
	}

	// A typed name equal to the localized name is canonicalized, not aliased.
	gid2 := newID(t)
	body2 := fmt.Sprintf(`{"id":%q,"name":"тень в бутылке","name_en":"The Bottle Imp","name_ru":"Тень в бутылке"}`, gid2.String())
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
		!got.NameEn.Valid || got.NameEn.String != "The Bottle Imp" ||
		!got.BggID.Valid || got.BggID.Int32 != 12345 || !got.TeseraID.Valid || got.TeseraID.Int32 != 555 {
		t.Errorf("row = %+v", got)
	}
}
