package arenasettings

import (
	"encoding/json"
	"fmt"
)

// MigrateData upgrades a stored settings document from fromVersion up to
// CurrentVersion by repeatedly applying registered migrators. Returns the new
// document (re-serialized) and its new version. If no migrators are needed,
// the input is returned verbatim.
//
// After migration the resulting document is re-validated against the current
// schema; a malformed upgrade function surfaces as an error here instead of
// leaving a corrupt row behind.
func MigrateData(fromVersion int, raw json.RawMessage) (json.RawMessage, int, error) {
	if fromVersion > CurrentVersion {
		return nil, 0, fmt.Errorf("arenasettings: stored version %d is newer than current %d (downgrade not supported)", fromVersion, CurrentVersion)
	}
	version := fromVersion
	doc := raw
	for version < CurrentVersion {
		fn, ok := migrators[version]
		if !ok {
			return nil, 0, fmt.Errorf("arenasettings: no migrator from version %d", version)
		}
		upgraded, err := fn(doc)
		if err != nil {
			return nil, 0, fmt.Errorf("arenasettings: migrate %d→%d: %w", version, version+1, err)
		}
		doc = upgraded
		version++
	}
	if version != fromVersion {
		// Validate the upgraded document against the current schema before the
		// caller persists it.
		if err := Validate(doc); err != nil {
			return nil, 0, fmt.Errorf("arenasettings: post-migration validation: %w", err)
		}
	}
	return doc, version, nil
}
