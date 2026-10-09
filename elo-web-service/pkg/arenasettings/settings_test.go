package arenasettings

import (
	"encoding/json"
	"errors"
	"testing"
)

func leagueDoc(kind string) map[string]any {
	switch kind {
	case "newbie":
		return map[string]any{"kind": kind, "goal_gap": 16.0, "earned_min": 2.0, "earned_max": 64.0, "tau": 100.0}
	case "elite":
		return map[string]any{"kind": kind, "matches_6m": 20, "matches_2m": 3}
	default:
		return map[string]any{"kind": kind}
	}
}

func settingsJSON(t *testing.T, kinds ...string) json.RawMessage {
	t.Helper()
	leagues := make([]map[string]any, len(kinds))
	for i, kind := range kinds {
		leagues[i] = leagueDoc(kind)
	}
	raw, err := json.Marshal(map[string]any{"starting_rating": 900.0, "leagues": leagues})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// A settings document either has no leagues at all or at least two (ADR-24):
// a single league would only rename the players list's caption, and a lone
// newbie league would additionally keep the catch-up mechanics running with
// «wins needed» hints pointing at a promotion that does not exist. Enforced
// by the schema on the write paths only (arena create/PATCH, tenant
// settings); Parse below must stay cardinality-blind.
func TestValidateLeaguesCardinality(t *testing.T) {
	for _, kinds := range [][]string{
		nil, // no leagues — the league-less flat list
		{"newbie", "amateur"},
		{"amateur", "elite"},
		{"newbie", "amateur", "elite"},
	} {
		if err := Validate(settingsJSON(t, kinds...)); err != nil {
			t.Errorf("Validate(%v) = %v, want nil", kinds, err)
		}
	}
	for _, kinds := range [][]string{
		{"newbie"},
		{"amateur"},
		{"elite"},
	} {
		if err := Validate(settingsJSON(t, kinds...)); !errors.Is(err, ErrInvalid) {
			t.Errorf("Validate(%v) = %v, want ErrInvalid", kinds, err)
		}
	}
}

// Parse serves every read of every stored arena. Documents with a single
// league may exist from before the prohibition; reads must keep rendering
// them (only writes are gated).
func TestParseToleratesSingleLeague(t *testing.T) {
	settings, err := Parse(settingsJSON(t, "elite"))
	if err != nil {
		t.Fatalf("Parse(single league) = %v, want nil", err)
	}
	if len(settings.Leagues) != 1 || settings.Leagues[0].Kind != "elite" {
		t.Errorf("Parse(single league) = %+v, want one elite league", settings.Leagues)
	}
}
