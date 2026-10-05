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

//go:embed arena-settings.v1.json
var schemasFS embed.FS

// Kind is the (single) document kind stored in arenas.settings.
const Kind = "arena-settings"

// CurrentVersion is the schema_version currently WRITTEN by new code and the
// version every stored document is upgraded to at startup.
const CurrentVersion = 1

// ErrInvalid is returned when a settings document fails validation.
var ErrInvalid = errors.New("invalid arena settings")

var reg = docregistry.New("arenasettings", schemasFS, errors.New("unknown arenasettings kind"), ErrInvalid)

func init() {
	reg.Register(Kind, CurrentVersion, "arena-settings.v1.json")

	// When a v2 schema ships, register it here with reg.RegisterMigrator and
	// bump CurrentVersion; the startup migration picks it up automatically.
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
