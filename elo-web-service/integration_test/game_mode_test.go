//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/elo"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

// gameModeJSON is the /games/{id} response envelope.
type gameModeJSON struct {
	Data struct {
		Id       string `json:"id"`
		Name     string `json:"name"`
		GameMode string `json:"game_mode"`
	} `json:"data"`
}

// matchModeJSON is one element of the /matches list.
type matchModeJSON struct {
	Id        string   `json:"id"`
	Mode      string   `json:"mode"`
	GameScore *float64 `json:"game_score"`
	GameWon   *bool    `json:"game_won"`
	Score     map[string]struct {
		Score float64 `json:"score"`
	} `json:"score"`
}

// coopFeedEvent is one home-feed element with the coop fields.
type coopFeedEvent struct {
	Type string `json:"type"`
	Data struct {
		Id        string   `json:"id"`
		Mode      string   `json:"mode"`
		GameScore *float64 `json:"game_score"`
		GameWon   *bool    `json:"game_won"`
	} `json:"data"`
}

func createGameWithMode(t *testing.T, router interface {
	ServeHTTP(http.ResponseWriter, *http.Request)
}, token, name, mode string) idpkg.ID {
	t.Helper()
	gid := newID(t)
	body := fmt.Sprintf(`{"id":%q,"name":%q`, gid.String(), name)
	if mode != "" {
		body += fmt.Sprintf(`,"game_mode":%q`, mode)
	}
	body += "}"
	w := doJSON(t, router, http.MethodPost, "/games", token, body)
	if w.Code != http.StatusOK {
		t.Fatalf("create game %q (mode %q): %d %s", name, mode, w.Code, w.Body.String())
	}
	return gid
}

func getGameMode(t *testing.T, router interface {
	ServeHTTP(http.ResponseWriter, *http.Request)
}, gid idpkg.ID) string {
	t.Helper()
	w := doJSON(t, router, http.MethodGet, "/games/"+gid.String(), "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("get game: %d %s", w.Code, w.Body.String())
	}
	var parsed gameModeJSON
	if err := json.Unmarshal(w.Body.Bytes(), &parsed); err != nil {
		t.Fatal(err)
	}
	return parsed.Data.GameMode
}

func listMatchesModes(t *testing.T, router interface {
	ServeHTTP(http.ResponseWriter, *http.Request)
}, query string) []matchModeJSON {
	t.Helper()
	w := doJSON(t, router, http.MethodGet, "/matches?tenant="+blueMenTenantUUID+"&"+query, "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("list matches: %d %s", w.Code, w.Body.String())
	}
	var parsed struct {
		Data []matchModeJSON `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &parsed); err != nil {
		t.Fatal(err)
	}
	return parsed.Data
}

// coopMatchBody builds a POST /matches body for a coop match; extra carries
// additional JSON object members (comma-prefixed pieces or "").
func coopMatchBody(matchID, gameID idpkg.ID, players []idpkg.ID, extra string) string {
	body := fmt.Sprintf(`{"id":%q,"game_id":%q,"mode":"coop","player_ids":[`, matchID.String(), gameID.String())
	for i, p := range players {
		if i > 0 {
			body += ","
		}
		body += fmt.Sprintf("%q", p.String())
	}
	body += "]"
	if extra != "" {
		body += "," + extra
	}
	return body + "}"
}

func decodeCoopFeedPage(t *testing.T, router interface {
	ServeHTTP(http.ResponseWriter, *http.Request)
}, path string) []coopFeedEvent {
	t.Helper()
	w := doJSON(t, router, http.MethodGet, path, "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET %s: %d %s", path, w.Code, w.Body.String())
	}
	var page struct {
		Data []coopFeedEvent `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil {
		t.Fatalf("decode feed page %s: %v", path, err)
	}
	return page.Data
}

// TestGameMode_CoopMatchLifecycle covers the full coop path (ADR-33): a
// coop-only game, a solo coop match recorded through the API, its zero-score
// participant rows, and its exclusions — no arena settlement anywhere, absent
// from the global arena feed and the player profile stats, present in the
// home feed and the matches list with the shared game result.
func TestGameMode_CoopMatchLifecycle(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	router := setupRouter(pool)
	editorToken, _ := createTestUserWithID(t, pool, true)
	ctx := context.Background()

	game := createGameWithMode(t, router, editorToken, "КоопИгра", "coop")
	if got := getGameMode(t, router, game); got != "coop" {
		t.Fatalf("game mode = %q, want coop", got)
	}

	player := createTestPlayer(t, pool, "КоопИгрок")
	matchID := newID(t)
	body := coopMatchBody(matchID, game, []idpkg.ID{player}, `"game_score":45,"game_won":true`)
	if w := doJSON(t, router, http.MethodPost, "/matches", editorToken, body); w.Code != http.StatusOK {
		t.Fatalf("coop AddMatch: %d %s", w.Code, w.Body.String())
	}

	// No settlements: the match must not touch any arena's rating ledger.
	var settlements int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM arena_settlements WHERE match_id = $1`, matchID,
	).Scan(&settlements); err != nil {
		t.Fatal(err)
	}
	if settlements != 0 {
		t.Fatalf("coop match produced %d settlement rows, want 0", settlements)
	}

	// The matches list carries the mode and the shared result; participants
	// appear with zero per-player scores.
	matches := listMatchesModes(t, router, "")
	var listed *matchModeJSON
	for i := range matches {
		if matches[i].Id == shortOf(t, matchID) {
			listed = &matches[i]
		}
	}
	if listed == nil {
		t.Fatal("coop match missing from /matches")
	}
	if listed.Mode != "coop" || listed.GameScore == nil || *listed.GameScore != 45 || listed.GameWon == nil || !*listed.GameWon {
		t.Fatalf("coop match list item = %+v", listed)
	}
	if len(listed.Score) != 1 {
		t.Fatalf("coop match participants = %d, want 1", len(listed.Score))
	}
	for _, p := range listed.Score {
		if p.Score != 0 {
			t.Fatalf("coop participant score = %v, want 0", p.Score)
		}
	}

	// Home feed: in, with the coop data. Global arena feed: out.
	home := decodeCoopFeedPage(t, router, "/feed")
	foundHome := false
	for _, e := range home {
		if e.Type == "match" && e.Data.Id == shortOf(t, matchID) {
			foundHome = true
			if e.Data.Mode != "coop" || e.Data.GameScore == nil || *e.Data.GameScore != 45 {
				t.Fatalf("home feed coop event = %+v", e.Data)
			}
		}
	}
	if !foundHome {
		t.Fatal("coop match missing from home feed")
	}
	arena := decodeCoopFeedPage(t, router, "/arenas/"+globalArenaUUID+"/feed")
	for _, e := range arena {
		if e.Type == "match" && e.Data.Id == shortOf(t, matchID) {
			t.Fatal("coop match leaked into the global arena feed")
		}
	}

	// Player profile stats: no rating history, no game stats for the coop game.
	w := doJSON(t, router, http.MethodGet, "/players/"+player.String()+"/stats?tenant="+blueMenTenantUUID, "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("player stats: %d %s", w.Code, w.Body.String())
	}
	var stats struct {
		Data struct {
			RatingHistory     []json.RawMessage `json:"rating_history"`
			TopGamesByMatches []struct {
				GameId string `json:"game_id"`
			} `json:"top_games_by_matches"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &stats); err != nil {
		t.Fatal(err)
	}
	if len(stats.Data.RatingHistory) != 0 {
		t.Fatalf("coop player has %d rating points, want 0", len(stats.Data.RatingHistory))
	}
	for _, g := range stats.Data.TopGamesByMatches {
		if g.GameId == shortOf(t, game) {
			t.Fatal("coop game leaked into player game stats")
		}
	}

	// A later competitive match on a normal game still settles normally.
	competitiveGame := createGameWithMode(t, router, editorToken, "ОбычнИгра", "")
	other := createTestPlayer(t, pool, "ОбычнИгрок")
	if w := doJSON(t, router, http.MethodPost, "/matches", editorToken, fmt.Sprintf(
		`{"id":%q,"game_id":%q,"score":{%q:5,%q:3}}`,
		newID(t).String(), competitiveGame.String(), player.String(), other.String(),
	)); w.Code != http.StatusOK {
		t.Fatalf("competitive AddMatch: %d %s", w.Code, w.Body.String())
	}
	if rows := playerRatingRows(t, pool, player); len(rows) == 0 {
		t.Fatal("competitive match after coop did not settle")
	}
}

// TestGameMode_MixedGameModeToggle covers mode resolution: a mixed game takes
// the per-match mode (default competitive), a competitive-only game rejects a
// coop request and vice versa, the payload validation holds both ways, and
// converting an edit rewrites the settlements.
func TestGameMode_MixedGameModeToggle(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	router := setupRouter(pool)
	editorToken, _ := createTestUserWithID(t, pool, true)

	mixed := createGameWithMode(t, router, editorToken, "СмешанИгра", "mixed")
	competitive := createGameWithMode(t, router, editorToken, "СоревнИгра", "competitive")
	coopGame := createGameWithMode(t, router, editorToken, "КоопСольнаИгра", "coop")

	playerA := createTestPlayer(t, pool, "РежимА")
	playerB := createTestPlayer(t, pool, "РежимБ")

	// An invalid game_mode value is rejected at create.
	if w := doJSON(t, router, http.MethodPost, "/games", editorToken, fmt.Sprintf(
		`{"id":%q,"name":"ПлохойРежим","game_mode":"solo"}`, newID(t).String())); w.Code != http.StatusBadRequest {
		t.Fatalf("invalid game_mode: %d %s", w.Code, w.Body.String())
	}

	// Mixed + explicit coop → coop.
	coopOnMixed := newID(t)
	if w := doJSON(t, router, http.MethodPost, "/matches", editorToken, coopMatchBody(coopOnMixed, mixed, []idpkg.ID{playerA, playerB}, `"game_score":30,"game_won":false`)); w.Code != http.StatusOK {
		t.Fatalf("mixed coop AddMatch: %d %s", w.Code, w.Body.String())
	}
	// Mixed without mode → competitive, settles normally.
	competitiveOnMixed := newID(t)
	if w := doJSON(t, router, http.MethodPost, "/matches", editorToken, fmt.Sprintf(
		`{"id":%q,"game_id":%q,"score":{%q:7,%q:4}}`,
		competitiveOnMixed.String(), mixed.String(), playerA.String(), playerB.String(),
	)); w.Code != http.StatusOK {
		t.Fatalf("mixed default AddMatch: %d %s", w.Code, w.Body.String())
	}

	matches := listMatchesModes(t, router, "")
	for _, m := range matches {
		switch m.Id {
		case shortOf(t, coopOnMixed):
			if m.Mode != "coop" {
				t.Fatalf("coop on mixed stored as %q", m.Mode)
			}
		case shortOf(t, competitiveOnMixed):
			if m.Mode != "competitive" {
				t.Fatalf("default on mixed stored as %q", m.Mode)
			}
		}
	}
	if rows := playerRatingRows(t, pool, playerA); len(rows) == 0 {
		t.Fatal("competitive match on mixed game did not settle")
	}

	// Coop payload validation.
	cases := []struct {
		name string
		body string
		want int
	}{
		{"coop without game result", coopMatchBody(newID(t), coopGame, []idpkg.ID{playerA}, ""), http.StatusBadRequest},
		{"coop with per-player scores", coopMatchBody(newID(t), coopGame, []idpkg.ID{playerA},
			`"game_score":1,"game_won":true,"score":{`+fmt.Sprintf("%q", playerA.String())+`:5}`), http.StatusBadRequest},
		{"coop without participants", `{"id":"` + newID(t).String() + `","game_id":"` + coopGame.String() +
			`","mode":"coop","player_ids":[],"game_score":1,"game_won":true}`, http.StatusBadRequest},
		{"coop-only game, competitive request", fmt.Sprintf(`{"id":%q,"game_id":%q,"score":{%q:5,%q:3}}`,
			newID(t).String(), coopGame.String(), playerA.String(), playerB.String()), http.StatusBadRequest},
		{"competitive-only game, coop request", coopMatchBody(newID(t), competitive, []idpkg.ID{playerA},
			`"game_score":1,"game_won":true`), http.StatusBadRequest},
		{"competitive with game_score", fmt.Sprintf(`{"id":%q,"game_id":%q,"score":{%q:5,%q:3},"game_score":9,"game_won":true}`,
			newID(t).String(), competitive.String(), playerA.String(), playerB.String()), http.StatusBadRequest},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if w := doJSON(t, router, http.MethodPost, "/matches", editorToken, c.body); w.Code != c.want {
				t.Fatalf("got %d %s, want %d", w.Code, w.Body.String(), c.want)
			}
		})
	}

	// Converting a competitive match to coop on edit drops its settlements.
	conv := newID(t)
	if w := doJSON(t, router, http.MethodPost, "/matches", editorToken, fmt.Sprintf(
		`{"id":%q,"game_id":%q,"score":{%q:6,%q:2}}`,
		conv.String(), mixed.String(), playerA.String(), playerB.String(),
	)); w.Code != http.StatusOK {
		t.Fatalf("pre-conversion AddMatch: %d %s", w.Code, w.Body.String())
	}
	if len(playerRatingRows(t, pool, playerA)) == 0 {
		t.Fatal("pre-conversion match did not settle")
	}
	convBody := coopMatchBody(conv, mixed, []idpkg.ID{playerA, playerB},
		fmt.Sprintf(`"game_score":12,"game_won":true,"date":%q`, matchDate(0, 5)))
	if w := doJSON(t, router, http.MethodPut, "/matches/"+conv.String(), editorToken, convBody); w.Code != http.StatusOK {
		t.Fatalf("convert to coop: %d %s", w.Code, w.Body.String())
	}
	var settlements int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM arena_settlements WHERE match_id = $1 AND discriminator = 'match'`, conv,
	).Scan(&settlements); err != nil {
		t.Fatal(err)
	}
	if settlements != 0 {
		t.Fatalf("converted match kept %d settlement rows, want 0", settlements)
	}
}

// TestGameMode_MarketAndTournamentExclusion proves the exclusion guarantees:
// a coop match never resolves a market on its game, and a coop-only game is
// rejected from a tournament pool and a market's game list.
func TestGameMode_MarketAndTournamentExclusion(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	router := setupRouter(pool)
	editorToken, adminIDStr := createTestUserWithID(t, pool, true)
	adminID := idpkg.ID(adminIDStr)
	ctx := context.Background()

	mixed := createGameWithMode(t, router, editorToken, "РыночнСмешИгра", "mixed")
	coopGame := createGameWithMode(t, router, editorToken, "РыночнКоопИгра", "coop")
	target := createTestPlayer(t, pool, "РыночЦель")
	other := createTestPlayer(t, pool, "РыночДруг")

	// A match_winner market: the target wins on the mixed game.
	marketSvc := elo.NewMarketService(pool)
	market, err := marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
		TenantID:   blueMenTenantID,
		ID:         newID(t),
		MarketType: "match_winner",
		StartsAt:   time.Now().Add(-time.Hour),
		ClosesAt:   time.Now().Add(24 * time.Hour),
		CreatedBy:  adminID,
		MatchWinner: &elo.MatchWinnerCreateParams{
			TargetPlayerIDs:   []idpkg.ID{target},
			AllowOtherPlayers: true,
			GameIDs:           []idpkg.ID{mixed},
		},
	})
	if err != nil {
		t.Fatalf("CreateMarket: %v", err)
	}

	matchSvc := newMatchService(pool)

	// A coop match the target "wins" — it must not resolve the market…
	coopMatch := newID(t)
	if _, err := matchSvc.AddMatch(ctx, mixed, nil, time.Now(), elo.AddMatchOpts{
		ID:          coopMatch,
		Mode:        "coop",
		PlayerIDs:   []idpkg.ID{target, other},
		GameScore:   testFloatPtr(50),
		GameWon:     testBoolPtr(true),
		ActorUserID: adminID,
	}); err != nil {
		t.Fatalf("coop AddMatch (service): %v", err)
	}
	m, err := marketSvc.Queries.GetMarket(ctx, market.ID)
	if err != nil {
		t.Fatal(err)
	}
	if m.Status != "open" && m.Status != "betting_closed" {
		t.Fatalf("market resolved by a coop match: %q", m.Status)
	}

	// …while the competitive match on the same game does.
	if _, err := matchSvc.AddMatch(ctx, mixed, map[idpkg.ID]float64{target: 9, other: 4}, time.Now(), newMatchOpts(t)); err != nil {
		t.Fatalf("competitive AddMatch: %v", err)
	}
	m, err = marketSvc.Queries.GetMarket(ctx, market.ID)
	if err != nil {
		t.Fatal(err)
	}
	if m.Status != "resolved" {
		t.Fatalf("market not resolved by the competitive match: %q", m.Status)
	}

	// A coop-only game is rejected from a market's game list…
	createMarketBody := fmt.Sprintf(`{"id":%q,"market_type":"match_winner","starts_at":%q,"closes_at":%q,
		"target_player_ids":[%q],"allow_other_players":true,"game_ids":[%q]}`,
		newID(t).String(), time.Now().Format(time.RFC3339), time.Now().Add(24*time.Hour).Format(time.RFC3339),
		target.String(), coopGame.String())
	if w := doJSON(t, router, http.MethodPost, "/tenants/00000000-0000-0000-0000-000000000101/markets", editorToken, createMarketBody); w.Code != http.StatusBadRequest {
		t.Fatalf("market on coop game: %d %s", w.Code, w.Body.String())
	}

	// …and from a tournament pool.
	tournamentBody := fmt.Sprintf(`{"id":%q,"name":"КоопТурнир","games":[{"game_id":%q,"min_players":2,"max_players":4}]}`,
		newID(t).String(), coopGame.String())
	if w := doJSON(t, router, http.MethodPost, "/tenants/00000000-0000-0000-0000-000000000101/tournaments", editorToken, tournamentBody); w.Code != http.StatusBadRequest {
		t.Fatalf("tournament with coop game: %d %s", w.Code, w.Body.String())
	}
}

func testFloatPtr(v float64) *float64 { return &v }
func testBoolPtr(v bool) *bool        { return &v }
