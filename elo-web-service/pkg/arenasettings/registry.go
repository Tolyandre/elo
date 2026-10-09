// Package arenasettings describes the versioned settings document stored in
// arenas.settings (ADR-24). It registers its (single) document kind into the
// shared versioned document registry (pkg/docregistry), as the audit details
// documents already do (ADR-14): an embedded JSON Schema (draft 2020-12), a
// CurrentVersion, and — once older versions exist — per-version migrators
// applied at startup (see pkg/db/migrate_data.go) so reads always return the
// current version.
//
// The package is a leaf (only stdlib + the JSON Schema library) so that
// pkg/db's startup data migration can import it; pkg/elo imports it for
// validation on write and parses the validated document into the typed
// Settings struct — the schema is the contract, the struct the view.
package arenasettings

import (
	"embed"
	"encoding/json"
	"errors"

	"github.com/tolyandre/elo-web-service/pkg/docregistry"
)

//go:embed *.json
var schemasFS embed.FS

// Kind is the (single) document kind stored in arenas.settings.
const Kind = "arena-settings"

// CurrentVersion is the schema_version currently WRITTEN by new code and the
// version every stored document is upgraded to at startup.
const CurrentVersion = 2

// ErrInvalid is returned when a settings document fails validation.
var ErrInvalid = errors.New("invalid arena settings")

var reg = docregistry.New("arenasettings", schemasFS, errors.New("unknown arenasettings kind"), ErrInvalid)

func init() {
	reg.Register(Kind, CurrentVersion, "arena-settings.v2.json")
	reg.RegisterMigrator(Kind, 1, migrateV1ToV2)
}

// v1 documents kept the catch-up parameters inside the newbie league; when
// the arena had no newbie league they had nowhere to live. These are the
// historical elo_settings defaults (ADR-03) used for such documents.
const (
	defaultCatchUpEarnedMin = 2.0
	defaultCatchUpEarnedMax = 64.0
	defaultCatchUpTau       = 100.0
)

// migrateV1ToV2 moves the catch-up parameters (earned_min, earned_max, tau)
// out of the newbie league into the top-level catch_up object: the catch-up
// is driven by the starting-rating vs starting-elo gap, not by the league
// existing. Documents without a newbie league get the historical defaults;
// the league entries keep only their own params (the v2 schema rejects
// leftovers).
func migrateV1ToV2(raw json.RawMessage) (json.RawMessage, error) {
	var doc struct {
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
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, err
	}
	catchUp := struct {
		EarnedMin float64 `json:"earned_min"`
		EarnedMax float64 `json:"earned_max"`
		Tau       float64 `json:"tau"`
	}{defaultCatchUpEarnedMin, defaultCatchUpEarnedMax, defaultCatchUpTau}
	leagues := make([]map[string]any, 0, len(doc.Leagues))
	for _, l := range doc.Leagues {
		league := map[string]any{"kind": l.Kind}
		if l.GoalGap != nil {
			league["goal_gap"] = *l.GoalGap
		}
		if l.Matches6M != nil {
			league["matches_6m"] = *l.Matches6M
		}
		if l.Matches2M != nil {
			league["matches_2m"] = *l.Matches2M
		}
		if l.Kind == "newbie" && l.EarnedMin != nil && l.EarnedMax != nil && l.Tau != nil {
			catchUp.EarnedMin, catchUp.EarnedMax, catchUp.Tau = *l.EarnedMin, *l.EarnedMax, *l.Tau
		}
		leagues = append(leagues, league)
	}
	return json.Marshal(map[string]any{
		"starting_rating": doc.StartingRating,
		"catch_up":        catchUp,
		"leagues":         leagues,
	})
}

// HasMigrators reports whether any data migrators are registered. Used by the
// startup migration step to short-circuit a table scan while no legacy
// versions exist.
func HasMigrators() bool { return reg.HasMigrators(Kind) }

// Validate checks raw against the current JSON Schema. Returns ErrInvalid
// (with details) on failure.
func Validate(raw json.RawMessage) error { return reg.Validate(Kind, raw) }

// MigrateData upgrades a stored settings document from fromVersion up to
// CurrentVersion; see docregistry.Registry.Migrate.
func MigrateData(fromVersion int, raw json.RawMessage) (json.RawMessage, int, error) {
	return reg.Migrate(Kind, fromVersion, raw)
}
