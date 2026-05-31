package elo

import "testing"

func TestDetermineCorrectionLeague(t *testing.T) {
	s := EloSettings{NewbieLeagueGoalGap: 16}
	// prevElo = 1000; gap = |1000 - newRating|
	const elo = 1000.0

	tests := []struct {
		prev      string
		newRating float64
		want      string
	}{
		// gap > goalGap → always newbie regardless of prev
		{"newbie", 983, "newbie"},   // gap = 17
		{"amateur", 983, "newbie"},  // gap = 17
		{"elite", 983, "newbie"},    // gap = 17
		{"amateur", 0, "newbie"},    // gap = 1000
		{"elite", 0, "newbie"},      // gap = 1000

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
		got := determineCorrectionLeague(tt.prev, tt.newRating, elo, s)
		if got != tt.want {
			t.Errorf("determineCorrectionLeague(%q, %.1f, elo=%.0f) = %q, want %q",
				tt.prev, tt.newRating, elo, got, tt.want)
		}
	}
}
