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
	register(&Schema{Kind: KindArenaCampConf, CurrentVersion: 1}, "arena_camp_config.v1.json")
	register(&Schema{Kind: KindCampLink, CurrentVersion: 1}, "camp_link.v1.json")
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

// Camp link operations (CampLinkDetails.Op).
const (
	CampLinkAttach = "attach"
	CampLinkDetach = "detach"
)

// CampLinkDetails records one match attach/detach on a camp arena (the arena
// is the audit row's entity_id).
type CampLinkDetails struct {
	SchemaVersion int    `json:"schema_version"`
	Op            string `json:"op"`
	MatchID       string `json:"match_id"`
}

// NewCampLinkDetails builds v1 camp-link details.
func NewCampLinkDetails(op string, matchID string) CampLinkDetails {
	return CampLinkDetails{SchemaVersion: 1, Op: op, MatchID: matchID}
}

// ValueChange is one before → after pair; a null side means "nothing" there:
// from=null on create, to=null on delete.
type ValueChange struct {
	From *string `json:"from"`
	To   *string `json:"to"`
}

// ArenaCampConfigDetails captures a camp arena's name and window. Create and
// delete fill all three fields (one side null each); updates only the changed
// ones.
type ArenaCampConfigDetails struct {
	SchemaVersion int          `json:"schema_version"`
	Name          *ValueChange `json:"name"`
	StartsAt      *ValueChange `json:"starts_at"`
	EndsAt        *ValueChange `json:"ends_at"`
}

func valueChange(from, to *string) *ValueChange { return &ValueChange{From: from, To: to} }

func strPtr(s string) *string { return &s } // NewCampConfigCreated builds the details of a camp arena creation.
func NewCampConfigCreated(name string, startsAt, endsAt time.Time) ArenaCampConfigDetails {
	return ArenaCampConfigDetails{
		SchemaVersion: 1,
		Name:          valueChange(nil, strPtr(name)),
		StartsAt:      valueChange(nil, strPtr(startsAt.Format(time.RFC3339Nano))),
		EndsAt:        valueChange(nil, strPtr(endsAt.Format(time.RFC3339Nano))),
	}
}

// NewCampConfigDeleted builds the details of a camp arena deletion: the final
// state, so the runbook can still see what was lost.
func NewCampConfigDeleted(name string, startsAt, endsAt time.Time) ArenaCampConfigDetails {
	return ArenaCampConfigDetails{
		SchemaVersion: 1,
		Name:          valueChange(strPtr(name), nil),
		StartsAt:      valueChange(strPtr(startsAt.Format(time.RFC3339Nano)), nil),
		EndsAt:        valueChange(strPtr(endsAt.Format(time.RFC3339Nano)), nil),
	}
}

// NewCampConfigChanged builds the details of a camp arena update; pass nil for
// fields that did not change.
func NewCampConfigChanged(name *[2]*string, startsAt, endsAt *[2]*string) ArenaCampConfigDetails {
	d := ArenaCampConfigDetails{SchemaVersion: 1}
	if name != nil {
		d.Name = valueChange(name[0], name[1])
	}
	if startsAt != nil {
		d.StartsAt = valueChange(startsAt[0], startsAt[1])
	}
	if endsAt != nil {
		d.EndsAt = valueChange(endsAt[0], endsAt[1])
	}
	return d
}
