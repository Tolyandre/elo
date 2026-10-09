package elo

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/arenasettings"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// Well-known ids of the arena row created by schema migration 051 — the
// converted global arena, «Синие люди»'s main arena since migration 068
// (ADR-36). Chosen outside the legacy int-era migration pattern
// 00000000-0000-0000-0000-0000000000NN (ADR-07) and outside random-UUID
// space, so they can never be confused with a migrated or client-generated
// entity id. The rows are created by schema migration 051 in every
// environment; SQL literals of the same values live in the query files (see
// pkg/db/query/rating.sql) and must be kept in sync.
const (
	blueMenArenaIDUUID      = "a2ea0000-0000-0000-0000-000000000001"
	blueMenArenaFilterIDStr = "a2ea0000-0000-0000-0000-000000000002"
)

// BlueMenArenaID is the well-known id of «Синие люди»'s main arena — the
// arena row created by migration 051 as the single global arena and attached
// to the tenant by migration 068. Its settlement history is the one the
// epoch sweep re-settles (ADR-36). Never a read default: display reads take
// their ?tenant='s main arena.
var BlueMenArenaID = mustParseID("elo: blue men arena id", blueMenArenaIDUUID)

// League kind names stored in arena settings and settlement rows.
const (
	LeagueNewbie  = "newbie"
	LeagueAmateur = "amateur"
	LeagueElite   = "elite"
)

func mustParseID(what, s string) id.ID {
	parsed, err := id.Parse(s)
	if err != nil {
		panic(fmt.Sprintf("%s %q: %v", what, s, err))
	}
	return parsed
}

// MatchFilter decides which matches belong to a (non-camp) arena. A match
// meets the filter iff it satisfies every present condition (nil = condition
// absent); GameIDs/TagIDs are OR'd, and both empty mean any game. The matching
// SQL lives in pkg/db/query/arenas.sql (the canonical copy of the condition).
type MatchFilter struct {
	DateFrom *time.Time
	DateTo   *time.Time
	GameIDs  []id.ID
	TagIDs   []id.ID
}

// IsUnconditional reports whether the filter admits every match (the global
// arena's filter).
func (f MatchFilter) IsUnconditional() bool {
	return f.DateFrom == nil && f.DateTo == nil &&
		len(f.GameIDs) == 0 && len(f.TagIDs) == 0
}

// Arena is the domain view of an arenas row joined with its filter (camp
// arenas have none, ADR-27) and with the settings document parsed (the
// document was validated at write time).
type Arena struct {
	ID              id.ID
	Name            string
	Settings        arenasettings.Settings
	SettingsRaw     json.RawMessage
	SettingsVersion int
	// Anchor columns of auto-managed arenas; both nil for user-created ones
	// (including camps).
	GameID       *id.ID
	TournamentID *id.ID
	// A tenant's main arena (ADR-36): membership is decided by tenant
	// rules, not by arena_contains_match. The converted global arena carries
	// its tenant alongside the unconditional filter.
	TenantID *id.ID
	// Camp arena (ADR-27): membership is the explicit arena_matches link, the
	// window bounds are required, and the filter is absent.
	Camp     bool
	StartsAt *time.Time
	EndsAt   *time.Time
	// Dirty queue state: StaleAt nil = up to date; RecalcFrom nil (while
	// stale) = full recalc pending, else the minimum replay date.
	RecalcFrom *time.Time
	StaleAt    *time.Time

	Filter MatchFilter
}

// HasLeagues reports whether the arena defines any leagues.
func (a Arena) HasLeagues() bool { return len(a.Settings.Leagues) > 0 }

// ArenaWithCount is a list row with the precomputed number of matching matches.
type ArenaWithCount struct {
	Arena
	MatchesCount int
	// Derived camp participants (settlements); empty for non-camps.
	CampPlayerIds []id.ID
}

// ArenaPlayer is one row of the arena players endpoint: latest settlement
// state joined with the precalculated stats, ranked by the service.
type ArenaPlayer struct {
	ID           id.ID
	Name         string
	Rating       float64
	League       *string
	Rank         *int
	MatchesCount int
	FirstCount   int
	SecondCount  int
	ThirdCount   int
	FourthCount  int
	// Hint counters, only meaningful when the arena has the matching league.
	MatchesLeftForElite       int
	WinsNeededForAmateurLower int
	WinsNeededForAmateurUpper int
}

// ArenaUpdateReport is the per-arena outcome of a full recalculation.
type ArenaUpdateReport struct {
	ArenaID         id.ID
	ArenaName       string
	MatchesReplayed int
	ChangedPlayers  []PlayerStateChange
}

// ArenaWriteOpts carries the editable fields for CreateArena/UpdateArena.
// Camp arenas (Camp=true) require StartsAt/EndsAt and ignore Filter; every
// other arena kind requires a Filter and no window.
type ArenaWriteOpts struct {
	Name     string
	Camp     bool
	StartsAt *time.Time
	EndsAt   *time.Time
	Filter   MatchFilter
	// SettingsRaw must validate against the current arenasettings schema.
	SettingsRaw json.RawMessage
}

type ArenaService struct {
	Queries *db.Queries
	Pool    *pgxpool.Pool
	Hub     *Hub // nil-safe; used to nudge clients after background recalcs
	// Sweep re-settles the market ledger (and «Синие люди»'s match
	// settlements) inside the caller's transaction — the main-arena drain's
	// second stage (ADR-36 phase 6). Wired after construction: MatchService
	// depends on this service.
	Sweep ISettlementSweep
}

func NewArenaService(pool *pgxpool.Pool, hub *Hub) *ArenaService {
	return &ArenaService{Queries: db.New(pool), Pool: pool, Hub: hub}
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

func tsPtr(ts pgtype.Timestamptz) *time.Time {
	if !ts.Valid {
		return nil
	}
	t := ts.Time
	return &t
}

func textPtr(t pgtype.Text) *string {
	if !t.Valid {
		return nil
	}
	s := t.String
	return &s
}

func ptrText(s *string) pgtype.Text {
	if s == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *s, Valid: true}
}

func arenaFromParts(arenaID id.ID, name string, raw json.RawMessage, version int32,
	gameID, tournamentID, tenantID *id.ID, camp bool, startsAt, endsAt, recalcFrom, staleAt, dateFrom, dateTo pgtype.Timestamptz,
	filterGameIDs, filterTagIDs []id.ID,
) (Arena, error) {
	settings, err := arenasettings.Parse(raw)
	if err != nil {
		return Arena{}, fmt.Errorf("arena %s: %w", arenaID, err)
	}
	return Arena{
		ID: arenaID, Name: name,
		Settings: settings, SettingsRaw: raw, SettingsVersion: int(version),
		GameID: gameID, TournamentID: tournamentID, TenantID: tenantID,
		Camp:       camp,
		StartsAt:   tsPtr(startsAt),
		EndsAt:     tsPtr(endsAt),
		RecalcFrom: tsPtr(recalcFrom), StaleAt: tsPtr(staleAt),
		Filter: MatchFilter{
			DateFrom: tsPtr(dateFrom), DateTo: tsPtr(dateTo),
			GameIDs: filterGameIDs, TagIDs: filterTagIDs,
		},
	}, nil
}

// arenaFrom<X>Row adapters convert the sqlc row types to the domain Arena.
// Every arena read query shares one 16-column projection (see arenas.sql), so
// the row structs are field-identical and each adapter is a plain fan-out into
// arenaFromParts; arena_rows_test.go keeps the row shapes identical.

func arenaFromGetArenaRow(r db.GetArenaRow) (Arena, error) {
	return arenaFromParts(r.ID, r.Name, r.Settings, r.SettingsSchemaVersion,
		r.GameID, r.TournamentID, r.TenantID, r.Camp, r.StartsAt, r.EndsAt, r.RecalcFrom, r.StaleAt,
		r.DateFrom, r.DateTo, r.FilterGameIds, r.FilterTagIds)
}

func arenaFromGetArenaByGameRow(r db.GetArenaByGameRow) (Arena, error) {
	return arenaFromParts(r.ID, r.Name, r.Settings, r.SettingsSchemaVersion,
		r.GameID, r.TournamentID, r.TenantID, r.Camp, r.StartsAt, r.EndsAt, r.RecalcFrom, r.StaleAt,
		r.DateFrom, r.DateTo, r.FilterGameIds, r.FilterTagIds)
}

func arenaFromGetArenaByTournamentRow(r db.GetArenaByTournamentRow) (Arena, error) {
	return arenaFromParts(r.ID, r.Name, r.Settings, r.SettingsSchemaVersion,
		r.GameID, r.TournamentID, r.TenantID, r.Camp, r.StartsAt, r.EndsAt, r.RecalcFrom, r.StaleAt,
		r.DateFrom, r.DateTo, r.FilterGameIds, r.FilterTagIds)
}

func arenaFromGetArenaForUpdateRow(r db.GetArenaForUpdateRow) (Arena, error) {
	return arenaFromParts(r.ID, r.Name, r.Settings, r.SettingsSchemaVersion,
		r.GameID, r.TournamentID, r.TenantID, r.Camp, r.StartsAt, r.EndsAt, r.RecalcFrom, r.StaleAt,
		r.DateFrom, r.DateTo, r.FilterGameIds, r.FilterTagIds)
}

func arenaFromListRow(r db.ListArenasRow) (ArenaWithCount, error) {
	a, err := arenaFromParts(r.ID, r.Name, r.Settings, r.SettingsSchemaVersion,
		r.GameID, r.TournamentID, r.TenantID, r.Camp, r.StartsAt, r.EndsAt, r.RecalcFrom, r.StaleAt,
		r.DateFrom, r.DateTo, r.FilterGameIds, r.FilterTagIds)
	return ArenaWithCount{Arena: a, MatchesCount: int(r.MatchesCount), CampPlayerIds: r.CampPlayerIds}, err
}

func arenaFromListArenasForGameRow(r db.ListArenasForGameRow) (Arena, error) {
	return arenaFromParts(r.ID, r.Name, r.Settings, r.SettingsSchemaVersion,
		r.GameID, r.TournamentID, r.TenantID, r.Camp, r.StartsAt, r.EndsAt, r.RecalcFrom, r.StaleAt,
		r.DateFrom, r.DateTo, r.FilterGameIds, r.FilterTagIds)
}

func arenaFromStaleRow(r db.ListStaleArenasRow) (Arena, error) {
	return arenaFromParts(r.ID, r.Name, r.Settings, r.SettingsSchemaVersion,
		r.GameID, r.TournamentID, r.TenantID, r.Camp, r.StartsAt, r.EndsAt, r.RecalcFrom, r.StaleAt,
		r.DateFrom, r.DateTo, r.FilterGameIds, r.FilterTagIds)
}
