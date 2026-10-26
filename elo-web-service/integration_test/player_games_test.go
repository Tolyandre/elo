//go:build integration

package integration_test

// The player game collection ("Коллекция игр"): public read; writes are
// editor-gated like every other write — any user with the edit permission may
// manage any shelf (each real change lands one player-collection audit event).
// Add/remove are idempotent (ON CONFLICT DO NOTHING / missing-row DELETE, and
// a replay records no audit event); unknown player or game is a foreign-key
// violation the handler maps to 400.

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/elo"
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

	// The linked user without the edit permission: users.player_id points at
	// the profile's player, but the shelf is no longer theirs alone — managing
	// it needs the edit permission, which they lack.
	myToken, myUserID := createTestUserWithID(t, pool, false)
	if err := q.UpdateUserPlayerID(ctx, db.UpdateUserPlayerIDParams{ID: idpkg.ID(myUserID), PlayerID: &player}); err != nil {
		t.Fatalf("link my player: %v", err)
	}
	// Another authenticated non-editor linked to a different player.
	otherToken, otherUserID := createTestUserWithID(t, pool, false)
	other := createTestPlayer(t, pool, "Посторонний")
	if err := q.UpdateUserPlayerID(ctx, db.UpdateUserPlayerIDParams{ID: idpkg.ID(otherUserID), PlayerID: &other}); err != nil {
		t.Fatalf("link other player: %v", err)
	}
	// An editor linked to nobody — the one who may manage any shelf.
	editorToken, _ := createTestUserWithID(t, pool, true)

	// Anonymous GET reads the (empty) collection — no 401 on reads.
	if code, data := getCollection(t, router, "/players/"+player.String()+"/collection", ""); code != http.StatusOK || data == nil || data.Total != 0 {
		t.Fatalf("anonymous GET = %d, %+v; want 200 with empty collection", code, data)
	}

	// Writes are closed to the anonymous and the non-editors — the linked user
	// included: the gate is the edit permission, not the player link.
	for _, tc := range []struct{ name, token string }{
		{"anonymous", ""},
		{"linked non-editor", myToken},
		{"foreign non-editor", otherToken},
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

	// The editor (a stranger to this player) adds two games; a duplicate add is
	// an idempotent no-op.
	for _, game := range []idpkg.ID{g2, g1, g1} {
		w := doJSON(t, router, http.MethodPost, "/players/"+player.String()+"/collection", editorToken, `{"game_id":"`+game.String()+`"}`)
		if w.Code != http.StatusOK {
			t.Fatalf("editor POST %s = %d: %s", game, w.Code, w.Body.String())
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
	w := doJSON(t, router, http.MethodPost, "/players/"+player.String()+"/collection", editorToken, `{"game_id":"`+g3.String()+`"}`)
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

	// Coop matches count too (ADR-33 participants land in match_scores with
	// zero scores): a single coop play of «Гостевая игра» puts it second.
	g4 := createCoopTestGame(t, pool, "Гостевая игра")
	addCoopMatchDaysAgo(t, ctx, pool, g4, 1, []idpkg.ID{player, guest})
	w = doJSON(t, router, http.MethodPost, "/players/"+player.String()+"/collection", editorToken, `{"game_id":"`+g4.String()+`"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("linked POST %s = %d: %s", g4, w.Code, w.Body.String())
	}
	code, data = getCollection(t, router, "/players/"+player.String()+"/collection", "")
	if code != http.StatusOK || len(data.Games) != 4 {
		t.Fatalf("after coop add: len=%d, want 4", len(data.Games))
	}
	if data.Games[0].Name != "Вечерняя игра" || data.Games[0].MatchesCount != 2 {
		t.Fatalf("first = %s (%d plays), want Вечерняя игра (2)", data.Games[0].Name, data.Games[0].MatchesCount)
	}
	if data.Games[1].Name != "Гостевая игра" || data.Games[1].MatchesCount != 1 {
		t.Fatalf("second = %s (%d plays), want Гостевая игра (1 coop play)", data.Games[1].Name, data.Games[1].MatchesCount)
	}

	// Remove empties the shelf again; removing a non-member is a no-op (and
	// records no audit event).
	for _, game := range []idpkg.ID{g1, g3, g3} {
		w := doJSON(t, router, http.MethodDelete, "/players/"+player.String()+"/collection/"+game.String(), editorToken, "")
		if w.Code != http.StatusOK {
			t.Fatalf("editor DELETE %s = %d: %s", game, w.Code, w.Body.String())
		}
	}
	if code, data := getCollection(t, router, "/players/"+player.String()+"/collection", ""); code != http.StatusOK || data.Total != 2 || len(data.Games) != 2 {
		t.Fatalf("after removes: total=%d len=%d, want 2/2 (Библиотечная + Гостевая remain)", data.Total, len(data.Games))
	}

	// Unknown references fail: a missing player is a 404 (same as the public
	// GET), a missing game a foreign-key 400.
	w = doJSON(t, router, http.MethodPost, "/players/"+player.String()+"/collection", editorToken, `{"game_id":"`+newID(t).String()+`"}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("unknown game POST = %d, want 400", w.Code)
	}
	w = doJSON(t, router, http.MethodPost, "/players/"+newID(t).String()+"/collection", editorToken, `{"game_id":"`+g1.String()+`"}`)
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

	// The audit trail: every real change appended one player-collection event
	// naming the game (id + display title at modification time); the denied
	// writes, the duplicate add, the replayed remove and the unknown-game FK
	// 400 recorded nothing. Six real changes happened above, latest first:
	// remove Вечерняя, remove Абстрактная, add Гостевая, add Вечерняя,
	// add Абстрактная, add Библиотечная.
	page := listAudit(t, router, "?entity_type=player&entity_id="+shortOf(t, player))
	var collectionEvents []auditEntryJSON
	for _, e := range page.Data {
		if e.Action == "updated" && len(e.Details) > 0 {
			var probe struct {
				Op string `json:"op"`
			}
			if json.Unmarshal(e.Details, &probe) == nil && probe.Op != "" {
				collectionEvents = append(collectionEvents, e)
			}
		}
	}
	if len(collectionEvents) != 6 {
		t.Fatalf("player-collection audit events = %d, want 6: %+v", len(collectionEvents), page.Data)
	}
	type collectionDetails struct {
		SchemaVersion int    `json:"schema_version"`
		Op            string `json:"op"`
		GameID        string `json:"game_id"`
		GameTitle     string `json:"game_title"`
	}
	want := []struct {
		op    string
		game  idpkg.ID
		title string
	}{
		{"remove", g3, "Вечерняя игра"},
		{"remove", g1, "Абстрактная игра"},
		{"add", g4, "Гостевая игра"},
		{"add", g3, "Вечерняя игра"},
		{"add", g1, "Абстрактная игра"},
		{"add", g2, "Библиотечная игра"},
	}
	for i, w := range want {
		var d collectionDetails
		if err := json.Unmarshal(collectionEvents[i].Details, &d); err != nil {
			t.Fatalf("event %d details: %v (%s)", i, err, collectionEvents[i].Details)
		}
		if d.Op != w.op || d.GameID != shortOf(t, w.game) || d.GameTitle != w.title {
			t.Errorf("event %d = op %s game %s title %q, want %s %s %q", i, d.Op, d.GameID, d.GameTitle, w.op, shortOf(t, w.game), w.title)
		}
		if d.SchemaVersion != 1 {
			t.Errorf("event %d schema_version = %d, want 1", i, d.SchemaVersion)
		}
		if collectionEvents[i].EntityID != shortOf(t, player) || collectionEvents[i].EntityType != "player" {
			t.Errorf("event %d points at %s/%s, want player %s", i, collectionEvents[i].EntityType, collectionEvents[i].EntityID, shortOf(t, player))
		}
	}
	if collectionEvents[0].ActorName != "Test User With ID" {
		t.Errorf("actor = %q, want the editor", collectionEvents[0].ActorName)
	}
}

// createCoopTestGame inserts a coop-only game (the mode decides itself, ADR-33).
func createCoopTestGame(t *testing.T, pool *pgxpool.Pool, name string) idpkg.ID {
	t.Helper()
	q := db.New(pool)
	id := newID(t)
	g, err := q.AddGame(context.Background(), db.AddGameParams{ID: id, NameEn: pgText(name), GameMode: elo.GameModeCoop})
	if err != nil {
		t.Fatalf("create coop game %q: %v", name, err)
	}
	return g.ID
}

// addCoopMatchDaysAgo mirrors addMatchDaysAgo for a coop game: participants as
// plain ids (they land in match_scores with zero scores — ADR-33), the shared
// result on the match row.
func addCoopMatchDaysAgo(t *testing.T, ctx context.Context, pool *pgxpool.Pool, game idpkg.ID, daysAgo int, playerIDs []idpkg.ID) {
	t.Helper()
	date := time.Now().UTC().AddDate(0, 0, -daysAgo)
	score, won := 3.0, true
	if _, err := newMatchService(pool).AddMatch(ctx, blueMenTenantID, game, nil, date, elo.AddMatchOpts{
		ID:        newID(t),
		Mode:      elo.MatchModeCoop,
		PlayerIDs: playerIDs,
		GameScore: &score,
		GameWon:   &won,
	}); err != nil {
		t.Fatalf("AddCoopMatch %v %d days ago: %v", game, daysAgo, err)
	}
}
