// Package audit describes the versioned details documents stored alongside
// audit_log rows (ADR-14). It mirrors the calculator's versioned-JSON mechanics
// (ADR-09) in miniature: each details kind has an embedded JSON Schema
// (draft 2020-12), a CurrentVersion, and — once older versions exist —
// per-version migrators applied at startup (see pkg/db/migrate_data.go) so
// reads always return the current version.
//
// Storage shape convention (ADR-12): every entity reference lives under a
// property marked "x-entity-id": true and holds the canonical UUID in stored
// documents; the schema-driven walk (ids.go) rewrites them to the Base58 wire
// form on egress. Stored documents are built server-side, so there is no
// ingest-side canonicalization.
package audit

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

//go:embed *.json
var schemasFS embed.FS

// Details document kinds, stored in audit_log.details_kind. The DB CHECK
// constraint on that column must be kept in sync with this set.
const (
	KindEntity      = "entity"       // created/deleted game, player, or club
	KindRename      = "rename"       // renamed game, player, or club
	KindMatchUpdate = "match-update" // edited match
)

// Audited entity types, stored in audit_log.entity_type. Kept in sync with the
// DB CHECK constraint.
const (
	EntityMatch  = "match"
	EntityGame   = "game"
	EntityPlayer = "player"
	EntityClub   = "club"
)

// Audited actions, stored in audit_log.action. Kept in sync with the DB CHECK
// constraint.
const (
	ActionCreated = "created"
	ActionUpdated = "updated"
	ActionRenamed = "renamed"
	ActionDeleted = "deleted"
)

// ErrUnknownKind is returned when a kind is not in the registry.
var ErrUnknownKind = errors.New("unknown audit details kind")

// ErrInvalid is returned when a details document fails validation.
var ErrInvalid = errors.New("invalid audit details")

// Schema describes one details kind.
type Schema struct {
	Kind           string
	CurrentVersion int
	// map[fromVersion] → upgrade to fromVersion+1. Empty for v1-only kinds.
	migrators map[int]migrator
	validator *jsonschema.Schema
	// rawSchema is the decoded JSON Schema document; the x-entity-id walk
	// (ids.go) reads it to find id-marked properties.
	rawSchema map[string]any
}

type migrator func(json.RawMessage) (json.RawMessage, error)

var registry = map[string]*Schema{}

// register is called from init() for each details kind.
func register(s *Schema, schemaFile string) {
	s.validator = mustLoadSchema(schemaFile)
	s.rawSchema = mustLoadRawSchema(schemaFile)
	registry[s.Kind] = s
}

func mustLoadRawSchema(file string) map[string]any {
	b, err := schemasFS.ReadFile(file)
	if err != nil {
		panic(fmt.Sprintf("audit: embed read %s: %v", file, err))
	}
	var doc map[string]any
	if err := json.Unmarshal(b, &doc); err != nil {
		panic(fmt.Sprintf("audit: parse %s: %v", file, err))
	}
	return doc
}

func mustLoadSchema(file string) *jsonschema.Schema {
	b, err := schemasFS.ReadFile(file)
	if err != nil {
		panic(fmt.Sprintf("audit: embed read %s: %v", file, err))
	}
	var doc any
	if err := json.Unmarshal(b, &doc); err != nil {
		panic(fmt.Sprintf("audit: parse %s: %v", file, err))
	}
	c := jsonschema.NewCompiler()
	if err := c.AddResource(file, doc); err != nil {
		panic(fmt.Sprintf("audit: add resource %s: %v", file, err))
	}
	sch, err := c.Compile(file)
	if err != nil {
		panic(fmt.Sprintf("audit: compile %s: %v", file, err))
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
