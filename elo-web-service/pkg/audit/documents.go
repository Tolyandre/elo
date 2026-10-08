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
	reg.Register(KindEntity, 1, "entity.v1.json")
	reg.Register(KindMatchUpdate, 1, "match_update.v1.json")
	reg.Register(KindTenantUpdate, 1, "tenant_update.v1.json")
	reg.Register(KindUserUpdate, 1, "user_update.v1.json")
	reg.Register(KindClubUpdate, 1, "club_update.v1.json")
	reg.Register(KindGameUpdate, 1, "game_update.v1.json")
	reg.Register(KindPlayerUpdate, 1, "player_update.v1.json")
	reg.Register(KindTagUpdate, 1, "tag_update.v1.json")
	reg.Register(KindArenaCampConf, 1, "arena_camp_config.v1.json")
	reg.Register(KindCampLink, 1, "camp_link.v1.json")
	reg.Register(KindTournamentConfig, 1, "tournament_config.v1.json")
	reg.Register(KindTournamentStart, 1, "tournament_start.v1.json")
	reg.Register(KindTournamentState, 1, "tournament_state.v1.json")
	reg.Register(KindSlotRuling, 1, "slot_ruling.v1.json")
	reg.Register(KindSlotLink, 1, "slot_link.v1.json")
	reg.Register(KindSlotAdjust, 2, "slot_adjust.v2.json")

	// v2 adds the min_score op (ADR-30); v1 documents are identical but for
	// the schema_version const.
	registerMigrator(KindSlotAdjust, 1, func(raw json.RawMessage) (json.RawMessage, error) {
		var doc map[string]any
		if err := json.Unmarshal(raw, &doc); err != nil {
			return nil, err
		}
		doc["schema_version"] = 2
		return json.Marshal(doc)
	})
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

// ---------------------------------------------------------------------------
// Tenants (ADR-36): settings and composition updates, in the match-update
// style. The entity_id of the row is the tenant.
// ---------------------------------------------------------------------------

// StringChange is one before → after pair of an enum-ish string field.
type StringChange struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// NumberChange is one before → after pair of a numeric field.
type NumberChange struct {
	From float64 `json:"from"`
	To   float64 `json:"to"`
}

// BoolChange is one before → after pair of a boolean field.
type BoolChange struct {
	From bool `json:"from"`
	To   bool `json:"to"`
}

// RefChange is one before → after pair of a nullable integer reference (a
// game's BGG/Tesera id); a null side means "unset" there.
type RefChange struct {
	From *int64 `json:"from"`
	To   *int64 `json:"to"`
}

// TenantClubsChange is one club-composition replacement: the ids added and
// removed by the update.
type TenantClubsChange struct {
	AddedClubIDs   []string `json:"added_club_ids"`
	RemovedClubIDs []string `json:"removed_club_ids"`
}

// TenantUpdateDetails describes everything that changed in one tenant
// settings/composition update. Fields the update did not touch stay nil; an
// update that changed nothing (IsEmpty) produces the plain entity row
// instead.
type TenantUpdateDetails struct {
	SchemaVersion       int                `json:"schema_version"`
	Name                *ValueChange       `json:"name"`
	ArenaMembershipMode *StringChange      `json:"arena_membership_mode"`
	TournamentsOpenness *StringChange      `json:"tournaments_openness"`
	StartingRating      *NumberChange      `json:"starting_rating"`
	LeaguesChanged      bool               `json:"leagues_changed"`
	Icon                *ValueChange       `json:"icon"`
	Clubs               *TenantClubsChange `json:"clubs"`
}

// NewTenantUpdateDetails builds v1 tenant-update details.
func NewTenantUpdateDetails() TenantUpdateDetails {
	return TenantUpdateDetails{SchemaVersion: 1}
}

// NewTenantNameChange builds the details of a tenant rename.
func NewTenantNameChange(from, to string) TenantUpdateDetails {
	return TenantUpdateDetails{SchemaVersion: 1, Name: valueChange(&from, &to)}
}

// IsEmpty reports whether the details describe no changes at all.
func (d TenantUpdateDetails) IsEmpty() bool {
	return d.Name == nil && d.ArenaMembershipMode == nil && d.TournamentsOpenness == nil &&
		d.StartingRating == nil && !d.LeaguesChanged && d.Icon == nil && d.Clubs == nil
}

// ---------------------------------------------------------------------------
// Users: administration actions on /admin/users. The entity_id of the row is
// the target user.
// ---------------------------------------------------------------------------

// UserUpdateDetails records the edit-permission change behind one user update
// (the page's only write). A no-op update produces no row.
type UserUpdateDetails struct {
	SchemaVersion int         `json:"schema_version"`
	AllowEditing  *BoolChange `json:"allow_editing"`
}

// NewUserUpdateDetails builds v1 user-update details.
func NewUserUpdateDetails(from, to bool) UserUpdateDetails {
	return UserUpdateDetails{SchemaVersion: 1, AllowEditing: &BoolChange{From: from, To: to}}
}

// ---------------------------------------------------------------------------
// Games, players, tags: meta updates with field-level diffs. A rename is not
// a distinct action — it is the name field's before → after (migration 077).
// ---------------------------------------------------------------------------

// GameUpdateDetails describes everything that changed in one game meta
// update, rename included — games.name is generated from
// alias/name_ru/name_en, so it changes exactly when one of those does (or is
// reported alongside them). Fields the update did not touch stay nil; an
// update that changed nothing (IsEmpty) produces no audit row.
type GameUpdateDetails struct {
	SchemaVersion int           `json:"schema_version"`
	Name          *ValueChange  `json:"name,omitempty"`
	Alias         *ValueChange  `json:"alias,omitempty"`
	NameRu        *ValueChange  `json:"name_ru,omitempty"`
	NameEn        *ValueChange  `json:"name_en,omitempty"`
	BggRef        *RefChange    `json:"bgg_ref,omitempty"`
	TeseraRef     *RefChange    `json:"tesera_ref,omitempty"`
	GameMode      *StringChange `json:"game_mode,omitempty"`
	ImageURL      *ValueChange  `json:"image_url,omitempty"`
	ImageThumbURL *ValueChange  `json:"image_thumb_url,omitempty"`
}

// NewGameUpdateDetails builds v1 game-update details.
func NewGameUpdateDetails() GameUpdateDetails {
	return GameUpdateDetails{SchemaVersion: 1}
}

// IsEmpty reports whether the details describe no changes at all.
func (d GameUpdateDetails) IsEmpty() bool {
	return d.Name == nil && d.Alias == nil && d.NameRu == nil && d.NameEn == nil &&
		d.BggRef == nil && d.TeseraRef == nil && d.GameMode == nil &&
		d.ImageURL == nil && d.ImageThumbURL == nil
}

// PlayerUpdateDetails records what changed in one player update — the name.
// A no-op update produces no row.
type PlayerUpdateDetails struct {
	SchemaVersion int          `json:"schema_version"`
	Name          *ValueChange `json:"name"`
}

// NewPlayerUpdateDetails builds v1 player-update details.
func NewPlayerUpdateDetails(from, to string) PlayerUpdateDetails {
	return PlayerUpdateDetails{SchemaVersion: 1, Name: valueChange(&from, &to)}
}

// TagUpdateDetails records what changed in one tag update — the name. A
// no-op update produces no row.
type TagUpdateDetails struct {
	SchemaVersion int          `json:"schema_version"`
	Name          *ValueChange `json:"name"`
}

// NewTagUpdateDetails builds v1 tag-update details.
func NewTagUpdateDetails(from, to string) TagUpdateDetails {
	return TagUpdateDetails{SchemaVersion: 1, Name: valueChange(&from, &to)}
}

// ---------------------------------------------------------------------------
// Clubs (ADR-36): icon and membership changes. The entity_id of the row is
// the club; membership events name players inside the details document.
// ---------------------------------------------------------------------------

// ClubPlayersChange is one membership change on a club: the player ids added
// and removed by it (an add/remove event carries exactly one id on its side).
type ClubPlayersChange struct {
	AddedPlayerIDs   []string `json:"added_player_ids"`
	RemovedPlayerIDs []string `json:"removed_player_ids"`
}

// ClubUpdateDetails describes one club name, icon, or membership change.
// Fields the change did not touch stay nil/false; a no-op change produces no
// row.
type ClubUpdateDetails struct {
	SchemaVersion  int                `json:"schema_version"`
	PlayersChanged bool               `json:"players_changed"`
	Name           *ValueChange       `json:"name"`
	Icon           *ValueChange       `json:"icon"`
	Players        *ClubPlayersChange `json:"players"`
}

// NewClubNameChange builds the details of a club rename.
func NewClubNameChange(from, to string) ClubUpdateDetails {
	return ClubUpdateDetails{SchemaVersion: 1, Name: valueChange(&from, &to)}
}

// NewClubIconChange builds the details of a club icon set/clear; a nil side
// means "no icon" there.
func NewClubIconChange(from, to *string) ClubUpdateDetails {
	return ClubUpdateDetails{SchemaVersion: 1, Icon: &ValueChange{From: from, To: to}}
}

// NewClubMemberChange builds the details of a membership add or remove. Nil
// sides become empty arrays — the schema demands arrays on both sides.
func NewClubMemberChange(added, removed []string) ClubUpdateDetails {
	if added == nil {
		added = []string{}
	}
	if removed == nil {
		removed = []string{}
	}
	return ClubUpdateDetails{
		SchemaVersion:  1,
		PlayersChanged: true,
		Players:        &ClubPlayersChange{AddedPlayerIDs: added, RemovedPlayerIDs: removed},
	}
}

// ---------------------------------------------------------------------------
// Camp arenas (ADR-27)
// ---------------------------------------------------------------------------

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
// advancement set before (null while the slot was playing) and after (null on
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

	LinkOriginAcceptance = "acceptance" // linked by the match-write fit check
	LinkOriginOrganizer  = "organizer"  // attach/detach endpoints
	LinkOriginMatchEdit  = "match-edit" // void triggered by an edit of this match
	LinkOriginCascade    = "cascade"    // void triggered by an upstream slot change
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

// SlotAdjustDetails records an organizer adjustment of one running slot
// (game reassignment, minimal advance score) — KindSlotAdjust.
type SlotAdjustDetails struct {
	SchemaVersion int    `json:"schema_version"`
	Op            string `json:"op"`
	SlotID        string `json:"slot_id"`
	// GameID is the (new) game for op=game.
	GameID string `json:"game_id,omitempty"`
	// MinScore is the (new) minimal advance score for op=min_score (ADR-30).
	MinScore *float64 `json:"min_score,omitempty"`
}

// NewSlotGameAdjust builds the details of a game reassignment. gameID is
// typed id.ID for the x-entity-id walk convenience; pass id.ID(gameIDString).
func NewSlotGameAdjust(slotID string, gameID string) SlotAdjustDetails {
	return SlotAdjustDetails{SchemaVersion: 2, Op: "game", SlotID: slotID, GameID: gameID}
}

// NewSlotMinScoreAdjust builds the details of a minimal-advance-score
// adjustment (ADR-30).
func NewSlotMinScoreAdjust(slotID string, minScore float64) SlotAdjustDetails {
	return SlotAdjustDetails{SchemaVersion: 2, Op: "min_score", SlotID: slotID, MinScore: &minScore}
}
