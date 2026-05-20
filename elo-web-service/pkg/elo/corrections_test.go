package elo

import "testing"

func TestDetermineCorrectionLeague(t *testing.T) {
	s := EloSettings{NewbieLeagueGoal: 500}

	tests := []struct {
		prev      string
		newRating float64
		want      string
	}{
		// below goal → always newbie
		{"newbie", 499, "newbie"},
		{"amateur", 0, "newbie"},
		{"amateur", 499.9, "newbie"},
		{"elite", 0, "newbie"},
		{"elite", 499.9, "newbie"},

		// at or above goal, was newbie → amateur
		{"newbie", 500, "amateur"},
		{"newbie", 1000, "amateur"},

		// at or above goal, was amateur/elite → unchanged
		{"amateur", 500, "amateur"},
		{"amateur", 1000, "amateur"},
		{"elite", 500, "elite"},
		{"elite", 1000, "elite"},
	}

	for _, tt := range tests {
		got := determineCorrectionLeague(tt.prev, tt.newRating, s)
		if got != tt.want {
			t.Errorf("determineCorrectionLeague(%q, %.1f) = %q, want %q",
				tt.prev, tt.newRating, got, tt.want)
		}
	}
}
