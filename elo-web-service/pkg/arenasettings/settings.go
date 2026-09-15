package arenasettings

import (
	"encoding/json"
	"fmt"
)

// League describes one league of an arena. The params are set per kind; the
// zero values of the other kinds' fields are meaningless.
type League struct {
	Kind string // "newbie", "amateur", "elite"

	// Newbie league params (ADR-03): the display rating catches up to the
	// true Elo while elo - rating > GoalGap; Earned/EarnedMin/EarnedMax/Tau
	// drive the catch-up scaling.
	GoalGap   float64
	EarnedMin float64
	EarnedMax float64
	Tau       float64

	// Elite league promotion thresholds.
	Matches6M int
	Matches2M int
}

// Settings is the typed view of a validated settings document. Leagues are in
// promotion order (later = higher); empty means the arena has no leagues.
type Settings struct {
	StartingRating float64
	Leagues        []League
}

// Newbie returns the newbie league params; ok=false when the arena has none.
func (s Settings) Newbie() (League, bool) {
	return firstLeague(s.Leagues, "newbie")
}

// Elite returns the elite league params; ok=false when the arena has none.
func (s Settings) Elite() (League, bool) {
	return firstLeague(s.Leagues, "elite")
}

// HasLeague reports whether the arena has the given league kind.
func (s Settings) HasLeague(kind string) bool {
	_, ok := firstLeague(s.Leagues, kind)
	return ok
}

func firstLeague(leagues []League, kind string) (League, bool) {
	for _, l := range leagues {
		if l.Kind == kind {
			return l, true
		}
	}
	return League{}, false
}

// leagueRank orders kinds canonically: newbie → amateur → elite. The array
// order in the document must be a subsequence of this order; the progression
// logic is written against kinds, so an arbitrary order would be meaningless.
var leagueRank = map[string]int{"newbie": 0, "amateur": 1, "elite": 2}

// document mirrors the v1 schema shape for unmarshalling.
type document struct {
	StartingRating float64 `json:"starting_rating"`
	Leagues        []struct {
		Kind      string   `json:"kind"`
		GoalGap   *float64 `json:"goal_gap"`
		EarnedMin *float64 `json:"earned_min"`
		EarnedMax *float64 `json:"earned_max"`
		Tau       *float64 `json:"tau"`
		Matches6M *int     `json:"matches_6m"`
		Matches2M *int     `json:"matches_2m"`
	} `json:"leagues"`
}

// Parse converts a validated settings document into the typed Settings. It
// enforces what JSON Schema cannot: league kinds are unique and follow the
// canonical promotion order (a subsequence of newbie → amateur → elite).
func Parse(raw json.RawMessage) (Settings, error) {
	var doc document
	if err := json.Unmarshal(raw, &doc); err != nil {
		return Settings{}, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	settings := Settings{StartingRating: doc.StartingRating, Leagues: make([]League, 0, len(doc.Leagues))}
	prevRank := -1
	for _, l := range doc.Leagues {
		rank, ok := leagueRank[l.Kind]
		if !ok {
			return Settings{}, fmt.Errorf("%w: unknown league kind %q", ErrInvalid, l.Kind)
		}
		if rank <= prevRank {
			return Settings{}, fmt.Errorf("%w: leagues must be unique and follow newbie→amateur→elite order, got %q after rank %d", ErrInvalid, l.Kind, prevRank)
		}
		prevRank = rank
		league := League{Kind: l.Kind}
		switch l.Kind {
		case "newbie":
			league.GoalGap = *l.GoalGap
			league.EarnedMin = *l.EarnedMin
			league.EarnedMax = *l.EarnedMax
			league.Tau = *l.Tau
		case "elite":
			league.Matches6M = *l.Matches6M
			league.Matches2M = *l.Matches2M
		}
		settings.Leagues = append(settings.Leagues, league)
	}
	return settings, nil
}
