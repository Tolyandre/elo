// Package calculator persists and validates the intermediate state of a game
// calculator (Skull King, It's a Wonderful World, …) alongside the match it
// produced, so the match can be re-opened in the same calculator (history mode)
// and re-edited. See ADR-09.
//
// Each calculator kind is registered (from init) into the shared versioned
// document registry (pkg/docregistry): a stable Kind stored in
// matches.calculator_kind (e.g. "skull-king", "iaww"), a CurrentVersion, an
// embedded JSON Schema validating calculator_data on write, and per-version
// migrators applied at startup (see MigrateData) so reads always return the
// current version.
//
// Storage shape convention: every player reference lives under a key whose
// schema entry is marked "x-entity-id": true (currently always "player_id"),
// never as an object key, so the schema-driven id walk rewrites
// canonical/wire ids at the boundary — see ADR-12.
package calculator

import (
	"embed"
	"encoding/json"
	"errors"

	"github.com/tolyandre/elo-web-service/pkg/docregistry"
)

//go:embed *.json
var schemasFS embed.FS

// Known calculator kinds. Adding a new kind is additive: register it here,
// ship a v1 schema + (optionally) migrators, and add the frontend component.
const (
	KindSkullKing = "skull-king"
	KindIAWW      = "iaww" // It's a Wonderful World ("Этот Безумный Мир")
)

// ErrUnknownKind is returned when a kind is not in the registry.
var ErrUnknownKind = errors.New("unknown calculator kind")

// ErrInvalid is returned when a calculator_data document fails validation.
var ErrInvalid = errors.New("invalid calculator data")

var reg = docregistry.New("calculator", schemasFS, ErrUnknownKind, ErrInvalid)

// Schema describes one calculator kind.
type Schema = docregistry.Kind

// Lookup returns the schema for a kind, or ErrUnknownKind.
func Lookup(kind string) (*Schema, error) { return reg.Lookup(kind) }

// Kinds returns the set of registered kinds.
func Kinds() []string { return reg.Kinds() }

// HasMigrators reports whether kind has any registered data migrators. Used by
// the startup migration step to short-circuit a table scan for kinds that have
// only ever shipped one version.
func HasMigrators(kind string) bool { return reg.HasMigrators(kind) }

// Validate validates raw against the JSON Schema for kind. Returns ErrInvalid
// (with details) on failure.
func Validate(kind string, raw json.RawMessage) error { return reg.Validate(kind, raw) }

// MigrateData upgrades a stored document of the given kind from fromVersion up
// to the kind's CurrentVersion; see docregistry.Registry.Migrate.
func MigrateData(kind string, fromVersion int, raw json.RawMessage) (json.RawMessage, int, error) {
	return reg.Migrate(kind, fromVersion, raw)
}

// CanonicalizeIDs converts every x-entity-id property of raw from the wire
// form (Base58 or canonical) to the canonical UUID. Runs on ingest, after
// Validate, so stored documents always hold canonical ids.
func CanonicalizeIDs(kind string, raw json.RawMessage) (json.RawMessage, error) {
	return reg.CanonicalizeIDs(kind, raw)
}

// ShortenIDs is the inverse of CanonicalizeIDs: canonical UUIDs become the
// Base58 wire form. Runs on egress, before the document is embedded in a
// response. Unknown kinds and malformed documents pass through untouched —
// the migrators keep stored rows current, so failing the response would only
// hurt reads of hand-edited data.
func ShortenIDs(kind string, raw json.RawMessage) (json.RawMessage, error) {
	return reg.ShortenIDs(kind, raw)
}
