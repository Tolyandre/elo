package elo

import (
	"testing"

	"github.com/tolyandre/elo-web-service/pkg/arenasettings"
)

func TestDetermineCorrectionLeague(t *testing.T) {
	// Global-arena-shaped settings: newbie (goal gap 16), amateur, elite.
	arena := Arena{Settings: arenasettings.Settings{
		StartingRating: 0,
		Leagues: []arenasettings.League{
			{Kind: LeagueNewbie, GoalGap: 16},
			{Kind: LeagueAmateur},
			{Kind: LeagueElite},
		},
	}}
	// prevElo = 1000; gap = |1000 - newRating|
	const elo = 1000.0

	tests := []struct {
		prev      string
		newRating float64
		want      string
	}{
		// gap > goalGap → always newbie regardless of prev
		{"newbie", 983, "newbie"},  // gap = 17
		{"amateur", 983, "newbie"}, // gap = 17
		{"elite", 983, "newbie"},   // gap = 17
		{"amateur", 0, "newbie"},   // gap = 1000
		{"elite", 0, "newbie"},     // gap = 1000

		// gap <= goalGap, was newbie → amateur
		{"newbie", 984, "amateur"},  // gap = 16
		{"newbie", 1000, "amateur"}, // gap = 0

		// gap <= goalGap, was amateur/elite → unchanged
		{"amateur", 984, "amateur"},  // gap = 16
		{"amateur", 1000, "amateur"}, // gap = 0
		{"elite", 984, "elite"},      // gap = 16
		{"elite", 1000, "elite"},     // gap = 0
	}

	for _, tt := range tests {
		prev := tt.prev
		got := determineCorrectionLeague(&prev, tt.newRating, elo, arena)
		if got == nil || *got != tt.want {
			t.Errorf("determineCorrectionLeague(%q, %.1f, elo=%.0f) = %v, want %q",
				tt.prev, tt.newRating, elo, got, tt.want)
		}
	}
}

func TestDetermineArenaLeague(t *testing.T) {
	newbieOnly := Arena{Settings: arenasettings.Settings{Leagues: []arenasettings.League{
		{Kind: LeagueNewbie, GoalGap: 16},
	}}}
	noLeagues := Arena{}

	if got := determineArenaLeague(strPtr(LeagueNewbie), 0, 100, 0, 0, noLeagues); got != nil {
		t.Errorf("league-less arena: got %v, want nil", got)
	}
	if got := determineArenaLeague(strPtr(LeagueNewbie), 1000, 1100, 0, 0, newbieOnly); got == nil || *got != LeagueNewbie {
		t.Errorf("newbie-only arena with open gap: got %v, want newbie", got)
	}
	// Newbie-only arena with the gap closed stays in the only league there is.
	if got := determineArenaLeague(strPtr(LeagueNewbie), 1000, 1000, 0, 0, newbieOnly); got == nil || *got != LeagueNewbie {
		t.Errorf("newbie-only arena with closed gap: got %v, want newbie", got)
	}
}

func TestInitialArenaLeague(t *testing.T) {
	s := EloSettings{StartingElo: 1000}
	global := Arena{Settings: arenasettings.Settings{
		StartingRating: 0,
		Leagues: []arenasettings.League{
			{Kind: LeagueNewbie, GoalGap: 16},
			{Kind: LeagueAmateur},
			{Kind: LeagueElite, Matches6M: 20, Matches2M: 3},
		},
	}}
	if got := initialArenaLeague(global, s); got == nil || *got != LeagueNewbie {
		t.Errorf("global arena starting at 0: got %v, want newbie", got)
	}
	// Tournament arena: no leagues → nil league, rating ≡ elo.
	tournament := Arena{Settings: arenasettings.Settings{StartingRating: 1000}}
	if got := initialArenaLeague(tournament, s); got != nil {
		t.Errorf("league-less arena: got %v, want nil", got)
	}
}

func TestArenaLeaguePriority(t *testing.T) {
	global := Arena{Settings: arenasettings.Settings{Leagues: []arenasettings.League{
		{Kind: LeagueNewbie, GoalGap: 16},
		{Kind: LeagueAmateur},
		{Kind: LeagueElite, Matches6M: 20, Matches2M: 3},
	}}}

	// Elite ranks first, newbie last — the settings list is promotion order,
	// the priority inverts it.
	newbie, amateur, elite := LeagueNewbie, LeagueAmateur, LeagueElite
	if got := arenaLeaguePriority(&elite, global); got != 0 {
		t.Errorf("elite priority = %d, want 0", got)
	}
	if got := arenaLeaguePriority(&amateur, global); got != 1 {
		t.Errorf("amateur priority = %d, want 1", got)
	}
	if got := arenaLeaguePriority(&newbie, global); got != 2 {
		t.Errorf("newbie priority = %d, want 2", got)
	}

	// League-less arenas: everyone equal (ties resolved by rating).
	if got := arenaLeaguePriority(nil, Arena{}); got != 0 {
		t.Errorf("nil league priority = %d, want 0", got)
	}
}
