package arenasettings

import (
	"encoding/json"
	"errors"
	"testing"
)

func leagueDoc(kind string) map[string]any {
	switch kind {
	case "newbie":
		return map[string]any{"kind": kind, "goal_gap": 16.0}
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
	return marshalSettings(t, 900.0, map[string]any{"earned_min": 2.0, "earned_max": 64.0, "tau": 100.0}, leagues)
}

func marshalSettings(t *testing.T, startingRating float64, catchUp map[string]any, leagues []map[string]any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"starting_rating": startingRating,
		"catch_up":        catchUp,
		"leagues":         leagues,
	})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// A settings document either has no leagues at all or at least two (ADR-24):
// a single league would only rename the players list's caption, and a lone
// newbie league would additionally keep the «wins needed» hints pointing at a
// promotion that does not exist. Enforced by the schema on the write paths
// only (arena create/PATCH, tenant settings); Parse below must stay
// cardinality-blind.
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
	settings, err := Parse(settingsJSON(t, "elite"), CurrentVersion)
	if err != nil {
		t.Fatalf("Parse(single league) = %v, want nil", err)
	}
	if len(settings.Leagues) != 1 || settings.Leagues[0].Kind != "elite" {
		t.Errorf("Parse(single league) = %+v, want one elite league", settings.Leagues)
	}
}

func TestParseReadsCatchUp(t *testing.T) {
	raw := marshalSettings(t, 950.0, map[string]any{"earned_min": 1.5, "earned_max": 50.0, "tau": 80.0},
		[]map[string]any{leagueDoc("newbie"), leagueDoc("amateur")})
	settings, err := Parse(raw, CurrentVersion)
	if err != nil {
		t.Fatalf("Parse = %v, want nil", err)
	}
	if settings.CatchUp != (CatchUp{EarnedMin: 1.5, EarnedMax: 50.0, Tau: 80.0}) {
		t.Errorf("CatchUp = %+v, want {1.5 50 80}", settings.CatchUp)
	}
	if settings.Leagues[0].GoalGap != 16.0 {
		t.Errorf("newbie GoalGap = %v, want 16", settings.Leagues[0].GoalGap)
	}
	// The catch-up parameters are not league fields anymore.
	if settings.Leagues[0] != (League{Kind: "newbie", GoalGap: 16.0}) {
		t.Errorf("newbie league = %+v, want {newbie 16}", settings.Leagues[0])
	}
}

// v1 stored the catch-up parameters inside the newbie league (and had nowhere
// to put them when the arena had none). The migrator lifts them into the
// top-level catch_up object, falls back to the historical defaults when
// absent, and strips the league fields the v2 schema rejects.
func TestMigrateV1ToV2(t *testing.T) {
	v1 := func(leagues []map[string]any) json.RawMessage {
		raw, err := json.Marshal(map[string]any{"starting_rating": 900.0, "leagues": leagues})
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}

	t.Run("params move from the newbie league", func(t *testing.T) {
		doc, version, err := MigrateData(1, v1([]map[string]any{
			{"kind": "newbie", "goal_gap": 16.0, "earned_min": 3.0, "earned_max": 40.0, "tau": 55.0},
			{"kind": "amateur"},
		}))
		if err != nil || version != 2 {
			t.Fatalf("MigrateData = (%v), %d, %v — want v2, nil", doc, version, err)
		}
		settings, err := Parse(doc, version)
		if err != nil {
			t.Fatalf("Parse(migrated) = %v, want nil", err)
		}
		if settings.CatchUp != (CatchUp{EarnedMin: 3.0, EarnedMax: 40.0, Tau: 55.0}) {
			t.Errorf("CatchUp = %+v, want {3 40 55}", settings.CatchUp)
		}
		if settings.Leagues[0] != (League{Kind: "newbie", GoalGap: 16.0}) {
			t.Errorf("newbie league = %+v, want {newbie 16}", settings.Leagues[0])
		}
	})

	t.Run("no newbie league falls back to the historical defaults", func(t *testing.T) {
		doc, version, err := MigrateData(1, v1([]map[string]any{{"kind": "amateur"}, {"kind": "elite", "matches_6m": 20, "matches_2m": 3}}))
		if err != nil {
			t.Fatalf("MigrateData = %v, want nil", err)
		}
		settings, err := Parse(doc, version)
		if err != nil {
			t.Fatalf("Parse(migrated) = %v, want nil", err)
		}
		if settings.CatchUp != (CatchUp{EarnedMin: defaultCatchUpEarnedMin, EarnedMax: defaultCatchUpEarnedMax, Tau: defaultCatchUpTau}) {
			t.Errorf("CatchUp = %+v, want the historical defaults", settings.CatchUp)
		}
	})

	t.Run("no leagues (camp/tournament arena)", func(t *testing.T) {
		doc, version, err := MigrateData(1, v1(nil))
		if err != nil {
			t.Fatalf("MigrateData = %v, want nil", err)
		}
		if _, err := Parse(doc, version); err != nil {
			t.Errorf("Parse(migrated) = %v, want nil", err)
		}
	})
}

// A document the boot data migration has not upgraded yet must never parse
// into zero-valued catch-up parameters — the read-side guard fails loudly.
func TestParseRejectsStaleVersion(t *testing.T) {
	raw := marshalSettings(t, 950.0, map[string]any{"earned_min": 1.5, "earned_max": 50.0, "tau": 80.0},
		[]map[string]any{leagueDoc("newbie"), leagueDoc("amateur")})
	if _, err := Parse(raw, CurrentVersion-1); !errors.Is(err, ErrInvalid) {
		t.Errorf("Parse(stale version) = %v, want ErrInvalid", err)
	}
}
