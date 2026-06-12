package elo

import (
	"errors"
	"testing"
	"time"
)

func TestValidateNewMatchDate(t *testing.T) {
	now := time.Date(2026, 6, 12, 12, 0, 0, 0, time.UTC)

	cases := []struct {
		name    string
		date    time.Time
		wantErr bool
	}{
		{"now", now, false},
		{"hour ago", now.Add(-time.Hour), false},
		{"29 days ago", now.Add(-29 * 24 * time.Hour), false},
		{"slightly future within skew", now.Add(5 * time.Minute), false},
		{"future beyond skew", now.Add(time.Hour), true},
		{"31 days ago", now.Add(-31 * 24 * time.Hour), true},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := validateNewMatchDate(now, c.date)
			if c.wantErr && !errors.Is(err, ErrMatchDateOutOfRange) {
				t.Errorf("expected ErrMatchDateOutOfRange, got %v", err)
			}
			if !c.wantErr && err != nil {
				t.Errorf("expected no error, got %v", err)
			}
		})
	}
}
