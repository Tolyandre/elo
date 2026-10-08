package elo

import (
	"testing"

	"github.com/tolyandre/elo-web-service/pkg/arenasettings"
)

// leagueArena builds a display arena with the given leagues in promotion
// order; the newbie league (when present) gets the given goal gap, the elite
// league the 6m/2m match counts.
func leagueArena(newbieGoalGap float64, elite6m, elite2m int, kinds ...string) Arena {
	var leagues []arenasettings.League
	for _, kind := range kinds {
		l := arenasettings.League{Kind: kind}
		switch kind {
		case LeagueNewbie:
			l.GoalGap = newbieGoalGap
		case LeagueElite:
			l.Matches6M = elite6m
			l.Matches2M = elite2m
		}
		leagues = append(leagues, l)
	}
	return Arena{Settings: arenasettings.Settings{StartingRating: 900, Leagues: leagues}}
}

// displayLeague feeds the players listing: a league-less arena (a tenant main
// arena configured without leagues) must name no league for anyone — settled
// or not — and never trip over the nil the league helpers return there
// (ListPlayers 500ed on exactly that dereference). An elite-only arena keeps
// everyone in elite: there is no league below to promote from, so the stored
// elite is never demoted regardless of the match counts.
func TestDisplayLeague(t *testing.T) {
	elo := EloSettings{StartingElo: 1000}
	str := func(s string) *string { return &s }

	tests := []struct {
		name    string
		arena   Arena
		stored  *string
		settled bool
		cnt60   int
		cnt180  int
		want    string
	}{
		{
			name:    "league-less arena, unsettled player",
			arena:   leagueArena(0, 0, 0),
			settled: false,
			want:    "",
		},
		{
			name:    "league-less arena, settled player (SQL coalesces NULL league to 'newbie')",
			arena:   leagueArena(0, 0, 0),
			stored:  str(LeagueNewbie),
			settled: true,
			want:    "",
		},
		{
			name:    "elite-only arena, unsettled player starts in elite",
			arena:   leagueArena(0, 20, 3, LeagueElite),
			settled: false,
			want:    LeagueElite,
		},
		{
			name:    "elite-only arena, stale elite is not demoted (no base league)",
			arena:   leagueArena(0, 20, 3, LeagueElite),
			stored:  str(LeagueElite),
			settled: true,
			want:    LeagueElite,
		},
		{
			name:    "full ladder, unsettled with a starting gap beyond the newbie goal",
			arena:   leagueArena(16, 20, 3, LeagueNewbie, LeagueAmateur, LeagueElite),
			settled: false,
			want:    LeagueNewbie,
		},
		{
			name:    "full ladder, unsettled within the newbie goal starts in the base league",
			arena:   leagueArena(500, 20, 3, LeagueNewbie, LeagueAmateur, LeagueElite),
			settled: false,
			want:    LeagueAmateur,
		},
		{
			name:    "full ladder, stale elite demotes to the base league",
			arena:   leagueArena(16, 20, 3, LeagueNewbie, LeagueAmateur, LeagueElite),
			stored:  str(LeagueElite),
			settled: true,
			want:    LeagueAmateur,
		},
		{
			name:    "full ladder, elite with enough recent matches holds",
			arena:   leagueArena(16, 20, 3, LeagueNewbie, LeagueAmateur, LeagueElite),
			stored:  str(LeagueElite),
			settled: true,
			cnt60:   3,
			cnt180:  20,
			want:    LeagueElite,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := displayLeague(tt.stored, tt.settled, tt.cnt60, tt.cnt180, tt.arena, elo)
			if got != tt.want {
				t.Errorf("displayLeague() = %q, want %q", got, tt.want)
			}
		})
	}
}
