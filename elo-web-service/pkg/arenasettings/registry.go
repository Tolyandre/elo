// Package arenasettings describes the versioned settings document stored in
// arenas.settings (ADR-24). It mirrors the calculator's versioned-JSON
// mechanics (ADR-09), as the audit details documents already do (ADR-14): an
// embedded JSON Schema (draft 2020-12), a CurrentVersion, and — once older
// versions exist — per-version migrators applied at startup (see
// pkg/db/migrate_data.go) so reads always return the current version.
//
// The package is a leaf (only stdlib + the JSON Schema library) so that
// pkg/db's startup data migration can import it; pkg/elo imports it for
// validation on write and parses the validated document into the typed
// Settings struct — the schema is the contract, the struct the view.
package arenasettings

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

//go:embed arena-settings.v1.json
var schemaV1 []byte

// Kind is the (single) document kind stored in arenas.settings. Kept for
// symmetry with the calculator/audit registries.
const Kind = "arena-settings"

// CurrentVersion is the schema_version currently WRITTEN by new code and the
// version every stored document is upgraded to at startup.
const CurrentVersion = 1

// ErrInvalid is returned when a settings document fails validation.
var ErrInvalid = errors.New("invalid arena settings")

type migrator func(json.RawMessage) (json.RawMessage, error)

// migrators maps [fromVersion] → upgrade to fromVersion+1. v1-only: empty.
// When a v2 schema ships, register its migrator here and bump CurrentVersion;
// the startup migration picks it up automatically.
var migrators = map[int]migrator{}

var validator = mustLoadSchema(schemaV1)

func mustLoadSchema(b []byte) *jsonschema.Schema {
	var doc any
	if err := json.Unmarshal(b, &doc); err != nil {
		panic(fmt.Sprintf("arenasettings: parse schema: %v", err))
	}
	c := jsonschema.NewCompiler()
	if err := c.AddResource("arena-settings.v1.json", doc); err != nil {
		panic(fmt.Sprintf("arenasettings: add resource: %v", err))
	}
	sch, err := c.Compile("arena-settings.v1.json")
	if err != nil {
		panic(fmt.Sprintf("arenasettings: compile schema: %v", err))
	}
	return sch
}

// HasMigrators reports whether any data migrators are registered. Used by the
// startup migration step to short-circuit a table scan while no legacy
// versions exist.
func HasMigrators() bool {
	return len(migrators) > 0
}

// Validate checks raw against the current JSON Schema. Returns ErrInvalid
// (with details) on failure.
func Validate(raw json.RawMessage) error {
	if len(raw) == 0 || string(raw) == "null" {
		return fmt.Errorf("%w: empty document", ErrInvalid)
	}
	var doc any
	if err := json.Unmarshal(raw, &doc); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	if err := validator.Validate(doc); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	return nil
}
