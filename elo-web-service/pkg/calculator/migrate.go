package calculator

import (
	"encoding/json"
	"fmt"
)

// MigrateData upgrades a stored document of the given kind from fromVersion up
// to the kind's CurrentVersion by repeatedly applying registered migrators.
// Returns the new document (re-serialized) and its new version. If no
// migrators are needed, the input is returned verbatim.
//
// After migration the resulting document is re-validated against the current
// schema; a malformed upgrade function surfaces as an error here instead of
// leaving a corrupt row behind.
func MigrateData(kind string, fromVersion int, raw json.RawMessage) (json.RawMessage, int, error) {
	s, err := Lookup(kind)
	if err != nil {
		return nil, 0, err
	}
	if fromVersion > s.CurrentVersion {
		return nil, 0, fmt.Errorf("calculator: %q stored version %d is newer than current %d (downgrade not supported)", kind, fromVersion, s.CurrentVersion)
	}
	version := fromVersion
	doc := raw
	for version < s.CurrentVersion {
		fn, ok := s.migrators[version]
		if !ok {
			return nil, 0, fmt.Errorf("calculator: %q no migrator from version %d", kind, version)
		}
		upgraded, err := fn(doc)
		if err != nil {
			return nil, 0, fmt.Errorf("calculator: %q migrate %d→%d: %w", kind, version, version+1, err)
		}
		doc = upgraded
		version++
	}
	if version != fromVersion {
		// Validate the upgraded document against the current schema before the
		// caller persists it.
		if err := Validate(kind, doc); err != nil {
			return nil, 0, fmt.Errorf("calculator: %q post-migration validation: %w", kind, err)
		}
	}
	return doc, version, nil
}
