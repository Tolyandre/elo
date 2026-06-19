//go:build integration

package integration_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/elo"
)

// TestTournamentStats verifies per-player medal counts use competition ranking
// (tied players share a place) and that matches auto-enrol players + back the stats.
func TestTournamentStats(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()

	a := createTestPlayer(t, pool, "TA")
	b := createTestPlayer(t, pool, "TB")
	c := createTestPlayer(t, pool, "TC")
	gameID := createTestGame(t, pool, "TGame")

	tSvc := elo.NewTournamentService(pool)
	mSvc := elo.NewMatchService(pool, elo.NewMarketService(pool))

	now := time.Now().Truncate(time.Second)
	tour, err := tSvc.CreateTournament(ctx, "Camp", now.Add(-time.Hour), now.Add(time.Hour), nil)
	if err != nil {
		t.Fatalf("create tournament: %v", err)
	}

	// Match 1: A=10, B=10 (tie for 1st), C=5 (3rd, since RANK skips 2).
	if _, err := mSvc.AddMatch(ctx, gameID, map[int32]float64{a: 10, b: 10, c: 5}, now.Add(-30*time.Minute),
		elo.AddMatchOpts{TournamentIDs: []int32{tour.ID}}); err != nil {
		t.Fatalf("add match 1: %v", err)
	}
	// Match 2: A=10 (1st), B=5 (2nd), C=1 (3rd).
	if _, err := mSvc.AddMatch(ctx, gameID, map[int32]float64{a: 10, b: 5, c: 1}, now.Add(-20*time.Minute),
		elo.AddMatchOpts{TournamentIDs: []int32{tour.ID}}); err != nil {
		t.Fatalf("add match 2: %v", err)
	}

	stats, err := tSvc.GetStats(ctx, tour.ID)
	if err != nil {
		t.Fatalf("stats: %v", err)
	}
	byID := map[int32]db.GetTournamentStatsRow{}
	for _, r := range stats {
		byID[r.PlayerID] = r
	}

	// A: two firsts, two matches.
	if got := byID[a]; got.FirstCount != 2 || got.MatchesCount != 2 {
		t.Errorf("A stats = %+v, want first=2 matches=2", got)
	}
	// B: one first (tie in match 1), one second (match 2).
	if got := byID[b]; got.FirstCount != 1 || got.SecondCount != 1 {
		t.Errorf("B stats = %+v, want first=1 second=1", got)
	}
	// C: two thirds (RANK skips 2nd after the tie in match 1).
	if got := byID[c]; got.ThirdCount != 2 || got.SecondCount != 0 {
		t.Errorf("C stats = %+v, want third=2 second=0", got)
	}

	// All three players were auto-enrolled by adding the matches.
	rows, err := tSvc.GetTournament(ctx, tour.ID)
	if err != nil {
		t.Fatalf("get tournament: %v", err)
	}
	members := map[int32]bool{}
	for _, r := range rows {
		if r.PlayerID.Valid {
			members[r.PlayerID.Int32] = true
		}
	}
	if !members[a] || !members[b] || !members[c] {
		t.Errorf("expected A,B,C enrolled, got %v", members)
	}
}

// TestMatchAutoJoinsActiveTournament verifies the server-side invariant: a match
// whose players are ALL members of a currently-running tournament auto-joins it even
// when the client passes no tournament IDs; a match with an outside player does not;
// and an explicit tournament ID still enrols non-members.
func TestMatchAutoJoinsActiveTournament(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()

	a := createTestPlayer(t, pool, "AA")
	b := createTestPlayer(t, pool, "AB")
	c := createTestPlayer(t, pool, "AC")
	gameID := createTestGame(t, pool, "AGame")

	tSvc := elo.NewTournamentService(pool)
	mSvc := elo.NewMatchService(pool, elo.NewMarketService(pool))
	q := db.New(pool)

	now := time.Now().Truncate(time.Second)
	tour, err := tSvc.CreateTournament(ctx, "AutoCamp", now.Add(-time.Hour), now.Add(time.Hour), []int32{a, b})
	if err != nil {
		t.Fatalf("create tournament: %v", err)
	}

	matchTournamentIDs := func(matchID int32) []int32 {
		rows, err := q.ListTournamentsByMatchIDs(ctx, []int32{matchID})
		if err != nil {
			t.Fatalf("list tournaments for match %d: %v", matchID, err)
		}
		ids := make([]int32, 0, len(rows))
		for _, r := range rows {
			ids = append(ids, r.TournamentID)
		}
		return ids
	}
	contains := func(ids []int32, want int32) bool {
		for _, id := range ids {
			if id == want {
				return true
			}
		}
		return false
	}

	// All players are members → auto-joins despite empty AddMatchOpts.
	m1, err := mSvc.AddMatch(ctx, gameID, map[int32]float64{a: 10, b: 5}, now.Add(-30*time.Minute), elo.AddMatchOpts{})
	if err != nil {
		t.Fatalf("add match 1: %v", err)
	}
	if ids := matchTournamentIDs(m1.ID); !contains(ids, tour.ID) {
		t.Errorf("match with all members: tournaments = %v, want to include %d", ids, tour.ID)
	}

	// C is not a member → match must NOT auto-join.
	m2, err := mSvc.AddMatch(ctx, gameID, map[int32]float64{a: 10, c: 5}, now.Add(-20*time.Minute), elo.AddMatchOpts{})
	if err != nil {
		t.Fatalf("add match 2: %v", err)
	}
	if ids := matchTournamentIDs(m2.ID); contains(ids, tour.ID) {
		t.Errorf("match with outside player auto-joined %d unexpectedly: %v", tour.ID, ids)
	}

	// Explicit tournament ID still enrols the non-member C.
	m3, err := mSvc.AddMatch(ctx, gameID, map[int32]float64{a: 10, c: 5}, now.Add(-10*time.Minute),
		elo.AddMatchOpts{TournamentIDs: []int32{tour.ID}})
	if err != nil {
		t.Fatalf("add match 3: %v", err)
	}
	if ids := matchTournamentIDs(m3.ID); !contains(ids, tour.ID) {
		t.Errorf("explicit tournament: tournaments = %v, want to include %d", ids, tour.ID)
	}
	rows, err := tSvc.GetTournament(ctx, tour.ID)
	if err != nil {
		t.Fatalf("get tournament: %v", err)
	}
	members := map[int32]bool{}
	for _, r := range rows {
		if r.PlayerID.Valid {
			members[r.PlayerID.Int32] = true
		}
	}
	if !members[c] {
		t.Errorf("expected C enrolled via explicit tournament id, members = %v", members)
	}
}

// TestTournamentUpdateValidations covers the three guard rails: removing a member
// who played a match, narrowing dates past played matches, and deleting a non-empty
// tournament.
func TestTournamentUpdateValidations(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()

	a := createTestPlayer(t, pool, "VA")
	b := createTestPlayer(t, pool, "VB")
	gameID := createTestGame(t, pool, "VGame")

	tSvc := elo.NewTournamentService(pool)
	mSvc := elo.NewMatchService(pool, elo.NewMarketService(pool))

	now := time.Now().Truncate(time.Second)
	start := now.Add(-time.Hour)
	end := now.Add(time.Hour)
	tour, err := tSvc.CreateTournament(ctx, "Guarded", start, end, nil)
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	matchTime := now.Add(-30 * time.Minute)
	if _, err := mSvc.AddMatch(ctx, gameID, map[int32]float64{a: 10, b: 5}, matchTime,
		elo.AddMatchOpts{TournamentIDs: []int32{tour.ID}}); err != nil {
		t.Fatalf("add match: %v", err)
	}

	// Removing A (who played) must be rejected; keeping both is fine.
	if _, err := tSvc.UpdateTournament(ctx, tour.ID, "Guarded", start, end, []int32{b}); !errors.Is(err, elo.ErrTournamentMemberHasMatches) {
		t.Errorf("removing player with matches: got %v, want ErrTournamentMemberHasMatches", err)
	}

	// Narrowing the window past the match date must be rejected.
	if _, err := tSvc.UpdateTournament(ctx, tour.ID, "Guarded", now.Add(-10*time.Minute), end, []int32{a, b}); !errors.Is(err, elo.ErrTournamentDatesNarrowEloRange) {
		t.Errorf("narrowing dates: got %v, want ErrTournamentDatesNarrowEloRange", err)
	}

	// Deleting a tournament with members must be rejected.
	if _, err := tSvc.DeleteTournament(ctx, tour.ID); !errors.Is(err, elo.ErrTournamentHasMembers) {
		t.Errorf("delete with members: got %v, want ErrTournamentHasMembers", err)
	}

	// An empty tournament can be deleted.
	empty, err := tSvc.CreateTournament(ctx, "Empty", start, end, nil)
	if err != nil {
		t.Fatalf("create empty: %v", err)
	}
	if _, err := tSvc.DeleteTournament(ctx, empty.ID); err != nil {
		t.Errorf("delete empty tournament: %v", err)
	}
}
