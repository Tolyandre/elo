//go:build integration

package integration_test

// GET /games/favorites — the game picker's «Избранные» tab: «Недавние» games
// played by the current user's player or a member of their clubs (most recent
// match first) and «Популярные» games most played among club members (or
// globally for users without a club), minus the recent ones.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/elo"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

type favoriteGameEntry struct {
	Id         string     `json:"id"`
	RecentAt   *time.Time `json:"recent_at"`
	MatchCount *int       `json:"match_count"`
}

func getFavoriteGames(t *testing.T, router interface {
	ServeHTTP(http.ResponseWriter, *http.Request)
}, token string) (int, []favoriteGameEntry, []favoriteGameEntry) {
	t.Helper()
	w := doJSON(t, router, http.MethodGet, "/games/favorites", token, "")
	if w.Code != http.StatusOK {
		return w.Code, nil, nil
	}
	var resp struct {
		Status string `json:"status"`
		Data   struct {
			Recent  []favoriteGameEntry `json:"recent"`
			Popular []favoriteGameEntry `json:"popular"`
		} `json:"data"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return w.Code, resp.Data.Recent, resp.Data.Popular
}

// addMatchDaysAgo inserts a match of the given game the given number of days
// ago between the given players, via the audited service path.
func addMatchDaysAgo(t *testing.T, ctx context.Context, pool *pgxpool.Pool, game idpkg.ID, daysAgo int, scores map[idpkg.ID]float64) {
	t.Helper()
	date := time.Now().UTC().AddDate(0, 0, -daysAgo)
	if _, err := newMatchService(pool).AddMatch(ctx, blueMenTenantID, game, scores, date, newMatchOpts(t)); err != nil {
		t.Fatalf("AddMatch %v %d days ago: %v", game, daysAgo, err)
	}
}

// gameNamesByID resolves favorite entry ids to game display names.
func gameNamesByID(t *testing.T, pool *pgxpool.Pool, entries []favoriteGameEntry) map[string]string {
	t.Helper()
	ctx := context.Background()
	q := db.New(pool)
	out := make(map[string]string, len(entries))
	for _, e := range entries {
		if _, seen := out[e.Id]; seen {
			continue
		}
		canonical, err := idpkg.ParseTolerant(e.Id)
		if err != nil {
			t.Fatalf("parse id %s: %v", e.Id, err)
		}
		game, err := q.GetGameByID(ctx, canonical)
		if err != nil {
			t.Fatalf("get game %s: %v", e.Id, err)
		}
		out[e.Id] = game.Name
	}
	return out
}

func TestListFavoriteGames_ClubRecentAndPopular(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()
	q := db.New(pool)
	router := setupRouter(pool)

	// The current user and a fellow club member share Club A.
	myToken, myUserID := createTestUserWithID(t, pool, true)
	me := createTestPlayer(t, pool, "Me")
	if err := q.UpdateUserPlayerID(ctx, db.UpdateUserPlayerIDParams{ID: idpkg.ID(myUserID), PlayerID: &me}); err != nil {
		t.Fatalf("link my player: %v", err)
	}
	mate := createTestPlayer(t, pool, "Mate")
	_, mateUserID := createTestUserWithID(t, pool, true)
	if err := q.UpdateUserPlayerID(ctx, db.UpdateUserPlayerIDParams{ID: idpkg.ID(mateUserID), PlayerID: &mate}); err != nil {
		t.Fatalf("link mate player: %v", err)
	}
	club, err := q.CreateClub(ctx, db.CreateClubParams{ID: newID(t), Name: "Club A"})
	if err != nil {
		t.Fatalf("create club: %v", err)
	}
	for _, pid := range []idpkg.ID{me, mate} {
		if err := q.AddClubMember(ctx, db.AddClubMemberParams{ClubID: club.ID, PlayerID: pid}); err != nil {
			t.Fatalf("add club member: %v", err)
		}
	}

	// Guests fill the second seat (matches require at least two players);
	// they belong to no club at all (bare players), so "Outside" must appear
	// in neither section.
	g1, g2 := createBareTestPlayer(t, pool, "Guest1"), createBareTestPlayer(t, pool, "Guest2")

	// Seven games played once each by club members, one per day, 1..7 days
	// ago — they fill «Недавние» completely. "Old" is played twice by club
	// members but 9 and 10 days ago, so it misses the recent cut and tops
	// «Популярные»; "Game08" is played once 8 days ago — the newest game that
	// fell out of the recent cap — and comes second by recency.
	for i := 1; i <= 7; i++ {
		game := createTestGame(t, pool, fmt.Sprintf("Game0%d", i))
		addMatchDaysAgo(t, ctx, pool, game, i, map[idpkg.ID]float64{me: 10, mate: 5})
	}
	eight := createTestGame(t, pool, "Game08")
	addMatchDaysAgo(t, ctx, pool, eight, 8, map[idpkg.ID]float64{mate: 10, g1: 5})
	old := createTestGame(t, pool, "Old")
	addMatchDaysAgo(t, ctx, pool, old, 9, map[idpkg.ID]float64{me: 10, mate: 5})
	addMatchDaysAgo(t, ctx, pool, old, 10, map[idpkg.ID]float64{mate: 10, g2: 5})
	// An outsiders-only match is unrepresentable since the create guard
	// (ADR-36 phase 7): recording it under «Синие люди» is rejected — no
	// member among the participants — so no game of theirs can ever leak
	// into the favorites.
	if _, err := newMatchService(pool).AddMatch(ctx, blueMenTenantID, createTestGame(t, pool, "Outside"), map[idpkg.ID]float64{g1: 10, g2: 5}, time.Now().UTC().AddDate(0, 0, -1), newMatchOpts(t)); !errors.Is(err, elo.ErrMatchOutsideTenant) {
		t.Fatalf("outsiders-only match: err = %v, want ErrMatchOutsideTenant", err)
	}

	code, recent, popular := getFavoriteGames(t, router, myToken)
	if code != http.StatusOK {
		t.Fatalf("expected 200, got %d", code)
	}

	// Recent: the seven freshest club games, most recent match first.
	if len(recent) != 7 {
		t.Fatalf("expected 7 recent entries, got %d", len(recent))
	}
	recentIDs := gameNamesByID(t, pool, recent)
	for i, want := range []string{"Game01", "Game02", "Game03", "Game04", "Game05", "Game06", "Game07"} {
		if recentIDs[recent[i].Id] != want {
			t.Fatalf("expected recent[%d]=%s, got %s", i, want, recentIDs[recent[i].Id])
		}
		if recent[i].RecentAt == nil {
			t.Fatalf("expected recent_at on %s", want)
		}
	}
	// The recency key of Game01 is its own match date (1 day ago), not some
	// other game's — the helper re-reads the clock per match, so the window
	// is a generous ±2s around the expected date.
	if d := recent[0].RecentAt.Sub(time.Now().UTC().AddDate(0, 0, -1)); d > 2*time.Second || d < -2*time.Second {
		t.Fatalf("expected Game01 recent_at 1 day ago, got %v", recent[0].RecentAt)
	}

	// Popular: Old (2 club matches) then Game08 (1 match, freshest of the
	// count-1 games not already recent).
	if len(popular) != 2 {
		t.Fatalf("expected 2 popular entries, got %d", len(popular))
	}
	popularIDs := gameNamesByID(t, pool, popular)
	if popularIDs[popular[0].Id] != "Old" || popularIDs[popular[1].Id] != "Game08" {
		t.Fatalf("expected popular [Old Game08], got [%s %s]", popularIDs[popular[0].Id], popularIDs[popular[1].Id])
	}
	if popular[0].MatchCount == nil || *popular[0].MatchCount != 2 {
		t.Fatalf("expected Old match_count 2, got %v", popular[0].MatchCount)
	}
	if popular[0].RecentAt != nil {
		t.Fatalf("popular entries must not carry recent_at, got %v", popular[0].RecentAt)
	}
	all := append(append([]favoriteGameEntry{}, recent...), popular...)
	for _, e := range all {
		if gameNamesByID(t, pool, []favoriteGameEntry{e})[e.Id] == "Outside" {
			t.Fatalf("outside game leaked into favorites: %+v", e)
		}
	}
}

func TestListFavoriteGames_UserWithoutClubFallsBackToGlobalPopular(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()
	q := db.New(pool)
	router := setupRouter(pool)

	// A user whose player belongs to no club (a bare player): «Недавние»
	// keeps their own games, «Популярные» falls back to the globally most
	// played ones.
	myToken, myUserID := createTestUserWithID(t, pool, true)
	me := createBareTestPlayer(t, pool, "Me")
	if err := q.UpdateUserPlayerID(ctx, db.UpdateUserPlayerIDParams{ID: idpkg.ID(myUserID), PlayerID: &me}); err != nil {
		t.Fatalf("link my player: %v", err)
	}

	mine := createTestGame(t, pool, "Mine")
	mineGuest := createTestPlayer(t, pool, "MineGuest")
	addMatchDaysAgo(t, ctx, pool, mine, 1, map[idpkg.ID]float64{me: 10, mineGuest: 5})
	// Other users play Theirs three times.
	theirs := createTestGame(t, pool, "Theirs")
	o1, o2 := createTestPlayer(t, pool, "Other1"), createTestPlayer(t, pool, "Other2")
	addMatchDaysAgo(t, ctx, pool, theirs, 1, map[idpkg.ID]float64{o1: 10, o2: 5})
	addMatchDaysAgo(t, ctx, pool, theirs, 2, map[idpkg.ID]float64{o1: 10, o2: 5})
	addMatchDaysAgo(t, ctx, pool, theirs, 3, map[idpkg.ID]float64{o1: 10, o2: 5})

	code, recent, popular := getFavoriteGames(t, router, myToken)
	if code != http.StatusOK {
		t.Fatalf("expected 200, got %d", code)
	}
	recentIDs := gameNamesByID(t, pool, recent)
	if len(recent) != 1 || recentIDs[recent[0].Id] != "Mine" {
		t.Fatalf("expected recent [Mine], got %+v", recentIDs)
	}
	popularIDs := gameNamesByID(t, pool, popular)
	if len(popular) != 1 || popularIDs[popular[0].Id] != "Theirs" {
		t.Fatalf("expected popular [Theirs] (Mine excluded as recent), got %+v", popularIDs)
	}
	if popular[0].MatchCount == nil || *popular[0].MatchCount != 3 {
		t.Fatalf("expected Theirs match_count 3, got %v", popular[0].MatchCount)
	}
}

func TestListFavoriteGames_UserWithoutPlayer(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	router := setupRouter(pool)

	// No linked player: no «Недавние» seeds, «Популярные» is the global list.
	token, _ := createTestUserWithID(t, pool, true)
	game := createTestGame(t, pool, "Any")
	p1, p2 := createTestPlayer(t, pool, "P1"), createTestPlayer(t, pool, "P2")
	addMatchDaysAgo(t, context.Background(), pool, game, 1, map[idpkg.ID]float64{p1: 10, p2: 5})

	code, recent, popular := getFavoriteGames(t, router, token)
	if code != http.StatusOK {
		t.Fatalf("expected 200, got %d", code)
	}
	if len(recent) != 0 {
		t.Fatalf("expected empty recent, got %d entries", len(recent))
	}
	popularIDs := gameNamesByID(t, pool, popular)
	if len(popular) != 1 || popularIDs[popular[0].Id] != "Any" {
		t.Fatalf("expected popular [Any], got %+v", popularIDs)
	}
}

func TestListFavoriteGames_RequiresAuth(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	w := httptest.NewRecorder()
	setupRouter(pool).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/games/favorites", nil))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}
