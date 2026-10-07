package elo

import (
	"testing"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

var (
	day  = time.Hour * 24
	base = time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
)

func coPlayer(playerID id.ID, name string, daysAgo int) db.ListRecentCoPlayersRow {
	return db.ListRecentCoPlayersRow{PlayerID: playerID, PlayerName: name, LastMatchAt: base.Add(-time.Duration(daysAgo) * day)}
}

func createdBy(playerID id.ID, name string, daysAgo int) db.ListPlayersCreatedByUsersRow {
	return db.ListPlayersCreatedByUsersRow{PlayerID: playerID, PlayerName: name, CreatedAt: base.Add(-time.Duration(daysAgo) * day)}
}

func names(recent []RecentPlayer) []string {
	out := make([]string, 0, len(recent))
	for _, r := range recent {
		out = append(out, r.Player.Name)
	}
	return out
}

func TestMergeRecentPlayers_PinsMyPlayerFirst(t *testing.T) {
	me := db.Player{ID: "me", Name: "Me"}
	// My player has recent activity (in the co-play bucket) but must still come
	// first by pinning, not by recency.
	recent := mergeRecentPlayers(&me,
		[]db.ListRecentCoPlayersRow{
			coPlayer("me", "Me", 1),
			coPlayer("g", "Guest", 1),
		},
		nil, 15)

	if got := names(recent); len(got) != 2 || got[0] != "Me" || got[1] != "Guest" {
		t.Fatalf("expected [Me Guest], got %v", got)
	}
	// The pin keeps the player's own recency key.
	if !recent[0].RecentAt.Equal(base.Add(-day)) {
		t.Fatalf("expected my player's recent_at to be the co-play date, got %v", recent[0].RecentAt)
	}
}

func TestMergeRecentPlayers_PinsInactivePlayerToo(t *testing.T) {
	me := db.Player{ID: "me", Name: "Me"}
	recent := mergeRecentPlayers(&me,
		[]db.ListRecentCoPlayersRow{coPlayer("g", "Guest", 1)},
		nil, 15)
	if got := names(recent); len(got) != 2 || got[0] != "Me" {
		t.Fatalf("expected my player pinned even without any bucket entry, got %v", got)
	}
}

func TestMergeRecentPlayers_MergesBucketsKeepingLaterDate(t *testing.T) {
	// "Both" appears as a co-player 3 days ago and was created 1 day ago — the
	// creation date must win; "Created" is creation-only; "Co" is co-play only.
	both := createdBy("both", "Both", 1)
	recent := mergeRecentPlayers(nil,
		[]db.ListRecentCoPlayersRow{
			coPlayer("both", "Both", 3),
			coPlayer("co", "Co", 2),
		},
		[]db.ListPlayersCreatedByUsersRow{
			both,
			createdBy("created", "Created", 4),
		}, 15)

	want := []string{"Both", "Co", "Created"}
	if got := names(recent); len(got) != len(want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
	for i, r := range recent {
		if r.Player.Name != want[i] {
			t.Fatalf("expected %v, got %v", want, names(recent))
		}
	}
	if !recent[0].RecentAt.Equal(base.Add(-day)) {
		t.Fatalf("expected Both ranked by creation date, got %v", recent[0].RecentAt)
	}
}

func TestMergeRecentPlayers_OrdersByRecencyThenName(t *testing.T) {
	recent := mergeRecentPlayers(nil,
		[]db.ListRecentCoPlayersRow{
			coPlayer("b", "Beta", 2),
			coPlayer("a", "Alpha", 2), // same date as Beta — name tie-break
			coPlayer("z", "Zed", 1),
		},
		[]db.ListPlayersCreatedByUsersRow{createdBy("n", "Nobody-date", 99)}, // no-activity entries last
		15)

	want := []string{"Zed", "Alpha", "Beta", "Nobody-date"}
	if got := names(recent); len(got) != len(want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
	for i := range want {
		if recent[i].Player.Name != want[i] {
			t.Fatalf("expected %v, got %v", want, names(recent))
		}
	}
}

func TestMergeRecentPlayers_RespectsLimitWithPin(t *testing.T) {
	me := db.Player{ID: "me", Name: "Me"}
	var co []db.ListRecentCoPlayersRow
	for i := 0; i < 20; i++ {
		co = append(co, coPlayer(id.ID(string(rune('a'+i))), string(rune('a'+i)), i+1))
	}
	recent := mergeRecentPlayers(&me, co, nil, 15)
	if len(recent) != 15 {
		t.Fatalf("expected 15 entries, got %d", len(recent))
	}
	if recent[0].Player.ID != "me" {
		t.Fatalf("expected the pin to consume a slot at position 0, got %q", recent[0].Player.ID)
	}
}

func TestMergeRecentPlayers_NoPlayerNoPin(t *testing.T) {
	recent := mergeRecentPlayers(nil,
		[]db.ListRecentCoPlayersRow{coPlayer("g", "Guest", 1)}, nil, 15)
	if got := names(recent); len(got) != 1 || got[0] != "Guest" {
		t.Fatalf("expected [Guest], got %v", got)
	}
}
