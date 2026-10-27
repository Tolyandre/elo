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
	"github.com/tolyandre/elo-web-service/pkg/elo"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

const (
	bottleImpImage  = "https://cf.geekdo-images.com/x__original/img/b.png"
	bottleImpThumb  = "https://cf.geekdo-images.com/x__small/img/b.png"
	secondDawnImage = "https://cf.geekdo-images.com/x__original/img/eclipse.png"
	secondDawnThumb = "https://cf.geekdo-images.com/x__small/img/eclipse.png"
	gamematImage    = "https://cf.geekdo-images.com/x__original/img/gamemat.png"
	gamematThumb    = "https://cf.geekdo-images.com/x__small/img/gamemat.png"
)

// newBggStub serves /xmlapi2/thing the way BGG does for the ids the art tests
// use: 12345 ("The Bottle Imp") carries box art, 246900 ("Eclipse: Second
// Dawn for the Galaxy") carries its own (and answers slowly, so tests can
// observe the cleared-images window after a bgg_id change before the
// background refill lands), 375216 (the Second Dawn Gamemat expansion) and
// 999 ("Другая игра") round out the cases, and anything else is simply
// absent from the response. The token is checked because the real API
// requires it. A type-scoped request fails the test: BGG filters /thing by
// subtype, and exact-id lookups must not lose expansion things.
func newBggStub(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/xmlapi2/thing", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-token" {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte("Unauthorized"))
			return
		}
		if r.URL.Query().Get("type") != "" {
			t.Errorf("thing request carries a type filter (%q): BGG would drop expansion things from the answer", r.URL.RawQuery)
		}
		ids := r.URL.Query().Get("id")
		if strings.Contains(ids, "246900") {
			time.Sleep(300 * time.Millisecond)
		}
		var items strings.Builder
		for _, id := range strings.Split(ids, ",") {
			switch id {
			case "12345":
				items.WriteString(`<item type="boardgame" id="12345">` +
					`<thumbnail>` + bottleImpThumb + `</thumbnail>` +
					`<image>` + bottleImpImage + `</image>` +
					`<name type="primary" sortindex="1" value="The Bottle Imp"/></item>`)
			case "246900":
				items.WriteString(`<item type="boardgame" id="246900">` +
					`<thumbnail>` + secondDawnThumb + `</thumbnail>` +
					`<image>` + secondDawnImage + `</image>` +
					`<name type="primary" sortindex="1" value="Eclipse: Second Dawn for the Galaxy"/></item>`)
			case "375216":
				items.WriteString(`<item type="boardgameexpansion" id="375216">` +
					`<thumbnail>` + gamematThumb + `</thumbnail>` +
					`<image>` + gamematImage + `</image>` +
					`<name type="primary" sortindex="1" value="Eclipse: Second Dawn for the Galaxy – Gamemat"/>` +
					`<link type="boardgameexpansion" id="246900" inbound="true" value="Eclipse: Second Dawn for the Galaxy"/></item>`)
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

// seedGameWithBgg note: games for the art endpoints are seeded via db.AddGame
// directly — the create endpoint would fire its own background enrichment and
// race the endpoint call under test.
func seedGameWithBgg(t *testing.T, q *db.Queries, nameEn string, bggID int64) idpkg.ID {
	t.Helper()
	gid := newID(t)
	params := db.AddGameParams{ID: gid, NameEn: pgtype.Text{String: nameEn, Valid: true}, GameMode: elo.GameModeCompetitive}
	if bggID != 0 {
		params.BggID = pgtype.Int4{Int32: int32(bggID), Valid: true}
	}
	if _, err := q.AddGame(context.Background(), params); err != nil {
		t.Fatalf("seed game %q: %v", nameEn, err)
	}
	return gid
}

func setArt(t *testing.T, q *db.Queries, gameID idpkg.ID, image, thumb string) {
	t.Helper()
	if _, err := q.UpdateGameBggImages(context.Background(), db.UpdateGameBggImagesParams{
		ID:            gameID,
		ImageUrl:      pgtype.Text{String: image, Valid: true},
		ImageThumbUrl: pgtype.Text{String: thumb, Valid: true},
	}); err != nil {
		t.Fatalf("seed art: %v", err)
	}
}

type refreshArtResponse struct {
	Data struct {
		Id            string  `json:"id"`
		Name          string  `json:"name"`
		Refreshed     bool    `json:"refreshed"`
		ImageUrl      *string `json:"image_url"`
		ImageThumbUrl *string `json:"image_thumb_url"`
		Reason        *string `json:"reason"`
	} `json:"data"`
}

func TestRefreshGameArtEndpoint(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	router := setupRouterWithClients(pool, "", newBggStub(t).URL)
	editorToken, _ := createTestUserWithID(t, pool, true)
	viewerToken, _ := createTestUserWithID(t, pool, false)

	q := db.New(pool)
	ctx := context.Background()
	withArt := seedGameWithBgg(t, q, "The Bottle Imp", 12345)
	// Stale art from an old BGG id: the refresh must overwrite it.
	setArt(t, q, withArt, "https://cdn.example/stale.png", "https://cdn.example/stale-t.png")
	noImage := seedGameWithBgg(t, q, "Другая игра", 999)
	setArt(t, q, noImage, "https://cdn.example/keep.png", "https://cdn.example/keep-t.png")
	unknown := seedGameWithBgg(t, q, "Несуществующая на BGG", 555)
	noRef := seedGameWithBgg(t, q, "Без ссылки", 0)
	// An expansion thing: its art must refresh too (BGG drops expansion
	// things from type-scoped lookups — the Gamemat case).
	gamemat := seedGameWithBgg(t, q, "Eclipse: Second Dawn Gamemat", 375216)

	path := func(id idpkg.ID) string { return "/games/" + id.String() + "/bgg-refresh-art" }
	if w := doJSON(t, router, http.MethodPost, path(withArt), "", ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated: %d %s", w.Code, w.Body.String())
	}
	if w := doJSON(t, router, http.MethodPost, path(withArt), viewerToken, ""); w.Code != http.StatusForbidden {
		t.Fatalf("non-editor: %d %s", w.Code, w.Body.String())
	}
	if w := doJSON(t, router, http.MethodPost, path(newID(t)), editorToken, ""); w.Code != http.StatusNotFound {
		t.Fatalf("unknown game: %d %s", w.Code, w.Body.String())
	}
	if w := doJSON(t, router, http.MethodPost, path(noRef), editorToken, ""); w.Code != http.StatusBadRequest {
		t.Fatalf("no bgg ref: %d %s", w.Code, w.Body.String())
	}

	// A successful refresh overwrites the stored art.
	w := doJSON(t, router, http.MethodPost, path(withArt), editorToken, "")
	if w.Code != http.StatusOK {
		t.Fatalf("refresh: %d %s", w.Code, w.Body.String())
	}
	var resp refreshArtResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	if !resp.Data.Refreshed || resp.Data.Reason != nil ||
		resp.Data.ImageUrl == nil || *resp.Data.ImageUrl != bottleImpImage ||
		resp.Data.ImageThumbUrl == nil || *resp.Data.ImageThumbUrl != bottleImpThumb {
		t.Errorf("refresh result = %+v, want refreshed with the new URLs", resp.Data)
	}
	got, err := q.GetGameByID(ctx, withArt)
	if err != nil {
		t.Fatal(err)
	}
	if !got.ImageUrl.Valid || got.ImageUrl.String != bottleImpImage || !got.ImageThumbUrl.Valid || got.ImageThumbUrl.String != bottleImpThumb {
		t.Errorf("stored images = %v / %v, want the stub's Bottle Imp art", got.ImageUrl, got.ImageThumbUrl)
	}

	// Refreshing again serves the same art: nothing changes, the response
	// reports it instead of claiming a refresh, and no audit row appears.
	w = doJSON(t, router, http.MethodPost, path(withArt), editorToken, "")
	if w.Code != http.StatusOK {
		t.Fatalf("second refresh: %d %s", w.Code, w.Body.String())
	}
	resp = refreshArtResponse{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Data.Refreshed || resp.Data.Reason == nil || *resp.Data.Reason != "unchanged" {
		t.Errorf("unchanged result = %+v, want refreshed=false with reason \"unchanged\"", resp.Data)
	}
	var audits int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM audit_log WHERE entity_type = 'game' AND entity_id = $1`, withArt).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if audits != 1 {
		t.Errorf("audit rows = %d after refresh + unchanged re-refresh, want 1 (the real change only)", audits)
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
		if game.Data.ImageUrl == nil || *game.Data.ImageUrl != bottleImpImage {
			t.Errorf("game read images = %+v", game.Data)
		}
	}

	// A thing without art reports the reason and leaves the stored URLs be.
	w = doJSON(t, router, http.MethodPost, path(noImage), editorToken, "")
	if w.Code != http.StatusOK {
		t.Fatalf("no-image refresh: %d %s", w.Code, w.Body.String())
	}
	resp = refreshArtResponse{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Data.Refreshed || resp.Data.Reason == nil || *resp.Data.Reason != "no image on BGG" {
		t.Errorf("no-image result = %+v, want reason", resp.Data)
	}
	got, err = q.GetGameByID(ctx, noImage)
	if err != nil {
		t.Fatal(err)
	}
	if !got.ImageUrl.Valid || got.ImageUrl.String != "https://cdn.example/keep.png" {
		t.Errorf("no-image stored art = %v, want untouched", got.ImageUrl)
	}

	// An id BGG does not know reports it too.
	w = doJSON(t, router, http.MethodPost, path(unknown), editorToken, "")
	if w.Code != http.StatusOK {
		t.Fatalf("not-found refresh: %d %s", w.Code, w.Body.String())
	}
	resp = refreshArtResponse{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Data.Refreshed || resp.Data.Reason == nil || *resp.Data.Reason != "not found on BGG" {
		t.Errorf("not-found result = %+v, want reason", resp.Data)
	}

	// An expansion's art refreshes just like a base game's.
	w = doJSON(t, router, http.MethodPost, path(gamemat), editorToken, "")
	if w.Code != http.StatusOK {
		t.Fatalf("expansion refresh: %d %s", w.Code, w.Body.String())
	}
	resp = refreshArtResponse{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if !resp.Data.Refreshed || resp.Data.ImageUrl == nil || *resp.Data.ImageUrl != gamematImage {
		t.Errorf("expansion result = %+v, want refreshed with the Gamemat art", resp.Data)
	}

	// Without the BGG integration configured the endpoint refuses with 503.
	noBggRouter := setupRouterWithClients(pool, "", "")
	if w := doJSON(t, noBggRouter, http.MethodPost, path(withArt), editorToken, ""); w.Code != http.StatusServiceUnavailable {
		t.Fatalf("bgg unconfigured: %d %s", w.Code, w.Body.String())
	}
}

// A metadata PATCH that changes the BGG id clears the stored art in the same
// transaction and the background fetch refills it from the new id; an
// unchanged id leaves the art alone.
func TestPatchGameBggChangeClearsAndReplenishesArt(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	router := setupRouterWithClients(pool, "", newBggStub(t).URL)
	editorToken, _ := createTestUserWithID(t, pool, true)

	q := db.New(pool)
	ctx := context.Background()
	game := seedGameWithBgg(t, q, "The Bottle Imp", 12345)
	setArt(t, q, game, bottleImpImage, bottleImpThumb)

	// Same BGG id: the patch must not touch the art.
	patch := `{"name_en":"The Bottle Imp","bgg_ref":12345}`
	if w := doJSON(t, router, http.MethodPatch, "/games/"+game.String(), editorToken, patch); w.Code != http.StatusOK {
		t.Fatalf("patch same id: %d %s", w.Code, w.Body.String())
	}
	got, err := q.GetGameByID(ctx, game)
	if err != nil {
		t.Fatal(err)
	}
	if !got.ImageUrl.Valid || got.ImageUrl.String != bottleImpImage {
		t.Errorf("art after same-id patch = %v, want untouched", got.ImageUrl)
	}

	// A changed id clears both columns at once; the stub delays the thing
	// answer for 246900, so the cleared window is observable.
	patch = `{"name_en":"Eclipse: Second Dawn for the Galaxy","bgg_ref":246900}`
	if w := doJSON(t, router, http.MethodPatch, "/games/"+game.String(), editorToken, patch); w.Code != http.StatusOK {
		t.Fatalf("patch changed id: %d %s", w.Code, w.Body.String())
	}
	got, err = q.GetGameByID(ctx, game)
	if err != nil {
		t.Fatal(err)
	}
	if got.ImageUrl.Valid || got.ImageThumbUrl.Valid {
		t.Errorf("art right after id change = %v / %v, want cleared", got.ImageUrl, got.ImageThumbUrl)
	}

	// The background fetch then stores the new id's art.
	deadline := time.Now().Add(5 * time.Second)
	for {
		got, err = q.GetGameByID(ctx, game)
		if err != nil {
			t.Fatal(err)
		}
		if got.ImageUrl.Valid {
			if got.ImageUrl.String != secondDawnImage || !got.ImageThumbUrl.Valid || got.ImageThumbUrl.String != secondDawnThumb {
				t.Errorf("refilled art = %v / %v, want the Second Dawn URLs", got.ImageUrl, got.ImageThumbUrl)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("background enrichment never stored the new image URL")
		}
		time.Sleep(20 * time.Millisecond)
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
			if got.ImageUrl.String != bottleImpImage {
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
