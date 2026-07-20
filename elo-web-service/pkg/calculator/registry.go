// Package calculator persists and validates the intermediate state of a game
// calculator (Skull King, It's a Wonderful World, …) alongside the match it
// produced, so the match can be re-opened in the same calculator (history mode)
// and re-edited. See ADR-09.
//
// Each calculator kind is described by a Schema:
//   - Kind: stable identifier stored in matches.calculator_kind (e.g.
//     "skull-king", "iaww"). Renaming a kind is a breaking change.
//   - CurrentVersion: the schema_version currently WRITTEN by new code.
//   - jsonschema: an embedded JSON Schema (draft 2020-12) used to validate
//     calculator_data on write. The schema is versioned via schema_version.
//   - migrators: per-(fromVersion) functions that upgrade a stored document to
//     the next version. Applied at startup (see MigrateData) so reads always
//     return the current version.
//
// Storage shape convention: every player reference MUST live under a key named
// "player_id" (or end in "_id"), never as an object key. This lets the
// idcodec middleware rewrite canonical/short ids at the HTTP boundary
// automatically — see pkg/api/idcodec_middleware.go.
package calculator

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/santhosh-tekuri/jsonschema/v6"
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

// Schema describes one calculator kind.
type Schema struct {
	Kind           string
	CurrentVersion int
	// map[fromVersion] → upgrade to fromVersion+1. Empty for v1-only kinds.
	migrators map[int]migrator
	validator *jsonschema.Schema
}

type migrator func(json.RawMessage) (json.RawMessage, error)

var registry = map[string]*Schema{}

// register is called from init() of each calculator's file.
func register(s *Schema, schemaFile string) {
	s.validator = mustLoadSchema(schemaFile)
	registry[s.Kind] = s
}

func mustLoadSchema(file string) *jsonschema.Schema {
	b, err := schemasFS.ReadFile(file)
	if err != nil {
		panic(fmt.Sprintf("calculator: embed read %s: %v", file, err))
	}
	var doc any
	if err := json.Unmarshal(b, &doc); err != nil {
		panic(fmt.Sprintf("calculator: parse %s: %v", file, err))
	}
	c := jsonschema.NewCompiler()
	if err := c.AddResource(file, doc); err != nil {
		panic(fmt.Sprintf("calculator: add resource %s: %v", file, err))
	}
	sch, err := c.Compile(file)
	if err != nil {
		panic(fmt.Sprintf("calculator: compile %s: %v", file, err))
	}
	return sch
}

// Lookup returns the schema for a kind, or ErrUnknownKind.
func Lookup(kind string) (*Schema, error) {
	s, ok := registry[kind]
	if !ok {
		return nil, fmt.Errorf("%w: %q", ErrUnknownKind, kind)
	}
	return s, nil
}

// Kinds returns the set of registered kinds.
func Kinds() []string {
	out := make([]string, 0, len(registry))
	for k := range registry {
		out = append(out, k)
	}
	return out
}

// HasMigrators reports whether kind has any registered data migrators. Used by
// the startup migration step to short-circuit a table scan for kinds that have
// only ever shipped one version.
func HasMigrators(kind string) bool {
	s, ok := registry[kind]
	if !ok {
		return false
	}
	return len(s.migrators) > 0
}

// Validate validates raw against the JSON Schema for kind. Returns ErrInvalid
// (with details) on failure.
func Validate(kind string, raw json.RawMessage) error {
	s, err := Lookup(kind)
	if err != nil {
		return err
	}
	if len(raw) == 0 || string(raw) == "null" {
		return fmt.Errorf("%w: empty document", ErrInvalid)
	}
	var doc any
	if err := json.Unmarshal(raw, &doc); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	if err := s.validator.Validate(doc); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	return nil
}
