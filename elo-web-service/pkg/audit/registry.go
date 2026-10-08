// Package audit describes the versioned details documents stored alongside
// audit_log rows (ADR-14). Each details kind is registered (from init) into
// the shared versioned document registry (pkg/docregistry): an embedded JSON
// Schema (draft 2020-12), a CurrentVersion, and — once older versions exist —
// per-version migrators applied at startup (see pkg/db/migrate_data.go) so
// reads always return the current version.
//
// Storage shape convention (ADR-12): every entity reference lives under a
// property marked "x-entity-id": true and holds the canonical UUID in stored
// documents; the schema-driven walk rewrites them to the Base58 wire
// form on egress. Stored documents are built server-side, so there is no
// ingest-side canonicalization.
package audit

import (
	"embed"
	"encoding/json"
	"errors"

	"github.com/tolyandre/elo-web-service/pkg/docregistry"
)

//go:embed *.json
var schemasFS embed.FS

// Details document kinds, stored in audit_log.details_kind. The DB CHECK
// constraint on that column must be kept in sync with this set.
const (
	KindEntity           = "entity"            // created/deleted game, player, club, tag, or tenant
	KindMatchUpdate      = "match-update"      // edited match
	KindTenantUpdate     = "tenant-update"     // tenant name / settings / composition update (ADR-36)
	KindUserUpdate       = "user-update"       // edit-permission toggle on a user (/admin/users)
	KindClubUpdate       = "club-update"       // club name / icon / membership change (ADR-36)
	KindGameUpdate       = "game-update"       // game meta update, rename included
	KindPlayerUpdate     = "player-update"     // player name change
	KindTagUpdate        = "tag-update"        // tag name change
	KindArenaCampConf    = "arena-camp-config" // camp arena create/update/delete (ADR-27)
	KindCampLink         = "camp-link"         // match attached to / detached from a camp (ADR-27)
	KindTournamentConfig = "tournament-config" // tournament create / config update (ADR-26)
	KindTournamentStart  = "tournament-start"  // plan + seed + participants at start (ADR-26)
	KindTournamentState  = "tournament-state"  // completed / cancelled (ADR-26)
	KindSlotRuling       = "slot-ruling"       // organizer ruling set / replaced / reverted (ADR-26)
	KindSlotLink         = "slot-link"         // slot attach / detach / cascade void (ADR-26)
	KindSlotAdjust       = "slot-adjust"       // organizer game reassignment (ADR-26)
)

// Audited entity types, stored in audit_log.entity_type. Kept in sync with the
// DB CHECK constraint.
const (
	EntityMatch      = "match"
	EntityGame       = "game"
	EntityPlayer     = "player"
	EntityClub       = "club"
	EntityTag        = "tag"
	EntityArena      = "arena"
	EntityTournament = "tournament"
	EntityTenant     = "tenant"
	EntityUser       = "user"
)

// Audited actions, stored in audit_log.action. Kept in sync with the DB CHECK
// constraint. A rename is not an action of its own: it is an `updated` whose
// details carry the name's before → after (migration 079).
const (
	ActionCreated = "created"
	ActionUpdated = "updated"
	ActionDeleted = "deleted"
)

// ErrUnknownKind is returned when a kind is not in the registry.
var ErrUnknownKind = errors.New("unknown audit details kind")

// ErrInvalid is returned when a details document fails validation.
var ErrInvalid = errors.New("invalid audit details")

var reg = docregistry.New("audit", schemasFS, ErrUnknownKind, ErrInvalid)

// Lookup returns the schema for a kind, or ErrUnknownKind.
func Lookup(kind string) (*docregistry.Kind, error) { return reg.Lookup(kind) }

// Kinds returns the set of registered kinds.
func Kinds() []string { return reg.Kinds() }

// registerMigrator adds a version-upgrade step for a kind. Called from init()
// once a kind ships a second schema version (fromVersion → fromVersion+1).
func registerMigrator(kind string, fromVersion int, fn func(json.RawMessage) (json.RawMessage, error)) {
	reg.RegisterMigrator(kind, fromVersion, fn)
}

// HasMigrators reports whether kind has any registered data migrators. Used by
// the startup migration step to short-circuit a table scan for kinds that have
// only ever shipped one version.
func HasMigrators(kind string) bool { return reg.HasMigrators(kind) }

// Validate validates raw against the JSON Schema for kind. Returns ErrInvalid
// (with details) on failure.
func Validate(kind string, raw json.RawMessage) error { return reg.Validate(kind, raw) }

// MigrateData upgrades a stored document of the given kind from fromVersion up
// to the kind's CurrentVersion; see docregistry.Registry.Migrate.
func MigrateData(kind string, fromVersion int, raw json.RawMessage) (json.RawMessage, int, error) {
	return reg.Migrate(kind, fromVersion, raw)
}

// ShortenIDs converts every x-entity-id property of raw from the canonical
// UUID to the Base58 wire form. Unknown kinds and malformed documents pass
// through untouched — the startup migration keeps stored rows current, so
// failing the response would only hurt reads of hand-edited data.
func ShortenIDs(kind string, raw json.RawMessage) (json.RawMessage, error) {
	return reg.ShortenIDs(kind, raw)
}
