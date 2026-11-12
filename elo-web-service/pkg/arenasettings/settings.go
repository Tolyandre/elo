// Package arenasettings validates arena settings documents against the
// versioned JSON Schemas and migrates stored documents between versions.
// The pure types and their parse live in pkg/settlement (the offline wasm
// build links that package and must not pull the schema registry in this
// file); the names below are aliases kept for the historical call sites.
package arenasettings

import (
	"encoding/json"

	"github.com/tolyandre/elo-web-service/pkg/settlement"
)

// CatchUp holds the rating catch-up parameters (ADR-03).
type CatchUp = settlement.CatchUp

// League describes one league of an arena.
type League = settlement.League

// Settings is the typed view of a validated settings document.
type Settings = settlement.ArenaSettings

// Parse converts a validated settings document into the typed Settings.
func Parse(raw json.RawMessage, schemaVersion int) (Settings, error) {
	return settlement.ParseArenaSettings(raw, schemaVersion)
}
