package audit

import (
	"encoding/json"
	"time"
)

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
	register(&Schema{Kind: KindTournamentConfig, CurrentVersion: 1}, "tournament_config.v1.json")
	register(&Schema{Kind: KindTournamentStart, CurrentVersion: 1}, "tournament_start.v1.json")
	register(&Schema{Kind: KindTournamentState, CurrentVersion: 1}, "tournament_state.v1.json")
	register(&Schema{Kind: KindSlotRuling, CurrentVersion: 1}, "slot_ruling.v1.json")
	register(&Schema{Kind: KindSlotLink, CurrentVersion: 1}, "slot_link.v1.json")
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

// ---------------------------------------------------------------------------
// Tournament brackets (ADR-26). The entity_id of every row below is the
// tournament; slots are identified inside the details documents.
// ---------------------------------------------------------------------------

// TournamentGameDoc is one game-pool entry (table capacity) in config details.
type TournamentGameDoc struct {
	GameID     string `json:"game_id"`
	MinPlayers int    `json:"min_players"`
	MaxPlayers int    `json:"max_players"`
}

// GamesChange is the full game pool before → after.
type GamesChange struct {
	From []TournamentGameDoc `json:"from"`
	To   []TournamentGameDoc `json:"to"`
}

// TournamentConfigDetails captures the registration-time configuration:
// name, the optional grand-final deadline, the game pool, the participants.
// Create fills the 'to' sides; updates carry every changed field's full
// before → after. The last config row reconstructs the whole registration
// state (ADR-26 §Audit). The participant lists are flat because the id
// conventions require *_ids properties to be plain id arrays.
type TournamentConfigDetails struct {
	SchemaVersion      int          `json:"schema_version"`
	Name               *ValueChange `json:"name,omitempty"`
	GrandFinalDeadline *ValueChange `json:"grand_final_deadline,omitempty"`
	Games              *GamesChange `json:"games,omitempty"`
	FromPlayerIDs      []string     `json:"from_player_ids,omitempty"`
	ToPlayerIDs        []string     `json:"to_player_ids,omitempty"`
}

// NewTournamentConfigCreated builds the details of a tournament creation.
func NewTournamentConfigCreated(name string, deadline *time.Time, games []TournamentGameDoc, participants []string) TournamentConfigDetails {
	d := TournamentConfigDetails{SchemaVersion: 1, Name: valueChange(nil, strPtr(name))}
	if deadline != nil {
		d.GrandFinalDeadline = valueChange(nil, strPtr(deadline.Format(time.RFC3339Nano)))
	} else {
		d.GrandFinalDeadline = valueChange(nil, nil)
	}
	d.Games = &GamesChange{To: games}
	d.ToPlayerIDs = participants
	return d
}

// NewTournamentConfigChanged builds the details of a config update; pass nil
// for fields that did not change.
func NewTournamentConfigChanged(name, deadline *[2]*string, games *[2][]TournamentGameDoc, participants *[2][]string) TournamentConfigDetails {
	d := TournamentConfigDetails{SchemaVersion: 1}
	if name != nil {
		d.Name = valueChange(name[0], name[1])
	}
	if deadline != nil {
		d.GrandFinalDeadline = valueChange(deadline[0], deadline[1])
	}
	if games != nil {
		d.Games = &GamesChange{From: games[0], To: games[1]}
	}
	if participants != nil {
		d.FromPlayerIDs = participants[0]
		d.ToPlayerIDs = participants[1]
	}
	return d
}

// TournamentStartDetails snapshots the start decision: the chosen plan
// verbatim, the stored PRNG seed, and the participants in draw-input order
// (ids sorted ascending) — everything needed to reproduce the bracket.
type TournamentStartDetails struct {
	SchemaVersion  int             `json:"schema_version"`
	Plan           json.RawMessage `json:"plan"`
	Seed           int64           `json:"seed"`
	ParticipantIDs []string        `json:"participant_ids"`
}

// NewTournamentStartDetails builds v1 start details.
func NewTournamentStartDetails(plan json.RawMessage, seed int64, participants []string) TournamentStartDetails {
	return TournamentStartDetails{SchemaVersion: 1, Plan: plan, Seed: seed, ParticipantIDs: participants}
}

// Tournament state transition reasons (TournamentStateDetails.Reason).
const (
	StateReasonOrganizer = "organizer"
	StateReasonDeadline  = "deadline"
	StateReasonFinal     = "grand-final"
	StateReasonCascade   = "cascade" // a completed tournament reverted by an edit cascade
)

// TournamentStateDetails records a lifecycle transition (completed, or
// cancelled by the organizer / by the grand-final deadline).
type TournamentStateDetails struct {
	SchemaVersion int    `json:"schema_version"`
	From          string `json:"from"`
	To            string `json:"to"`
	Reason        string `json:"reason"`
}

// NewTournamentStateDetails builds v1 state details.
func NewTournamentStateDetails(from, to, reason string) TournamentStateDetails {
	return TournamentStateDetails{SchemaVersion: 1, From: from, To: to, Reason: reason}
}

// Slot ruling operations (SlotRulingDetails.Op).
const (
	RulingSet     = "set"
	RulingReplace = "replace"
	RulingRevert  = "revert"
)

// SlotRulingDetails records an organizer ruling on one slot: the ordered
// promotion set before (null while the slot was playing) and after (null on
// revert to the standings-based result).
type SlotRulingDetails struct {
	SchemaVersion   int      `json:"schema_version"`
	Op              string   `json:"op"`
	SlotID          string   `json:"slot_id"`
	BeforePlayerIDs []string `json:"before_player_ids"`
	AfterPlayerIDs  []string `json:"after_player_ids"`
}

// NewSlotRulingDetails builds v1 ruling details; nil slices serialize as null.
func NewSlotRulingDetails(op, slotID string, before, after []string) SlotRulingDetails {
	return SlotRulingDetails{SchemaVersion: 1, Op: op, SlotID: slotID, BeforePlayerIDs: before, AfterPlayerIDs: after}
}

// Slot link operations and origin kinds (SlotLinkDetails.Op / .OriginKind).
const (
	SlotLinkAttach = "attach"
	SlotLinkDetach = "detach"
	SlotLinkVoid   = "void"

	LinkOriginAcceptance = "acceptance"  // linked by the match-write fit check
	LinkOriginOrganizer  = "organizer"   // attach/detach endpoints
	LinkOriginMatchEdit  = "match-edit"  // void triggered by an edit of this match
	LinkOriginCascade    = "cascade"     // void triggered by an upstream slot change
)

// SlotLinkDetails records slot ↔ match linkage and its voids. For voids the
// origin carries the chain: the match edit that triggered it (origin_id =
// match id) or the upstream slot whose outcome change cascaded (origin_id =
// slot id).
type SlotLinkDetails struct {
	SchemaVersion int    `json:"schema_version"`
	Op            string `json:"op"`
	SlotID        string `json:"slot_id"`
	MatchID       string `json:"match_id"`
	OriginKind    string `json:"origin_kind"`
	OriginID      string `json:"origin_id,omitempty"`
}

// NewSlotLinkDetails builds v1 slot-link details.
func NewSlotLinkDetails(op, slotID, matchID, originKind, originID string) SlotLinkDetails {
	return SlotLinkDetails{SchemaVersion: 1, Op: op, SlotID: slotID, MatchID: matchID, OriginKind: originKind, OriginID: originID}
}
