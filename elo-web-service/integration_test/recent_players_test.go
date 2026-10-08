//go:build integration

package integration_test

// GET /players/recent — the player picker's "Недавние" candidates: the current
// user's player pinned first, then players who recently played alongside their
// player or a club member, and players created by them or their club's users
// (creator read from the audit log).

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/elo"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

type recentPlayerEntry struct {
	Id       string     `json:"id"`
	Name     string     `json:"name"`
	RecentAt *time.Time `json:"recent_at"`
}

func getRecentPlayers(t *testing.T, router interface {
	ServeHTTP(http.ResponseWriter, *http.Request)
}, token string) (int, []recentPlayerEntry) {
	t.Helper()
	w := doJSON(t, router, http.MethodGet, "/players/recent", token, "")
	if w.Code != http.StatusOK {
		return w.Code, nil
	}
	var resp struct {
		Status string              `json:"status"`
		Data   []recentPlayerEntry `json:"data"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return w.Code, resp.Data
}

func entryNames(entries []recentPlayerEntry) []string {
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		out = append(out, e.Name)
	}
	return out
}

func equalSlices(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestListRecentPlayers_ClubCoPlayersAndCreations(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()
	q := db.New(pool)
	psvc := elo.NewPlayerService(pool)

	router := setupRouter(pool)

	// The current user and a fellow club member.
	myToken, myUserID := createTestUserWithID(t, pool, true)
	me := createTestPlayer(t, pool, "Me")
	if err := q.UpdateUserPlayerID(ctx, db.UpdateUserPlayerIDParams{ID: idpkg.ID(myUserID), PlayerID: &me}); err != nil {
		t.Fatalf("link my player: %v", err)
	}
	mateToken, mateUserID := createTestUserWithID(t, pool, true)
	_ = mateToken
	mate := createTestPlayer(t, pool, "Mate")
	if err := q.UpdateUserPlayerID(ctx, db.UpdateUserPlayerIDParams{ID: idpkg.ID(mateUserID), PlayerID: &mate}); err != nil {
		t.Fatalf("link mate player: %v", err)
	}
	club, err := q.CreateClub(ctx, db.CreateClubParams{ID: newID(t), Name: "Club A"})
	if err != nil {
		t.Fatalf("create club: %v", err)
	}
	if err := q.AddClubMember(ctx, db.AddClubMemberParams{ClubID: club.ID, PlayerID: me}); err != nil {
		t.Fatalf("add me to club: %v", err)
	}
	if err := q.AddClubMember(ctx, db.AddClubMemberParams{ClubID: club.ID, PlayerID: mate}); err != nil {
		t.Fatalf("add mate to club: %v", err)
	}

	// Players created through the audited service path: by me, by my club's
	// other user, and by an unrelated user (who must not appear). Zed is
	// created first, Amy second — Postgres NOW() is the transaction start
	// time, so Amy's creation timestamp is the later one.
	if _, err := psvc.CreatePlayer(ctx, newID(t), "Zed", idpkg.ID(myUserID)); err != nil {
		t.Fatalf("create Zed: %v", err)
	}
	if _, err := psvc.CreatePlayer(ctx, newID(t), "Amy", idpkg.ID(mateUserID)); err != nil {
		t.Fatalf("create Amy: %v", err)
	}
	_, outUserID := createTestUserWithID(t, pool, true)
	if _, err := psvc.CreatePlayer(ctx, newID(t), "Outsider", idpkg.ID(outUserID)); err != nil {
		t.Fatalf("create Outsider: %v", err)
	}

	// Matches: I played Guest1 yesterday; my club member Mate played Guest2
	// three days ago. Guests are inserted raw (no audit rows).
	guest1 := createTestPlayer(t, pool, "Guest1")
	guest2 := createTestPlayer(t, pool, "Guest2")
	game := createTestGame(t, pool, "Chess")
	matchSvc := newMatchService(pool)
	day1 := time.Now().UTC().AddDate(0, 0, -1)
	if _, err := matchSvc.AddMatch(ctx, blueMenTenantID, game, map[idpkg.ID]float64{me: 10, guest1: 5}, day1, newMatchOpts(t)); err != nil {
		t.Fatalf("AddMatch day1: %v", err)
	}
	if _, err := matchSvc.AddMatch(ctx, blueMenTenantID, game, map[idpkg.ID]float64{mate: 10, guest2: 5}, time.Now().UTC().AddDate(0, 0, -3), newMatchOpts(t)); err != nil {
		t.Fatalf("AddMatch day3: %v", err)
	}

	code, entries := getRecentPlayers(t, router, myToken)
	if code != http.StatusOK {
		t.Fatalf("expected 200, got %d", code)
	}

	// Me pinned; then Amy, Zed (creations, most recent first); Guest1 (played
	// alongside me yesterday); Guest2 before Mate (same match date, name tie).
	want := []string{"Me", "Amy", "Zed", "Guest1", "Guest2", "Mate"}
	if got := entryNames(entries); !equalSlices(got, want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
	for _, e := range entries {
		if e.Name == "Outsider" {
			t.Fatalf("a player created by an unrelated user must not appear: %+v", entries)
		}
		if e.RecentAt == nil {
			t.Fatalf("expected recent_at on %q", e.Name)
		}
	}
	// The co-play recency key is the match date itself (timestamptz keeps
	// microseconds, the in-test time carries nanoseconds — compare loosely).
	for _, e := range entries {
		if e.Name == "Guest1" {
			if d := e.RecentAt.Sub(day1); d > time.Microsecond || d < -time.Microsecond {
				t.Fatalf("expected Guest1 recent_at %v, got %v", day1, e.RecentAt)
			}
		}
	}
}

func TestListRecentPlayers_UserWithoutPlayerOrClub(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()
	router := setupRouter(pool)

	// A user with no linked player and no clubs still sees the players they
	// created (via the audit log), and has no pinned player.
	token, userID := createTestUserWithID(t, pool, true)
	if _, err := elo.NewPlayerService(pool).CreatePlayer(ctx, newID(t), "Lonely", idpkg.ID(userID)); err != nil {
		t.Fatalf("create Lonely: %v", err)
	}
	// Someone else's creation must not leak in.
	_, otherUserID := createTestUserWithID(t, pool, true)
	if _, err := elo.NewPlayerService(pool).CreatePlayer(ctx, newID(t), "NotMine", idpkg.ID(otherUserID)); err != nil {
		t.Fatalf("create NotMine: %v", err)
	}

	code, entries := getRecentPlayers(t, router, token)
	if code != http.StatusOK {
		t.Fatalf("expected 200, got %d", code)
	}
	if got := entryNames(entries); !equalSlices(got, []string{"Lonely"}) {
		t.Fatalf("expected [Lonely], got %v", got)
	}
}

func TestListRecentPlayers_Limit15(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()
	q := db.New(pool)
	router := setupRouter(pool)

	token, myUserID := createTestUserWithID(t, pool, true)
	me := createTestPlayer(t, pool, "Me")
	if err := q.UpdateUserPlayerID(ctx, db.UpdateUserPlayerIDParams{ID: idpkg.ID(myUserID), PlayerID: &me}); err != nil {
		t.Fatalf("link my player: %v", err)
	}

	game := createTestGame(t, pool, "Chess")
	matchSvc := newMatchService(pool)
	// 20 guests in 4 matches, 5 guests per day: the 15-entry cap keeps my
	// player plus the 14 most recent co-players — days 1-2 whole and the
	// alphabetically first four of day 3; day 4 drops off entirely.
	for day := 1; day <= 4; day++ {
		scores := map[idpkg.ID]float64{me: 10}
		for i := 0; i < 5; i++ {
			name := string(rune('0'+day)) + string(rune('a'+i))
			scores[createTestPlayer(t, pool, name)] = float64(5 - i)
		}
		if _, err := matchSvc.AddMatch(ctx, blueMenTenantID, game, scores, time.Now().UTC().AddDate(0, 0, -day), newMatchOpts(t)); err != nil {
			t.Fatalf("AddMatch day %d: %v", day, err)
		}
	}

	code, entries := getRecentPlayers(t, router, token)
	if code != http.StatusOK {
		t.Fatalf("expected 200, got %d", code)
	}
	if len(entries) != 15 {
		t.Fatalf("expected 15 entries, got %d: %v", len(entries), entryNames(entries))
	}
	if entries[0].Name != "Me" {
		t.Fatalf("expected the current player pinned first, got %q", entries[0].Name)
	}
	wantTail := []string{"1a", "1b", "1c", "1d", "1e", "2a", "2b", "2c", "2d", "2e", "3a", "3b", "3c", "3d"}
	if got := entryNames(entries)[1:]; !equalSlices(got, wantTail) {
		t.Fatalf("expected tail %v, got %v", wantTail, got)
	}
}

func TestListRecentPlayers_RequiresAuth(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()

	w := httptest.NewRecorder()
	setupRouter(pool).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/players/recent", nil))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}
