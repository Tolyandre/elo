package audit

import "time"

// Go types for the details documents. The JSON tags are the stored (and wire)
// shape; the embedded JSON Schemas are the source of truth for validation.
//
// Id-bearing fields are plain strings holding the canonical UUID (not id.ID,
// whose MarshalJSON emits the Base58 wire form) — stored documents must hold
// canonical ids; ids.go rewrites them to the wire form on egress.

func init() {
	register(&Schema{Kind: KindEntity, CurrentVersion: 1}, "entity.v1.json")
	register(&Schema{Kind: KindRename, CurrentVersion: 1}, "rename.v1.json")
	register(&Schema{Kind: KindMatchUpdate, CurrentVersion: 1}, "match_update.v1.json")
}

// EntityDetails names the entity at the moment it was created or deleted (the
// name is captured because a deleted entity's name is otherwise lost).
type EntityDetails struct {
	SchemaVersion int    `json:"schema_version"`
	Name          string `json:"name"`
}

// NewEntityDetails builds v1 entity details.
func NewEntityDetails(name string) EntityDetails {
	return EntityDetails{SchemaVersion: 1, Name: name}
}

// RenameDetails captures a rename.
type RenameDetails struct {
	SchemaVersion int    `json:"schema_version"`
	OldName       string `json:"old_name"`
	NewName       string `json:"new_name"`
}

// NewRenameDetails builds v1 rename details.
func NewRenameDetails(oldName, newName string) RenameDetails {
	return RenameDetails{SchemaVersion: 1, OldName: oldName, NewName: newName}
}

// Player change kinds (PlayerChange.Change).
const (
	PlayerAdded   = "added"   // player joined the match
	PlayerRemoved = "removed" // player left the match
	PlayerScore   = "score"   // score changed for an existing player
)

// DateChange is a match date edit.
type DateChange struct {
	Old time.Time `json:"old"`
	New time.Time `json:"new"`
}

// GameChange is a match game reassignment.
type GameChange struct {
	OldGameID string `json:"old_game_id"`
	NewGameID string `json:"new_game_id"`
}

// PlayerChange is one player-level edit within a match update: a join, a
// leave, or a score change.
type PlayerChange struct {
	PlayerID string   `json:"player_id"`
	Change   string   `json:"change"`
	OldScore *float64 `json:"old_score"`
	NewScore *float64 `json:"new_score"`
}

// MatchUpdateDetails describes everything that changed in one match edit.
// Fields the edit did not touch stay nil; an edit that changed nothing
// (IsEmpty) produces no audit row at all.
type MatchUpdateDetails struct {
	SchemaVersion     int            `json:"schema_version"`
	Date              *DateChange    `json:"date"`
	Game              *GameChange    `json:"game"`
	PlayerChanges     []PlayerChange `json:"player_changes"`
	CalculatorChanged bool           `json:"calculator_changed"`
}

// NewMatchUpdateDetails builds v1 match-update details.
func NewMatchUpdateDetails() MatchUpdateDetails {
	return MatchUpdateDetails{
		SchemaVersion: 1,
		PlayerChanges: []PlayerChange{},
	}
}

// IsEmpty reports whether the details describe no changes at all.
func (d MatchUpdateDetails) IsEmpty() bool {
	return d.Date == nil && d.Game == nil && len(d.PlayerChanges) == 0 && !d.CalculatorChanged
}
