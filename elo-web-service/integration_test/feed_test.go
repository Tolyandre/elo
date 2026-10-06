//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/elo"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

// feedEventJSON is one element of the feed response's data array.
type feedEventJSON struct {
	Type string `json:"type"`
	Data struct {
		Id         string `json:"id"`
		PlayerName string `json:"player_name"`
	} `json:"data"`
}

type feedPageJSON struct {
	Data []feedEventJSON `json:"data"`
	Next *string         `json:"next"`
}

// decodeFeedPage fetches one feed page and decodes it; clears Next when the
// key is absent (exhausted feed).
func decodeFeedPage(t *testing.T, router http.Handler, path string) feedPageJSON {
	t.Helper()
	w := doJSON(t, router, http.MethodGet, path, "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET %s: %d %s", path, w.Code, w.Body.String())
	}
	var page feedPageJSON
	if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil {
		t.Fatalf("decode feed page: %v", err)
	}
	return page
}

// TestArena_Feed_CompositionAndPagination covers the global arena's feed
// (ADR-32): matches, a correction and a market resolution merge into one
// date-ordered stream; the same-timestamp match and its resolving market keep
// the match above the market; the cursor walks the stream without repeats.
// The home feed (/feed) must return the same events as the global arena's
// own feed today, and a per-game arena's feed must stay matches-only.
func TestArena_Feed_CompositionAndPagination(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	router := setupRouter(pool)

	playerA := createTestPlayer(t, pool, "ЛентаА")
	playerB := createTestPlayer(t, pool, "ЛентаБ")
	guarantor := createTestPlayer(t, pool, "ЛентаПоручитель")
	adminID := createTestAdmin(t, pool)

	matchSvc := newMatchService(pool)
	marketSvc := elo.NewMarketService(pool)

	// Through the service so the per-game arena exists.
	gameRec, err := newGameService(pool).AddGame(ctx, newID(t), "ЛентаИгра", idpkg.ID(""))
	if err != nil {
		t.Fatalf("AddGame: %v", err)
	}
	gameID := gameRec.ID

	// Warm-up match — the feed's oldest event.
	warmupDate := time.Now().Add(-2 * time.Hour)
	if _, err := matchSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{playerA: 5, playerB: 5}, warmupDate, newMatchOpts(t)); err != nil {
		t.Fatalf("warm-up AddMatch: %v", err)
	}

	// A match_winner market on A vs B, backed by a guarantor so it is live.
	market, err := marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
		ID:         newID(t),
		MarketType: "match_winner",
		StartsAt:   time.Now().Add(-time.Minute),
		ClosesAt:   time.Now().Add(24 * time.Hour),
		CreatedBy:  adminID,
		MatchWinner: &elo.MatchWinnerCreateParams{
			TargetPlayerIDs:   []idpkg.ID{playerA, playerB},
			AllowOtherPlayers: true,
		},
	})
	if err != nil {
		t.Fatalf("CreateMarket: %v", err)
	}
	setBetLimit(t, pool, guarantor, 16)
	joinGuarantee(ctx, t, marketSvc, market.ID, guarantor)

	// The resolving match: A wins — settles the market in the same instant
	// (resolved_at = match date), exercising the (date, type, id) tiebreak.
	triggerDate := time.Now()
	if _, err := matchSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{playerA: 10, playerB: 2}, triggerDate, newMatchOpts(t)); err != nil {
		t.Fatalf("trigger AddMatch: %v", err)
	}

	// A rating correction — settles only into the global arena, created last
	// so it is the feed's newest event.
	if err := newCorrectionService(pool).CreateGlobalArenaRatingCorrection(ctx, newID(t), playerA, 3.5); err != nil {
		t.Fatalf("CreateGlobalArenaRatingCorrection: %v", err)
	}

	// The home feed: correction first, then the resolving match above its
	// market resolution (tie at the trigger instant: 'match' > 'market'),
	// then the warm-up match.
	home := decodeFeedPage(t, router, "/feed")
	gotTypes := make([]string, 0, len(home.Data))
	for _, e := range home.Data {
		gotTypes = append(gotTypes, e.Type)
	}
	wantTypes := []string{"correction", "match", "market", "match"}
	if len(gotTypes) != len(wantTypes) {
		t.Fatalf("home feed events = %v, want %v (next present: %v)", gotTypes, wantTypes, home.Next != nil)
	}
	for i := range wantTypes {
		if gotTypes[i] != wantTypes[i] {
			t.Fatalf("home feed events = %v, want %v", gotTypes, wantTypes)
		}
	}

	// The global arena's own feed returns the same stream today.
	byArena := decodeFeedPage(t, router, "/arenas/"+globalArenaUUID+"/feed")
	if len(byArena.Data) != len(home.Data) {
		t.Fatalf("global arena feed holds %d events, home feed %d", len(byArena.Data), len(home.Data))
	}
	for i := range home.Data {
		if byArena.Data[i].Type != home.Data[i].Type || byArena.Data[i].Data.Id != home.Data[i].Data.Id {
			t.Fatalf("global arena feed diverges from the home feed at %d", i)
		}
	}

	// Cursor walk with limit=2: every event exactly once, same order.
	seen := map[string]bool{}
	var order []string
	path := "/feed?limit=2"
	for {
		page := decodeFeedPage(t, router, path)
		for _, e := range page.Data {
			key := e.Type + ":" + e.Data.Id
			if seen[key] {
				t.Fatalf("cursor repeated event %s", key)
			}
			seen[key] = true
			order = append(order, e.Type)
		}
		if page.Next == nil {
			break
		}
		path = "/feed?next=" + *page.Next
	}
	if len(order) != len(wantTypes) {
		t.Fatalf("cursor walk produced %v, want %v", order, wantTypes)
	}
	for i := range wantTypes {
		if order[i] != wantTypes[i] {
			t.Fatalf("cursor walk produced %v, want %v", order, wantTypes)
		}
	}
	// A per-game arena's feed stays matches-only (no correction, no market).
	gameArena, err := newArenaService(pool).GetArenaByGame(ctx, gameID)
	if err != nil {
		t.Fatalf("GetArenaByGame: %v", err)
	}
	gameFeed := decodeFeedPage(t, router, "/arenas/"+string(gameArena.ID)+"/feed")
	if len(gameFeed.Data) != 2 {
		t.Fatalf("game arena feed must hold the 2 matches, got %d events", len(gameFeed.Data))
	}
	for _, e := range gameFeed.Data {
		if e.Type != "match" {
			t.Fatalf("game arena feed must hold matches only, got %q", e.Type)
		}
	}
}

// TestArena_Feed_TournamentOnlyMatches pins the tournament arena fix: its
// feed holds the linked matches only — never corrections or market
// resolutions, although the tournament arena serializes an empty filter like
// the global arena does.
func TestArena_Feed_TournamentOnlyMatches(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	router := setupRouter(pool)

	playerA := createTestPlayer(t, pool, "ТурнА")
	playerB := createTestPlayer(t, pool, "ТурнБ")
	gameID := createTestGame(t, pool, "ТурнИгра")

	matchSvc := newMatchService(pool)
	// Two real matches: the first linked to the tournament arena, the second not.
	inDate := time.Now().Add(-time.Hour)
	outDate := time.Now().Add(-30 * time.Minute)
	inMatch, err := matchSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{playerA: 10, playerB: 5}, inDate, newMatchOpts(t))
	if err != nil {
		t.Fatalf("linked AddMatch: %v", err)
	}
	if _, err := matchSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{playerA: 3, playerB: 8}, outDate, newMatchOpts(t)); err != nil {
		t.Fatalf("unlinked AddMatch: %v", err)
	}

	// Probe rows (pattern of TestTournament_ArenaMembershipFunction): a
	// running tournament and its link-only arena (empty filter serialization).
	tournID := idpkg.New()
	if _, err := pool.Exec(ctx,
		`INSERT INTO tournaments (id, name, status, elimination) VALUES ($1, 'Турнир ленты', 'running', 'single')`,
		tournID); err != nil {
		t.Fatalf("insert probe tournament: %v", err)
	}
	tournArenaID := idpkg.NewMonotonic()
	if _, err := pool.Exec(ctx,
		`INSERT INTO arenas (id, name, settings, settings_schema_version, tournament_id, camp)
		 VALUES ($1, 'Арена ленты', '{"starting_rating":900,"leagues":[]}', 1, $2, false)`,
		tournArenaID, tournID); err != nil {
		t.Fatalf("insert probe arena: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO arena_matches (arena_id, match_id) VALUES ($1, $2)`, tournArenaID, inMatch.ID); err != nil {
		t.Fatalf("insert probe link: %v", err)
	}

	// Global-arena noise that must not leak into the tournament feed.
	if err := newCorrectionService(pool).CreateGlobalArenaRatingCorrection(ctx, newID(t), playerA, 2); err != nil {
		t.Fatalf("CreateGlobalArenaRatingCorrection: %v", err)
	}

	page := decodeFeedPage(t, router, "/arenas/"+string(tournArenaID)+"/feed")
	if len(page.Data) != 1 {
		t.Fatalf("tournament feed must hold exactly the linked match, got %d events", len(page.Data))
	}
	if page.Data[0].Type != "match" || page.Data[0].Data.Id != short(inMatch.ID) {
		t.Fatalf("tournament feed event = %s/%s, want match/%s", page.Data[0].Type, page.Data[0].Data.Id, inMatch.ID)
	}
	if page.Next != nil {
		t.Fatalf("tournament feed must be exhausted, got a cursor")
	}
}

// TestMarkets_ListClosedCursorPagination covers the markets lobby pagination
// (ADR-32): the active bucket rides along in full on every page, the closed
// bucket walks the (resolved_at, id) keyset without repeats in resolution
// order, and the cursor runs out exactly when the feed is exhausted.
func TestMarkets_ListClosedCursorPagination(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	router := setupRouter(pool)

	playerA := createTestPlayer(t, pool, "СтавкиА")
	playerB := createTestPlayer(t, pool, "СтавкиБ")
	adminID := createTestAdmin(t, pool)

	marketSvc := elo.NewMarketService(pool)

	// Three closed markets: distinct past closes_at — expiry stamps
	// resolved_at = closes_at, so the resolution order is deterministic.
	expiredIDs := make([]idpkg.ID, 0, 3)
	for i := range 3 {
		m, err := marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
			ID:         newID(t),
			MarketType: "match_winner",
			StartsAt:   time.Now().Add(-time.Hour),
			ClosesAt:   time.Now().Add(-time.Duration(3-i) * time.Hour), // oldest first
			CreatedBy:  adminID,
			MatchWinner: &elo.MatchWinnerCreateParams{
				TargetPlayerIDs:   []idpkg.ID{playerA, playerB},
				AllowOtherPlayers: true,
			},
		})
		if err != nil {
			t.Fatalf("CreateMarket %d: %v", i, err)
		}
		expiredIDs = append(expiredIDs, m.ID)
	}
	// One live market — stays in the active bucket on every page.
	live, err := marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
		ID:         newID(t),
		MarketType: "match_winner",
		StartsAt:   time.Now().Add(-time.Minute),
		ClosesAt:   time.Now().Add(24 * time.Hour),
		CreatedBy:  adminID,
		MatchWinner: &elo.MatchWinnerCreateParams{
			TargetPlayerIDs:   []idpkg.ID{playerA, playerB},
			AllowOtherPlayers: true,
		},
	})
	if err != nil {
		t.Fatalf("CreateMarket live: %v", err)
	}

	if err := marketSvc.ExpireOverdueMarkets(ctx); err != nil {
		t.Fatalf("ExpireOverdueMarkets: %v", err)
	}

	type marketsPage struct {
		Data struct {
			Active []struct {
				Id     string `json:"id"`
				Status string `json:"status"`
			} `json:"active"`
			Closed []struct {
				Id     string `json:"id"`
				Status string `json:"status"`
			} `json:"closed"`
			Next *string `json:"next"`
		} `json:"data"`
	}
	decode := func(path string) marketsPage {
		t.Helper()
		w := doJSON(t, router, http.MethodGet, path, "", "")
		if w.Code != http.StatusOK {
			t.Fatalf("GET %s: %d %s", path, w.Code, w.Body.String())
		}
		var page marketsPage
		if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil {
			t.Fatalf("decode markets page: %v", err)
		}
		return page
	}

	// Page 1 with limit=2: two closed markets in resolution order (newest
	// first — resolved_at = closes_at, so the market expired last leads)
	// plus the live market in full.
	page := decode("/markets?limit=2")
	if len(page.Data.Active) != 1 || page.Data.Active[0].Id != short(live.ID) {
		t.Fatalf("active bucket must hold exactly the live market, got %+v", page.Data.Active)
	}
	if len(page.Data.Closed) != 2 || page.Data.Next == nil {
		t.Fatalf("closed page 1 must hold 2 markets and a cursor: %+v", page.Data.Closed)
	}

	// Walk the closed keyset to the end: every closed market exactly once.
	walked := []string{}
	seen := map[string]bool{}
	path := "/markets?limit=2"
	for {
		p := decode(path)
		for _, m := range p.Data.Closed {
			if seen[m.Id] {
				t.Fatalf("cursor repeated market %s", m.Id)
			}
			seen[m.Id] = true
			walked = append(walked, m.Id)
		}
		if p.Data.Next == nil {
			break
		}
		path = "/markets?closed_next=" + *p.Data.Next
	}
	if len(walked) != 3 {
		t.Fatalf("cursor walk produced %d closed markets, want 3: %v", len(walked), walked)
	}
	// Newest resolution first: the market expired last (latest closes_at) is
	// the newest resolution and must lead the list.
	if walked[0] != short(expiredIDs[2]) {
		t.Fatalf("newest resolution must come first: got %s, want %s", walked[0], short(expiredIDs[2]))
	}
	if walked[2] != short(expiredIDs[0]) {
		t.Fatalf("oldest resolution must come last: got %s, want %s", walked[2], short(expiredIDs[0]))
	}
}
