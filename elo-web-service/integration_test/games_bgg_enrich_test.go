//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

// newBggStub serves /xmlapi2/thing the way BGG does for the ids the enrich
// tests use: 12345 ("The Bottle Imp") carries box art, 999 ("Другая игра")
// has no image elements at all, and anything else is simply absent from the
// response. The token is checked because the real API requires it.
func newBggStub(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/xmlapi2/thing", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-token" {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte("Unauthorized"))
			return
		}
		var items strings.Builder
		for _, id := range strings.Split(r.URL.Query().Get("id"), ",") {
			switch id {
			case "12345":
				items.WriteString(`<item type="boardgame" id="12345">` +
					`<thumbnail>https://cf.geekdo-images.com/x__small/img/b.png</thumbnail>` +
					`<image>https://cf.geekdo-images.com/x__original/img/b.png</image>` +
					`<name type="primary" sortindex="1" value="The Bottle Imp"/></item>`)
			case "999":
				items.WriteString(`<item type="boardgame" id="999">` +
					`<name type="primary" sortindex="1" value="Другая игра"/></item>`)
			}
		}
		w.Header().Set("Content-Type", "text/xml; charset=UTF-8")
		_, _ = w.Write([]byte(`<items termsofuse="https://boardgamegeek.com/xmlapi/termsofuse">` + items.String() + `</items>`))
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server
}

// seedGameWithBgg note: games for the enrich endpoint are seeded via
// db.AddGame directly — the create endpoint would fire its own background
// enrichment and race the endpoint call under test.

func TestBggEnrichEndpoint(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	router := setupRouterWithClients(pool, "", newBggStub(t).URL)
	editorToken, _ := createTestUserWithID(t, pool, true)
	viewerToken, _ := createTestUserWithID(t, pool, false)

	q := db.New(pool)
	ctx := context.Background()
	addGame := func(nameEn string, bggID int64) idpkg.ID {
		t.Helper()
		gid := newID(t)
		params := db.AddGameParams{ID: gid, NameEn: pgtype.Text{String: nameEn, Valid: true}}
		if bggID != 0 {
			params.BggID = pgtype.Int4{Int32: int32(bggID), Valid: true}
		}
		if _, err := q.AddGame(ctx, params); err != nil {
			t.Fatalf("seed game %q: %v", nameEn, err)
		}
		return gid
	}
	withArt := addGame("The Bottle Imp", 12345)
	noImage := addGame("Другая игра", 999)
	unknown := addGame("Несуществующая на BGG", 555)
	addGame("Без ссылки", 0)

	path := "/games/bgg-enrich"
	if w := doJSON(t, router, http.MethodPost, path, "", ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated: %d %s", w.Code, w.Body.String())
	}
	if w := doJSON(t, router, http.MethodPost, path, viewerToken, ""); w.Code != http.StatusForbidden {
		t.Fatalf("non-editor: %d %s", w.Code, w.Body.String())
	}

	w := doJSON(t, router, http.MethodPost, path, editorToken, "")
	if w.Code != http.StatusOK {
		t.Fatalf("enrich: %d %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data struct {
			Games []struct {
				Id       string  `json:"id"`
				Name     string  `json:"name"`
				Enriched bool    `json:"enriched"`
				Reason   *string `json:"reason"`
			} `json:"games"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}

	type result struct {
		Enriched bool
		Reason   string
	}
	byID := map[string]result{}
	for _, g := range resp.Data.Games {
		byID[g.Id] = result{Enriched: g.Enriched}
		if g.Reason != nil {
			byID[g.Id] = result{Enriched: g.Enriched, Reason: *g.Reason}
		}
	}
	// The game without a BGG reference is not part of the run at all.
	if len(resp.Data.Games) != 3 {
		t.Errorf("games = %+v, want the three with a bgg_ref", resp.Data.Games)
	}
	if r := byID[shortOf(t, withArt)]; !r.Enriched || r.Reason != "" {
		t.Errorf("The Bottle Imp = %+v, want enriched", r)
	}
	if r := byID[shortOf(t, noImage)]; r.Enriched || r.Reason != "no image on BGG" {
		t.Errorf("Другая игра = %+v, want \"no image on BGG\"", r)
	}
	if r := byID[shortOf(t, unknown)]; r.Enriched || r.Reason != "not found on BGG" {
		t.Errorf("Несуществующая = %+v, want \"not found on BGG\"", r)
	}

	got, err := q.GetGameByID(ctx, withArt)
	if err != nil {
		t.Fatal(err)
	}
	if !got.ImageUrl.Valid || got.ImageUrl.String != "https://cf.geekdo-images.com/x__original/img/b.png" ||
		!got.ImageThumbUrl.Valid || got.ImageThumbUrl.String != "https://cf.geekdo-images.com/x__small/img/b.png" {
		t.Errorf("images = %v / %v", got.ImageUrl, got.ImageThumbUrl)
	}

	// The single-game read carries the URLs for the game page.
	if w := doJSON(t, router, http.MethodGet, "/games/"+withArt.String(), "", ""); w.Code != http.StatusOK {
		t.Fatalf("get game: %d %s", w.Code, w.Body.String())
	} else {
		var game struct {
			Data struct {
				ImageUrl      *string `json:"image_url"`
				ImageThumbUrl *string `json:"image_thumb_url"`
			} `json:"data"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &game); err != nil {
			t.Fatal(err)
		}
		if game.Data.ImageUrl == nil || game.Data.ImageThumbUrl == nil {
			t.Errorf("game read images = %+v", game.Data)
		}
	}

	// A second run revisits only the games still missing both URLs.
	w = doJSON(t, router, http.MethodPost, path, editorToken, "")
	if w.Code != http.StatusOK {
		t.Fatalf("second enrich: %d %s", w.Code, w.Body.String())
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Data.Games) != 2 {
		t.Errorf("second run games = %+v, want the two still-imageless rows", resp.Data.Games)
	}
}

func TestCreateGameSchedulesBggEnrich(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	router := setupRouterWithClients(pool, "", newBggStub(t).URL)
	editorToken, _ := createTestUserWithID(t, pool, true)

	gid := newID(t)
	body := fmt.Sprintf(`{"id":%q,"name":"Бутылочка","name_en":"The Bottle Imp","bgg_ref":12345}`, gid.String())
	if w := doJSON(t, router, http.MethodPost, "/games", editorToken, body); w.Code != http.StatusOK {
		t.Fatalf("create game: %d %s", w.Code, w.Body.String())
	}

	// The create path enriches in the background; poll for the stored URLs.
	q := db.New(pool)
	deadline := time.Now().Add(5 * time.Second)
	for {
		got, err := q.GetGameByID(context.Background(), gid)
		if err != nil {
			t.Fatal(err)
		}
		if got.ImageUrl.Valid {
			if got.ImageUrl.String != "https://cf.geekdo-images.com/x__original/img/b.png" {
				t.Errorf("image_url = %q", got.ImageUrl.String)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("background enrichment never stored the image URL")
		}
		time.Sleep(20 * time.Millisecond)
	}
}
