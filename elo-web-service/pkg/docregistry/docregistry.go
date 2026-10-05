// Package docregistry is the shared machinery behind the versioned-JSON
// document families stored alongside rows (calculator data ADR-09, audit
// details ADR-14, arena settings ADR-24): every kind has an embedded JSON
// Schema (draft 2020-12), a CurrentVersion, and per-version migrators applied
// at startup, so reads always return the current version. Id-bearing
// properties are marked "x-entity-id": true in the schema and rewritten at the
// boundary by the schema-driven walk (ADR-12).
//
// Each document family builds one Registry in its package:
//
//	//go:embed *.json
//	var schemasFS embed.FS
//
//	var ErrUnknownKind = errors.New("unknown ... kind")
//	var ErrInvalid     = errors.New("invalid ...")
//
//	var reg = docregistry.New("name", schemasFS, ErrUnknownKind, ErrInvalid)
//
//	func init() {
//	    reg.Register(KindX, 1, "x.v1.json")
//	}
package docregistry

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"

	"github.com/santhosh-tekuri/jsonschema/v6"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// Migrator upgrades a document one version (fromVersion → fromVersion+1).
type Migrator func(json.RawMessage) (json.RawMessage, error)

// Kind describes one registered document kind.
type Kind struct {
	Kind           string
	CurrentVersion int
	// map[fromVersion] → upgrade to fromVersion+1. Empty for v1-only kinds.
	migrators map[int]Migrator
	validator *jsonschema.Schema
	// rawSchema is the decoded JSON Schema document; the x-entity-id walk
	// reads it to find id-marked properties.
	rawSchema map[string]any
}

// Registry holds the kinds of one document family. The two sentinel errors are
// supplied by the family so errors.Is keeps working across the shared layer.
type Registry struct {
	name           string
	schemas        fs.FS
	ErrUnknownKind error
	ErrInvalid     error
	kinds          map[string]*Kind
}

// New builds the registry for one document family. name prefixes panics and
// error messages; schemas is the embedded FS holding the JSON Schema files;
// the sentinels come from the family package. New registers the kinds via
// Register from the family's init().
func New(name string, schemas embed.FS, errUnknownKind, errInvalid error) *Registry {
	return &Registry{
		name:           name,
		schemas:        schemas,
		ErrUnknownKind: errUnknownKind,
		ErrInvalid:     errInvalid,
		kinds:          map[string]*Kind{},
	}
}

// Register adds a kind with its current schema file. Called from init().
func (r *Registry) Register(kind string, currentVersion int, schemaFile string) {
	if _, dup := r.kinds[kind]; dup {
		panic(fmt.Sprintf("%s: kind %q registered twice", r.name, kind))
	}
	k := &Kind{Kind: kind, CurrentVersion: currentVersion}
	k.validator = r.mustLoadSchema(schemaFile)
	k.rawSchema = r.mustLoadRawSchema(schemaFile)
	r.kinds[kind] = k
}

// RegisterMigrator adds a version-upgrade step for a kind (fromVersion →
// fromVersion+1). Call after Register, from init(), once a kind ships a
// second schema version.
func (r *Registry) RegisterMigrator(kind string, fromVersion int, fn Migrator) {
	k, ok := r.kinds[kind]
	if !ok {
		panic(fmt.Sprintf("%s: migrator for unknown kind %q", r.name, kind))
	}
	if k.migrators == nil {
		k.migrators = map[int]Migrator{}
	}
	k.migrators[fromVersion] = fn
}

// Lookup returns the kind's descriptor, or ErrUnknownKind.
func (r *Registry) Lookup(kind string) (*Kind, error) {
	k, ok := r.kinds[kind]
	if !ok {
		return nil, fmt.Errorf("%w: %q", r.ErrUnknownKind, kind)
	}
	return k, nil
}

// Kinds returns the set of registered kinds.
func (r *Registry) Kinds() []string {
	out := make([]string, 0, len(r.kinds))
	for k := range r.kinds {
		out = append(out, k)
	}
	return out
}

// HasMigrators reports whether kind has any registered data migrators. Used by
// the startup migration step to short-circuit a table scan for kinds that have
// only ever shipped one version.
func (r *Registry) HasMigrators(kind string) bool {
	k, ok := r.kinds[kind]
	if !ok {
		return false
	}
	return len(k.migrators) > 0
}

// Validate validates raw against the JSON Schema for kind. Returns
// ErrInvalid (with details) on failure.
func (r *Registry) Validate(kind string, raw json.RawMessage) error {
	k, err := r.Lookup(kind)
	if err != nil {
		return err
	}
	return r.validate(k, raw)
}

func (r *Registry) validate(k *Kind, raw json.RawMessage) error {
	if len(raw) == 0 || string(raw) == "null" {
		return fmt.Errorf("%w: empty document", r.ErrInvalid)
	}
	var doc any
	if err := json.Unmarshal(raw, &doc); err != nil {
		return fmt.Errorf("%w: %v", r.ErrInvalid, err)
	}
	if err := k.validator.Validate(doc); err != nil {
		return fmt.Errorf("%w: %v", r.ErrInvalid, err)
	}
	return nil
}

// Migrate upgrades a stored document of the given kind from fromVersion up to
// the kind's CurrentVersion by repeatedly applying registered migrators.
// Returns the new document (re-serialized) and its new version. If no
// migrators are needed, the input is returned verbatim.
//
// After migration the resulting document is re-validated against the current
// schema; a malformed upgrade function surfaces as an error here instead of
// leaving a corrupt row behind.
func (r *Registry) Migrate(kind string, fromVersion int, raw json.RawMessage) (json.RawMessage, int, error) {
	k, err := r.Lookup(kind)
	if err != nil {
		return nil, 0, err
	}
	if fromVersion > k.CurrentVersion {
		return nil, 0, fmt.Errorf("%s: %q stored version %d is newer than current %d (downgrade not supported)", r.name, kind, fromVersion, k.CurrentVersion)
	}
	version := fromVersion
	doc := raw
	for version < k.CurrentVersion {
		fn, ok := k.migrators[version]
		if !ok {
			return nil, 0, fmt.Errorf("%s: %q no migrator from version %d", r.name, kind, version)
		}
		upgraded, err := fn(doc)
		if err != nil {
			return nil, 0, fmt.Errorf("%s: %q migrate %d→%d: %w", r.name, kind, version, version+1, err)
		}
		doc = upgraded
		version++
	}
	if version != fromVersion {
		// Validate the upgraded document against the current schema before the
		// caller persists it.
		if err := r.validate(k, doc); err != nil {
			return nil, 0, fmt.Errorf("%s: %q post-migration validation: %w", r.name, kind, err)
		}
	}
	return doc, version, nil
}

// CanonicalizeIDs converts every x-entity-id property of raw from the wire
// form (Base58 or canonical) to the canonical UUID. Runs on ingest, after
// Validate, so stored documents always hold canonical ids.
func (r *Registry) CanonicalizeIDs(kind string, raw json.RawMessage) (json.RawMessage, error) {
	k, err := r.Lookup(kind)
	if err != nil {
		return nil, err
	}
	var doc any
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, err
	}
	out, err := walkIDs(doc, k.rawSchema, id.CanonicalizeTolerant)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", r.ErrInvalid, err)
	}
	return json.Marshal(out)
}

// ShortenIDs is the inverse of CanonicalizeIDs: canonical UUIDs become the
// Base58 wire form. Runs on egress, before the document is embedded in a
// response. Unknown kinds and malformed documents pass through untouched —
// the migrators keep stored rows current, so failing the response would only
// hurt reads of hand-edited data.
func (r *Registry) ShortenIDs(kind string, raw json.RawMessage) (json.RawMessage, error) {
	k, err := r.Lookup(kind)
	if err != nil {
		return raw, nil
	}
	var doc any
	if err := json.Unmarshal(raw, &doc); err != nil {
		return raw, nil
	}
	out, _ := walkIDs(doc, k.rawSchema, id.ToBase58)
	b, err := json.Marshal(out)
	if err != nil {
		return raw, nil
	}
	return b, nil
}

// walkIDs recursively rewrites id-marked string properties of doc according to
// schema (its properties/items branches only; id markers never sit behind
// oneOf in the document schemas).
func walkIDs(doc any, schema map[string]any, convert func(string) string) (any, error) {
	if schema == nil || doc == nil {
		return doc, nil
	}
	switch d := doc.(type) {
	case map[string]any:
		props, _ := schema["properties"].(map[string]any)
		for k, v := range d {
			prop, _ := props[k].(map[string]any)
			if prop == nil {
				continue
			}
			if _, marked := prop["x-entity-id"]; marked {
				if s, ok := v.(string); ok {
					d[k] = convert(s)
				} else if v != nil {
					return nil, fmt.Errorf("x-entity-id property %q is not a string", k)
				}
				continue
			}
			converted, err := walkIDs(v, prop, convert)
			if err != nil {
				return nil, err
			}
			d[k] = converted
		}
		return d, nil
	case []any:
		items, _ := schema["items"].(map[string]any)
		if items == nil {
			return d, nil
		}
		for i, el := range d {
			converted, err := walkIDs(el, items, convert)
			if err != nil {
				return nil, err
			}
			d[i] = converted
		}
		return d, nil
	default:
		return doc, nil
	}
}

func (r *Registry) mustLoadRawSchema(file string) map[string]any {
	b, err := fs.ReadFile(r.schemas, file)
	if err != nil {
		panic(fmt.Sprintf("%s: embed read %s: %v", r.name, file, err))
	}
	var doc map[string]any
	if err := json.Unmarshal(b, &doc); err != nil {
		panic(fmt.Sprintf("%s: parse %s: %v", r.name, file, err))
	}
	return doc
}

func (r *Registry) mustLoadSchema(file string) *jsonschema.Schema {
	b, err := fs.ReadFile(r.schemas, file)
	if err != nil {
		panic(fmt.Sprintf("%s: embed read %s: %v", r.name, file, err))
	}
	var doc any
	if err := json.Unmarshal(b, &doc); err != nil {
		panic(fmt.Sprintf("%s: parse %s: %v", r.name, file, err))
	}
	c := jsonschema.NewCompiler()
	if err := c.AddResource(file, doc); err != nil {
		panic(fmt.Sprintf("%s: add resource %s: %v", r.name, file, err))
	}
	sch, err := c.Compile(file)
	if err != nil {
		panic(fmt.Sprintf("%s: compile %s: %v", r.name, file, err))
	}
	return sch
}
