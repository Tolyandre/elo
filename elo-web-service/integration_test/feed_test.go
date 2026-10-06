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
		Status     string `json:"status"`
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
	// then the warm-up match. The market appears once — at its resolution
	// position; its creation event existed only while it was active.
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

// placeBetOnPlayer places a minimal bet by bettorID on the given player's
// outcome of the market, paying the current price (inside the tolerance) —
// the bettor ends up in the market's settlement but in no condition or
// outcome.
func placeBetOnPlayer(t *testing.T, ctx context.Context, svc *elo.MarketService, marketID, bettorID, playerID idpkg.ID) {
	t.Helper()
	m, err := svc.Queries.GetMarket(ctx, marketID)
	if err != nil {
		t.Fatalf("GetMarket: %v", err)
	}
	outcomes, err := svc.Queries.ListMarketOutcomesWithPools(ctx, marketID)
	if err != nil {
		t.Fatalf("ListMarketOutcomesWithPools: %v", err)
	}
	q := make([]float64, len(outcomes))
	var outcomeID idpkg.ID
	idx := -1
	for i, o := range outcomes {
		q[i] = o.Q
		if o.Kind == "player" && o.PlayerID != nil && *o.PlayerID == playerID {
			outcomeID = o.ID
			idx = i
		}
	}
	if idx < 0 {
		t.Fatalf("outcome for player %s not found on market %s", playerID, marketID)
	}
	price := elo.MarginalProbabilitiesN(q, m.LiquidityB)[idx]
	if _, err := svc.PlaceBet(ctx, newID(t), marketID, bettorID, outcomeID, 1, price-elo.ProbabilityTolerance/2); err != nil {
		t.Fatalf("PlaceBet: %v", err)
	}
}

// TestArena_Feed_MarketFilters pins the feed filters' market semantics
// (ADR-32): player_id matches a market when the player is its resolution
// condition, is referred to by an outcome, guaranteed it, or took part in its
// settlement; club_id matches through any club member; game_id matches a
// condition game or the resolving match's game.
func TestArena_Feed_MarketFilters(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	router := setupRouter(pool)

	targetA := createTestPlayer(t, pool, "ФильтрА")
	targetB := createTestPlayer(t, pool, "ФильтрБ")
	targetC := createTestPlayer(t, pool, "ФильтрВ")
	targetD := createTestPlayer(t, pool, "ФильтрГ")
	wsTarget := createTestPlayer(t, pool, "ФильтрСерия")
	guarantor := createTestPlayer(t, pool, "ФильтрПоручитель")
	bettor := createTestPlayer(t, pool, "ФильтрСтавочник")
	outsider := createTestPlayer(t, pool, "ФильтрСторонний")
	adminID := createTestAdmin(t, pool)

	game1 := createTestGame(t, pool, "ФильтрИгра1")
	game2 := createTestGame(t, pool, "ФильтрИгра2")
	game3 := createTestGame(t, pool, "ФильтрИгра3")

	matchSvc := newMatchService(pool)
	marketSvc := elo.NewMarketService(pool)

	// MW1: targets A/B pinned to game1, guaranteed by a club member, with a
	// plain bettor on A's outcome. Resolved by a game1 match (A wins).
	mw1, err := marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
		ID:         newID(t),
		MarketType: "match_winner",
		StartsAt:   time.Now().Add(-time.Minute),
		ClosesAt:   time.Now().Add(24 * time.Hour),
		CreatedBy:  adminID,
		MatchWinner: &elo.MatchWinnerCreateParams{
			TargetPlayerIDs:   []idpkg.ID{targetA, targetB},
			AllowOtherPlayers: true,
			GameIDs:           []idpkg.ID{game1},
		},
	})
	if err != nil {
		t.Fatalf("CreateMarket mw1: %v", err)
	}
	setBetLimit(t, pool, guarantor, 16)
	joinGuarantee(ctx, t, marketSvc, mw1.ID, guarantor)
	setBetLimit(t, pool, bettor, 16)
	placeBetOnPlayer(t, ctx, marketSvc, mw1.ID, bettor, targetA)

	// MW2: no condition games ("any game"), targets C/D only — resolved by a
	// game2 match, so its only game tie is the resolving match.
	mw2, err := marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
		ID:         newID(t),
		MarketType: "match_winner",
		StartsAt:   time.Now().Add(-time.Minute),
		ClosesAt:   time.Now().Add(24 * time.Hour),
		CreatedBy:  adminID,
		MatchWinner: &elo.MatchWinnerCreateParams{
			TargetPlayerIDs: []idpkg.ID{targetC, targetD},
		},
	})
	if err != nil {
		t.Fatalf("CreateMarket mw2: %v", err)
	}

	// WS: a first win of wsTarget over game2 resolves it to "Да".
	ws, err := marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
		ID:         newID(t),
		MarketType: "win_streak",
		StartsAt:   time.Now().Add(-time.Minute),
		ClosesAt:   time.Now().Add(24 * time.Hour),
		CreatedBy:  adminID,
		WinStreak: &elo.WinStreakCreateParams{
			TargetPlayerID: wsTarget,
			GameIDs:        []idpkg.ID{game2},
			WinsRequired:   1,
		},
	})
	if err != nil {
		t.Fatalf("CreateMarket ws: %v", err)
	}

	// The resolving matches, all after the markets started: game1 settles
	// MW1, the first game2 match (exactly C/D) settles MW2, the second —
	// wsTarget's first win — settles WS.
	if _, err := matchSvc.AddMatch(ctx, game1, map[idpkg.ID]float64{targetA: 10, targetB: 2}, time.Now(), newMatchOpts(t)); err != nil {
		t.Fatalf("mw1 trigger match: %v", err)
	}
	if _, err := matchSvc.AddMatch(ctx, game2, map[idpkg.ID]float64{targetC: 8, targetD: 3}, time.Now().Add(time.Minute), newMatchOpts(t)); err != nil {
		t.Fatalf("mw2 trigger match: %v", err)
	}
	if _, err := matchSvc.AddMatch(ctx, game2, map[idpkg.ID]float64{wsTarget: 8, targetB: 3}, time.Now().Add(2*time.Minute), newMatchOpts(t)); err != nil {
		t.Fatalf("ws trigger match: %v", err)
	}

	// Clubs: the guarantor's club must reach MW1 through him; the outsider's
	// club must reach nothing — membership alone matches no market.
	clubOfGuarantor := idpkg.New()
	if _, err := pool.Exec(ctx, `INSERT INTO clubs (id, name) VALUES ($1, 'Клуб поручителя')`, clubOfGuarantor); err != nil {
		t.Fatalf("insert club: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO player_club_membership (club_id, player_id) VALUES ($1, $2)`, clubOfGuarantor, guarantor); err != nil {
		t.Fatalf("insert membership: %v", err)
	}
	clubOfOutsider := idpkg.New()
	if _, err := pool.Exec(ctx, `INSERT INTO clubs (id, name) VALUES ($1, 'Клуб стороннего')`, clubOfOutsider); err != nil {
		t.Fatalf("insert outsider club: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO player_club_membership (club_id, player_id) VALUES ($1, $2)`, clubOfOutsider, outsider); err != nil {
		t.Fatalf("insert outsider membership: %v", err)
	}

	// marketIDs feeds the query to the home feed and collects the market
	// events' ids; check compares them with the expected set.
	marketIDs := func(query string) map[string]bool {
		t.Helper()
		page := decodeFeedPage(t, router, "/feed"+query)
		ids := map[string]bool{}
		for _, e := range page.Data {
			if e.Type == "market" {
				ids[e.Data.Id] = true
			}
		}
		return ids
	}
	want := func(ids ...idpkg.ID) map[string]bool {
		m := make(map[string]bool, len(ids))
		for _, id := range ids {
			m[short(id)] = true
		}
		return m
	}
	check := func(query string, wantIDs map[string]bool) {
		t.Helper()
		got := marketIDs(query)
		if len(got) != len(wantIDs) {
			t.Fatalf("feed%s market events = %v, want %v", query, got, wantIDs)
		}
		for id := range wantIDs {
			if !got[id] {
				t.Fatalf("feed%s market events = %v, want %v", query, got, wantIDs)
			}
		}
	}

	check("", want(mw1.ID, mw2.ID, ws.ID))
	// Player: resolution condition targets, a guarantor, a settlement-only
	// bettor, and an unrelated outsider.
	check("?player_id="+short(targetA), want(mw1.ID))
	check("?player_id="+short(wsTarget), want(ws.ID))
	check("?player_id="+short(targetC), want(mw2.ID))
	check("?player_id="+short(guarantor), want(mw1.ID))
	check("?player_id="+short(bettor), want(mw1.ID))
	check("?player_id="+short(outsider), nil)
	// Club: through the guarantor member; the outsider's club through nobody.
	check("?club_id="+short(clubOfGuarantor), want(mw1.ID))
	check("?club_id="+short(clubOfOutsider), nil)
	// Game: mw1 names game1 as a condition; mw2 has no condition games and
	// matches game2 only via its resolving match.
	check("?game_id="+short(game1), want(mw1.ID))
	check("?game_id="+short(game2), want(mw2.ID, ws.ID))
	check("?game_id="+short(game3), nil)
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

// TestArena_Feed_MarketLifecycleOrdering pins the market branch's ordering
// semantics: an active market (open or betting-locked) enters the feed at its
// creation moment, a settled one (match-resolved, time-cancelled) at its
// resolution moment — a match-triggered resolution lands immediately after
// the match that resolved it, because resolved_at carries the match's date.
func TestArena_Feed_MarketLifecycleOrdering(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	ctx := context.Background()
	router := setupRouter(pool)

	playerA := createTestPlayer(t, pool, "ЖизнА")
	playerB := createTestPlayer(t, pool, "ЖизнБ")
	playerC := createTestPlayer(t, pool, "ЖизнВ")
	playerD := createTestPlayer(t, pool, "ЖизнГ")
	adminID := createTestAdmin(t, pool)
	gameID := createTestGame(t, pool, "ЖизнИгра")

	matchSvc := newMatchService(pool)
	marketSvc := elo.NewMarketService(pool)

	newMatchWinner := func(targets ...idpkg.ID) elo.CreateMarketParams {
		return elo.CreateMarketParams{
			ID:         newID(t),
			MarketType: "match_winner",
			StartsAt:   time.Now().Add(-time.Minute),
			ClosesAt:   time.Now().Add(24 * time.Hour),
			CreatedBy:  adminID,
			MatchWinner: &elo.MatchWinnerCreateParams{
				TargetPlayerIDs:   targets,
				AllowOtherPlayers: true,
			},
		}
	}

	// The feed's oldest event: a match on A/B predating every market.
	matchOld, err := matchSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{playerA: 6, playerB: 4}, time.Now().Add(-4*time.Hour), newMatchOpts(t))
	if err != nil {
		t.Fatalf("old AddMatch: %v", err)
	}

	// Two active markets on C/D, created in this order so their creation
	// events stack deterministically (created_at DESC): the locked one above
	// the open one. They share no players with A/B, so the resolving match
	// below leaves them alone.
	marketOpen, err := marketSvc.CreateMarket(ctx, newMatchWinner(playerC, playerD))
	if err != nil {
		t.Fatalf("CreateMarket open: %v", err)
	}
	marketLocked, err := marketSvc.CreateMarket(ctx, newMatchWinner(playerC, playerD))
	if err != nil {
		t.Fatalf("CreateMarket locked: %v", err)
	}
	if err := marketSvc.LockMarketBetting(ctx, marketLocked.ID); err != nil {
		t.Fatalf("LockMarketBetting: %v", err)
	}

	// A market on A/B with an already-past closes_at: expiry cancels it and
	// stamps resolved_at = closes_at, putting its feed event between the
	// creation events and the old match.
	marketCancelled, err := marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
		ID:         newID(t),
		MarketType: "match_winner",
		StartsAt:   time.Now().Add(-2 * time.Hour),
		ClosesAt:   time.Now().Add(-time.Hour),
		CreatedBy:  adminID,
		MatchWinner: &elo.MatchWinnerCreateParams{
			TargetPlayerIDs:   []idpkg.ID{playerA, playerB},
			AllowOtherPlayers: true,
		},
	})
	if err != nil {
		t.Fatalf("CreateMarket cancelled: %v", err)
	}
	if err := marketSvc.ExpireOverdueMarkets(ctx); err != nil {
		t.Fatalf("ExpireOverdueMarkets: %v", err)
	}

	// A market on A/B resolved by a future-dated match (the feed's newest
	// event): its resolution event must sit immediately after that match.
	marketResolved, err := marketSvc.CreateMarket(ctx, newMatchWinner(playerA, playerB))
	if err != nil {
		t.Fatalf("CreateMarket resolved: %v", err)
	}
	matchResolveDate := time.Now().Add(2 * time.Minute)
	matchResolved, err := matchSvc.AddMatch(ctx, gameID, map[idpkg.ID]float64{playerA: 10, playerB: 2}, matchResolveDate, newMatchOpts(t))
	if err != nil {
		t.Fatalf("resolving AddMatch: %v", err)
	}

	// Newest first: the resolving match, its market resolution right below
	// it, then the betting-locked and open markets at their creation moments,
	// then the cancelled market at its cancellation moment, then the old
	// match.
	page := decodeFeedPage(t, router, "/feed")
	want := []struct {
		typ    string
		id     string
		status string
	}{
		{"match", short(matchResolved.ID), ""},
		{"market", short(marketResolved.ID), "resolved"},
		{"market", short(marketLocked.ID), "betting_closed"},
		{"market", short(marketOpen.ID), "open"},
		{"market", short(marketCancelled.ID), "cancelled"},
		{"match", short(matchOld.ID), ""},
	}
	if len(page.Data) != len(want) {
		var got []string
		for _, e := range page.Data {
			got = append(got, e.Type+":"+e.Data.Status)
		}
		t.Fatalf("feed holds %d events, want %d: %v", len(page.Data), len(want), got)
	}
	for i, w := range want {
		e := page.Data[i]
		if e.Type != w.typ || e.Data.Id != w.id || e.Data.Status != w.status {
			t.Fatalf("feed[%d] = %s/%s/%s, want %s/%s/%s", i, e.Type, e.Data.Id, e.Data.Status, w.typ, w.id, w.status)
		}
	}
}
