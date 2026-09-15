package elo

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"slices"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/arenasettings"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// Well-known ids of the global arena (ADR-24). Chosen outside the legacy
// int-era migration pattern 00000000-0000-0000-0000-0000000000NN (ADR-07) and
// outside random-UUID space, so they can never be confused with a migrated or
// client-generated entity id. The rows are created by schema migration 051 in
// every environment; SQL literals of the same values live in the query files
// (see pkg/db/query/rating.sql) and must be kept in sync.
const (
	globalArenaIDUUID      = "a2ea0000-0000-0000-0000-000000000001"
	globalArenaFilterIDStr = "a2ea0000-0000-0000-0000-000000000002"
)

// GlobalArenaID is the arena behind /players, market settlements and
// corrections.
var GlobalArenaID = mustParseID("elo: global arena id", globalArenaIDUUID)

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

// MatchFilter decides which matches belong to an arena. A match meets the
// filter iff it satisfies every present condition (nil = condition absent);
// GameIDs/TagIDs are OR'd, and both empty mean any game. The matching SQL
// lives in pkg/db/query/arenas.sql (the canonical copy of the condition).
type MatchFilter struct {
	DateFrom     *time.Time
	DateTo       *time.Time
	GameIDs      []id.ID
	TagIDs       []id.ID
	TournamentID *id.ID
}

// IsUnconditional reports whether the filter admits every match (the global
// arena's filter).
func (f MatchFilter) IsUnconditional() bool {
	return f.DateFrom == nil && f.DateTo == nil &&
		len(f.GameIDs) == 0 && len(f.TagIDs) == 0 && f.TournamentID == nil
}

// Arena is the domain view of an arenas row joined with its filter and with
// the settings document parsed (the document was validated at write time).
type Arena struct {
	ID              id.ID
	Name            string
	Settings        arenasettings.Settings
	SettingsRaw     json.RawMessage
	SettingsVersion int
	// Anchor columns of auto-managed arenas; both nil for user-created ones.
	GameID       *id.ID
	TournamentID *id.ID
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

// IArenaService exposes arena reads, editor CRUD, the update pipeline and the
// background worker.
type IArenaService interface {
	// Reads.
	ListArenas(ctx context.Context) ([]ArenaWithCount, error)
	// ListArenasByKind narrows the list: "games" returns every non-tournament
	// arena except the global one, "tournaments" only the tournament arenas.
	ListArenasByKind(ctx context.Context, kind string) ([]ArenaWithCount, error)
	GetArena(ctx context.Context, arenaID id.ID) (Arena, error)
	ListArenasForGame(ctx context.Context, gameID id.ID) ([]Arena, error)
	GetArenaByGame(ctx context.Context, gameID id.ID) (Arena, error)
	GetArenaByTournament(ctx context.Context, tournamentID id.ID) (Arena, error)
	GetArenaPlayers(ctx context.Context, arenaID id.ID) ([]ArenaPlayer, error)
	// GetArenaPlayersAt computes the arena standings as of a past moment
	// (read-time over the settlement ledger) for the rank-change history.
	GetArenaPlayersAt(ctx context.Context, arenaID id.ID, at time.Time) ([]ArenaPlayer, error)
	ListArenaMatchesPaginated(ctx context.Context, arg db.ListArenaMatchesPaginatedParams) ([]db.ListArenaMatchesPaginatedRow, error)

	// CRUD (editor-gated at the handler). Settings must be a document valid
	// against the current arenasettings schema.
	CreateArena(ctx context.Context, opts ArenaWriteOpts) (Arena, error)
	UpdateArena(ctx context.Context, arenaID id.ID, opts ArenaWriteOpts) (Arena, error)
	DeleteArena(ctx context.Context, arenaID id.ID) (Arena, error)

	// Lifecycle hooks for auto-managed arenas; called inside the creating /
	// renaming service's transaction. The created arenas start stale and are
	// filled by the background worker.
	EnsureGameArena(ctx context.Context, q *db.Queries, gameID id.ID, gameName string) error
	EnsureTournamentArena(ctx context.Context, q *db.Queries, tournamentID id.ID, tournamentName string) error
	SyncArenaName(ctx context.Context, q *db.Queries, arena Arena, entityName string) error

	// Update pipeline. MarkAndDrainAfterMatchWrite marks the affected arenas
	// (never the global one — it is maintained transactionally by the match
	// settlement path) for an incremental recalculation from fromDate and
	// drains them synchronously in the caller's transaction. The Mark*Stale
	// variants only mark; the background worker drains later.
	MarkAndDrainAfterMatchWrite(ctx context.Context, q *db.Queries, affected []id.ID, fromDate time.Time) error
	MarkTagFilteredArenasStale(ctx context.Context, q *db.Queries) error
	MarkAllStaleFull(ctx context.Context, q *db.Queries) error

	// RecalculateArenas recalculates every non-global arena from scratch, one
	// transaction per arena, and reports per-arena changed players. The
	// global arena is replayed by MatchService.RecalculateAllGlobalElo.
	RecalculateArenas(ctx context.Context) ([]ArenaUpdateReport, error)

	// ScheduleNextUpdate runs the background update loop until ctx is
	// cancelled: recalculate stale arenas whose debounce has elapsed.
	ScheduleNextUpdate(ctx context.Context)
}

// ArenaWriteOpts carries the editable fields for CreateArena/UpdateArena.
type ArenaWriteOpts struct {
	Name   string
	Filter MatchFilter
	// SettingsRaw must validate against the current arenasettings schema.
	SettingsRaw json.RawMessage
}

type ArenaService struct {
	Queries *db.Queries
	Pool    *pgxpool.Pool
	Hub     *Hub // nil-safe; used to nudge clients after background recalcs
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
	gameID, tournamentID *id.ID, recalcFrom, staleAt, dateFrom, dateTo pgtype.Timestamptz,
	filterGameIDs, filterTagIDs []id.ID, filterTournamentID *id.ID,
) (Arena, error) {
	settings, err := arenasettings.Parse(raw)
	if err != nil {
		return Arena{}, fmt.Errorf("arena %s: %w", arenaID, err)
	}
	return Arena{
		ID: arenaID, Name: name,
		Settings: settings, SettingsRaw: raw, SettingsVersion: int(version),
		GameID: gameID, TournamentID: tournamentID,
		RecalcFrom: tsPtr(recalcFrom), StaleAt: tsPtr(staleAt),
		Filter: MatchFilter{
			DateFrom: tsPtr(dateFrom), DateTo: tsPtr(dateTo),
			GameIDs: filterGameIDs, TagIDs: filterTagIDs, TournamentID: filterTournamentID,
		},
	}, nil
}

func arenaFromGetArenaRow(r db.GetArenaRow) (Arena, error) {
	return arenaFromParts(r.ID, r.Name, r.Settings, r.SettingsSchemaVersion,
		r.GameID, r.TournamentID, r.RecalcFrom, r.StaleAt,
		r.DateFrom, r.DateTo, r.FilterGameIds, r.FilterTagIds, r.FilterTournamentID)
}

func arenaFromListRow(r db.ListArenasRow) (ArenaWithCount, error) {
	a, err := arenaFromParts(r.ID, r.Name, r.Settings, r.SettingsSchemaVersion,
		r.GameID, r.TournamentID, r.RecalcFrom, r.StaleAt,
		r.DateFrom, r.DateTo, r.FilterGameIds, r.FilterTagIds, r.FilterTournamentID)
	return ArenaWithCount{Arena: a, MatchesCount: int(r.MatchesCount)}, err
}

func arenaFromStaleRow(r db.ListStaleArenasRow) (Arena, error) {
	return arenaFromParts(r.ID, r.Name, r.Settings, r.SettingsSchemaVersion,
		r.GameID, r.TournamentID, r.RecalcFrom, r.StaleAt,
		r.DateFrom, r.DateTo, r.FilterGameIds, r.FilterTagIds, r.FilterTournamentID)
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

func (s *ArenaService) ListArenas(ctx context.Context) ([]ArenaWithCount, error) {
	return s.listArenas(ctx, nil)
}

func (s *ArenaService) ListArenasByKind(ctx context.Context, kind string) ([]ArenaWithCount, error) {
	return s.listArenas(ctx, &kind)
}

func (s *ArenaService) listArenas(ctx context.Context, kind *string) ([]ArenaWithCount, error) {
	rows, err := s.Queries.ListArenas(ctx, ptrText(kind))
	if err != nil {
		return nil, fmt.Errorf("list arenas: %w", err)
	}
	out := make([]ArenaWithCount, 0, len(rows))
	for _, r := range rows {
		a, err := arenaFromListRow(r)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, nil
}

func (s *ArenaService) GetArena(ctx context.Context, arenaID id.ID) (Arena, error) {
	r, err := s.Queries.GetArena(ctx, arenaID)
	if err != nil {
		return Arena{}, fmt.Errorf("get arena %s: %w", arenaID, err)
	}
	return arenaFromGetArenaRow(r)
}

func (s *ArenaService) ListArenasForGame(ctx context.Context, gameID id.ID) ([]Arena, error) {
	rows, err := s.Queries.ListArenasForGame(ctx, &gameID)
	if err != nil {
		return nil, fmt.Errorf("list arenas for game %s: %w", gameID, err)
	}
	out := make([]Arena, 0, len(rows))
	for _, r := range rows {
		a, err := arenaFromParts(r.ID, r.Name, r.Settings, r.SettingsSchemaVersion,
			r.GameID, r.TournamentID, r.RecalcFrom, r.StaleAt,
			r.DateFrom, r.DateTo, r.FilterGameIds, r.FilterTagIds, r.FilterTournamentID)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, nil
}

func (s *ArenaService) GetArenaByGame(ctx context.Context, gameID id.ID) (Arena, error) {
	r, err := s.Queries.GetArenaByGame(ctx, &gameID)
	if err != nil {
		return Arena{}, fmt.Errorf("get arena for game %s: %w", gameID, err)
	}
	return arenaFromParts(r.ID, r.Name, r.Settings, r.SettingsSchemaVersion,
		r.GameID, r.TournamentID, r.RecalcFrom, r.StaleAt,
		r.DateFrom, r.DateTo, r.FilterGameIds, r.FilterTagIds, r.FilterTournamentID)
}

func (s *ArenaService) GetArenaByTournament(ctx context.Context, tournamentID id.ID) (Arena, error) {
	r, err := s.Queries.GetArenaByTournament(ctx, &tournamentID)
	if err != nil {
		return Arena{}, fmt.Errorf("get arena for tournament %s: %w", tournamentID, err)
	}
	return arenaFromParts(r.ID, r.Name, r.Settings, r.SettingsSchemaVersion,
		r.GameID, r.TournamentID, r.RecalcFrom, r.StaleAt,
		r.DateFrom, r.DateTo, r.FilterGameIds, r.FilterTagIds, r.FilterTournamentID)
}

// GetArenaPlayers returns the arena's current players ranked, with the
// precalculated medal stats. Leagues sort elite → amateur → newbie (the
// settings list is promotion order, ranking inverts it), rating descending
// within a league, ties sharing a rank. When the arena has no leagues
// everyone sits in one list ordered by rating.
func (s *ArenaService) GetArenaPlayers(ctx context.Context, arenaID id.ID) ([]ArenaPlayer, error) {
	arena, err := s.GetArena(ctx, arenaID)
	if err != nil {
		return nil, err
	}
	eloSettings, err := s.eloSettingsAt(ctx, time.Now())
	if err != nil {
		return nil, err
	}

	rows, err := s.Queries.ListArenaPlayers(ctx, arenaID)
	if err != nil {
		return nil, fmt.Errorf("list arena players: %w", err)
	}

	players := make([]ArenaPlayer, 0, len(rows))
	for _, r := range rows {
		league := textPtr(r.League)
		p := ArenaPlayer{
			ID: r.PlayerID, Name: r.PlayerName,
			Rating: float64Or(r.RatingAfter, arena.Settings.StartingRating), League: league,
			MatchesCount: int(r.MatchesCount),
			FirstCount:   int(r.FirstCount), SecondCount: int(r.SecondCount),
			ThirdCount: int(r.ThirdCount), FourthCount: int(r.FourthCount),
		}
		applyArenaPlayerHints(&p, float64Or(r.EloAfter, eloSettings.StartingElo), 0, 0, arena, eloSettings)
		players = append(players, p)
	}

	sortAndRankArenaPlayers(players, arena)
	return players, nil
}

// GetArenaPlayersAt returns the arena's point-in-time standings (read-time
// computation over the settlement ledger) — the basis of the rank-change
// history. Medal stats are not computed here.
func (s *ArenaService) GetArenaPlayersAt(ctx context.Context, arenaID id.ID, at time.Time) ([]ArenaPlayer, error) {
	arena, err := s.GetArena(ctx, arenaID)
	if err != nil {
		return nil, err
	}
	eloSettings, err := s.eloSettingsAt(ctx, at)
	if err != nil {
		return nil, err
	}

	rows, err := s.Queries.ListArenaPlayersAt(ctx, db.ListArenaPlayersAtParams{
		ArenaID: arenaID,
		Date:    pgtype.Timestamptz{Time: at, Valid: true},
	})
	if err != nil {
		return nil, fmt.Errorf("list arena players at %v: %w", at, err)
	}

	players := make([]ArenaPlayer, 0, len(rows))
	for _, r := range rows {
		league := textPtr(r.League)
		p := ArenaPlayer{
			ID: r.PlayerID, Name: r.PlayerName,
			Rating: float64Or(r.RatingAfter, arena.Settings.StartingRating), League: league,
		}
		applyArenaPlayerHints(&p, float64Or(r.EloAfter, eloSettings.StartingElo), int(r.Cnt60), int(r.Cnt180), arena, eloSettings)
		players = append(players, p)
	}

	sortAndRankArenaPlayers(players, arena)
	return players, nil
}

// float64Or asserts a nullable-column value, falling back to def when the row
// (or the LATERAL join) produced NULL.
func float64Or(v any, def float64) float64 {
	if f, ok := v.(float64); ok {
		return f
	}
	return def
}

func (s *ArenaService) eloSettingsAt(ctx context.Context, at time.Time) (EloSettings, error) {
	row, err := s.Queries.GetEloSettingsForDate(ctx, pgtype.Timestamptz{Time: at, Valid: true})
	if err != nil {
		return EloSettings{}, fmt.Errorf("get elo settings: %w", err)
	}
	return EloSettingsFromDB(row), nil
}

// applyArenaPlayerHints fills the informational newbie/elite promotion
// counters when the player is in the matching league.
func applyArenaPlayerHints(p *ArenaPlayer, eloAfter float64, cnt60, cnt180 int, arena Arena, s EloSettings) {
	if p.League == nil {
		return
	}
	if *p.League == LeagueNewbie {
		if gap := eloAfter - p.Rating; gap > 0 {
			if nl, ok := arena.Settings.Newbie(); ok {
				p.WinsNeededForAmateurLower, p.WinsNeededForAmateurUpper = calcWinsNeededForAmateur(gap, nl, s)
			}
		}
	}
	if *p.League == LeagueAmateur {
		if el, ok := arena.Settings.Elite(); ok {
			deficit := max(el.Matches6M-cnt180, el.Matches2M-cnt60)
			if deficit > 0 {
				p.MatchesLeftForElite = deficit
			}
		}
	}
}

func sortAndRankArenaPlayers(players []ArenaPlayer, arena Arena) {
	slices.SortFunc(players, func(a, b ArenaPlayer) int {
		pa, pb := arenaLeaguePriority(a.League, arena), arenaLeaguePriority(b.League, arena)
		if pa != pb {
			return pa - pb
		}
		if b.Rating-a.Rating > 0 {
			return 1
		}
		if b.Rating-a.Rating < 0 {
			return -1
		}
		return 0
	})

	rank := 0
	var prevRound float64 = math.NaN()
	var prevRank *int
	var prevLeague *string
	for i := range players {
		rounded := math.Round(players[i].Rating)
		if !math.IsNaN(prevRound) && rounded == prevRound && leaguePtrEqual(players[i].League, prevLeague) {
			players[i].Rank = prevRank
		} else {
			r := rank + 1
			players[i].Rank = &r
			prevRank = players[i].Rank
			prevRound = rounded
			prevLeague = players[i].League
		}
		rank++
	}
}

func leaguePtrEqual(a, b *string) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func (s *ArenaService) ListArenaMatchesPaginated(ctx context.Context, arg db.ListArenaMatchesPaginatedParams) ([]db.ListArenaMatchesPaginatedRow, error) {
	return s.Queries.ListArenaMatchesPaginated(ctx, arg)
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

// validateSettings validates a settings document and returns it with the
// current schema version stamped by the caller.
func validateSettings(raw json.RawMessage) error {
	if err := arenasettings.Validate(raw); err != nil {
		return err
	}
	if _, err := arenasettings.Parse(raw); err != nil {
		return err
	}
	return nil
}

func (s *ArenaService) CreateArena(ctx context.Context, opts ArenaWriteOpts) (Arena, error) {
	if err := validateSettings(opts.SettingsRaw); err != nil {
		return Arena{}, err
	}
	created, err := runInTxResult(ctx, s.Pool, func(q *db.Queries) (Arena, error) {
		filterID, err := createMatchFilter(ctx, q, opts.Filter)
		if err != nil {
			return Arena{}, err
		}
		row, err := q.CreateArena(ctx, db.CreateArenaParams{
			ID:                    id.NewMonotonic(),
			Name:                  opts.Name,
			MatchFilterID:         filterID,
			Settings:              opts.SettingsRaw,
			SettingsSchemaVersion: arenasettings.CurrentVersion,
		})
		if err != nil {
			return Arena{}, fmt.Errorf("create arena: %w", err)
		}
		// A new arena needs a full recalculation before it has data.
		if err := q.MarkArenasStaleFull(ctx, []id.ID{row.ID}); err != nil {
			return Arena{}, fmt.Errorf("mark new arena stale: %w", err)
		}
		created, err := q.GetArena(ctx, row.ID)
		if err != nil {
			return Arena{}, fmt.Errorf("get created arena: %w", err)
		}
		return arenaFromGetArenaRow(created)
	})
	if err != nil {
		return Arena{}, err
	}
	return created, nil
}

func (s *ArenaService) UpdateArena(ctx context.Context, arenaID id.ID, opts ArenaWriteOpts) (Arena, error) {
	if err := validateSettings(opts.SettingsRaw); err != nil {
		return Arena{}, err
	}
	updated, err := runInTxResult(ctx, s.Pool, func(q *db.Queries) (Arena, error) {
		existing, err := s.GetArena(ctx, arenaID)
		if err != nil {
			return Arena{}, err
		}
		// Auto-managed arenas are owned by their game/tournament lifecycle;
		// their filters and settings are system-managed (ADR-24).
		if existing.GameID != nil || existing.TournamentID != nil {
			return Arena{}, ErrArenaIsAutoManaged
		}
		filterID, err := createMatchFilter(ctx, q, opts.Filter)
		if err != nil {
			return Arena{}, err
		}
		if _, err := q.UpdateArena(ctx, db.UpdateArenaParams{
			ID:                    arenaID,
			Name:                  opts.Name,
			MatchFilterID:         filterID,
			Settings:              opts.SettingsRaw,
			SettingsSchemaVersion: arenasettings.CurrentVersion,
		}); err != nil {
			return Arena{}, fmt.Errorf("update arena %s: %w", arenaID, err)
		}
		// A filter or settings change affects the whole history: full recalc.
		if err := q.MarkArenasStaleFull(ctx, []id.ID{arenaID}); err != nil {
			return Arena{}, fmt.Errorf("mark arena stale: %w", err)
		}
		updated, err := q.GetArena(ctx, arenaID)
		if err != nil {
			return Arena{}, fmt.Errorf("get updated arena: %w", err)
		}
		return arenaFromGetArenaRow(updated)
	})
	if err != nil {
		return Arena{}, err
	}
	return updated, nil
}

func (s *ArenaService) DeleteArena(ctx context.Context, arenaID id.ID) (Arena, error) {
	if arenaID == GlobalArenaID {
		return Arena{}, ErrGlobalArenaIsPermanent
	}
	deleted, err := runInTxResult(ctx, s.Pool, func(q *db.Queries) (Arena, error) {
		existing, err := s.GetArena(ctx, arenaID)
		if err != nil {
			return Arena{}, err
		}
		if existing.GameID != nil || existing.TournamentID != nil {
			return Arena{}, ErrArenaIsAutoManaged
		}
		row, err := q.DeleteArena(ctx, arenaID)
		if err != nil {
			return Arena{}, fmt.Errorf("delete arena %s: %w", arenaID, err)
		}
		existing.Name = row.Name
		return existing, nil
	})
	if err != nil {
		return Arena{}, err
	}
	return deleted, nil
}

// createMatchFilter persists a new match_filters row and returns its id.
func createMatchFilter(ctx context.Context, q *db.Queries, f MatchFilter) (id.ID, error) {
	filterID := id.NewMonotonic()
	if _, err := q.CreateMatchFilter(ctx, db.CreateMatchFilterParams{
		ID:           filterID,
		DateFrom:     timePtrTz(f.DateFrom),
		DateTo:       timePtrTz(f.DateTo),
		GameIds:      f.GameIDs,
		TagIds:       f.TagIDs,
		TournamentID: f.TournamentID,
	}); err != nil {
		return "", fmt.Errorf("create match filter: %w", err)
	}
	return filterID, nil
}

func timePtrTz(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: *t, Valid: true}
}

// ---------------------------------------------------------------------------
// Lifecycle hooks for auto-managed arenas
// ---------------------------------------------------------------------------

// settingsDoc builds a settings document for auto-created arenas.
func settingsDoc(startingRating float64, leagues []arenasettings.League) (json.RawMessage, error) {
	type leagueDoc struct {
		Kind      string   `json:"kind"`
		GoalGap   *float64 `json:"goal_gap,omitempty"`
		EarnedMin *float64 `json:"earned_min,omitempty"`
		EarnedMax *float64 `json:"earned_max,omitempty"`
		Tau       *float64 `json:"tau,omitempty"`
		Matches6M *int     `json:"matches_6m,omitempty"`
		Matches2M *int     `json:"matches_2m,omitempty"`
	}
	doc := struct {
		StartingRating float64     `json:"starting_rating"`
		Leagues        []leagueDoc `json:"leagues"`
	}{StartingRating: startingRating, Leagues: make([]leagueDoc, 0, len(leagues))}
	for _, l := range leagues {
		d := leagueDoc{Kind: l.Kind}
		switch l.Kind {
		case LeagueNewbie:
			gap, emin, emax, tau := l.GoalGap, l.EarnedMin, l.EarnedMax, l.Tau
			d.GoalGap, d.EarnedMin, d.EarnedMax, d.Tau = &gap, &emin, &emax, &tau
		case LeagueElite:
			m6, m2 := l.Matches6M, l.Matches2M
			d.Matches6M, d.Matches2M = &m6, &m2
		}
		doc.Leagues = append(doc.Leagues, d)
	}
	raw, err := json.Marshal(doc)
	if err != nil {
		return nil, fmt.Errorf("marshal arena settings: %w", err)
	}
	return raw, nil
}

// defaultLeagueParams copies the current newbie/elite league parameters from
// the live elo settings, preserving the pre-rework behavior.
func (s *ArenaService) defaultLeagueParams(ctx context.Context) (newbie arenasettings.League, elite arenasettings.League, startingElo float64, err error) {
	row, err := s.Queries.GetEloSettingsForDate(ctx, pgtype.Timestamptz{Time: time.Now(), Valid: true})
	if err != nil {
		return arenasettings.League{}, arenasettings.League{}, 0, fmt.Errorf("get elo settings: %w", err)
	}
	es := EloSettingsFromDB(row)
	return arenasettings.League{
		Kind: LeagueNewbie, GoalGap: es.NewbieLeagueGoalGap,
		EarnedMin: es.NewbieLeagueEarnedMin, EarnedMax: es.NewbieLeagueEarnedMax, Tau: es.NewbieLeagueEarnedTau,
	}, arenasettings.League{Kind: LeagueElite, Matches6M: es.EliteMatches6M, Matches2M: es.EliteMatches2M}, es.StartingElo, nil
}

// EnsureGameArena creates the per-game arena when the game is created. The
// arena mirrors the pre-rework game arena: newbie + amateur, the game starting
// rating.
func (s *ArenaService) EnsureGameArena(ctx context.Context, q *db.Queries, gameID id.ID, gameName string) error {
	if _, err := q.GetArenaByGame(ctx, &gameID); !db.IsNoRows(err) {
		return err // exists (or real error)
	}
	newbie, _, startingElo, err := s.defaultLeagueParams(ctx)
	if err != nil {
		return err
	}
	raw, err := settingsDoc(startingRatingGameArenaDefault, []arenasettings.League{newbie, {Kind: LeagueAmateur}})
	if err != nil {
		return err
	}
	return createAutoArena(ctx, q, arenaCreateInput{
		name:           arenaName(gameName),
		settings:       raw,
		gameID:         &gameID,
		startingRating: startingRatingGameArenaDefault,
		startingElo:    startingElo,
	})
}

// EnsureTournamentArena creates the tournament arena: no leagues, rating ≡ elo.
func (s *ArenaService) EnsureTournamentArena(ctx context.Context, q *db.Queries, tournamentID id.ID, tournamentName string) error {
	if _, err := q.GetArenaByTournament(ctx, &tournamentID); !db.IsNoRows(err) {
		return err
	}
	_, _, startingElo, err := s.defaultLeagueParams(ctx)
	if err != nil {
		return err
	}
	raw, err := settingsDoc(startingElo, nil)
	if err != nil {
		return err
	}
	return createAutoArena(ctx, q, arenaCreateInput{
		name:           arenaName(tournamentName),
		settings:       raw,
		tournamentID:   &tournamentID,
		startingRating: startingElo,
		startingElo:    startingElo,
	})
}

type arenaCreateInput struct {
	name           string
	settings       json.RawMessage
	gameID         *id.ID
	tournamentID   *id.ID
	startingRating float64
	startingElo    float64
}

// createAutoArena inserts the filter + arena rows and marks the arena stale.
func createAutoArena(ctx context.Context, q *db.Queries, in arenaCreateInput) error {
	var filter MatchFilter
	if in.gameID != nil {
		filter.GameIDs = []id.ID{*in.gameID}
	}
	if in.tournamentID != nil {
		filter.TournamentID = in.tournamentID
	}
	filterID, err := createMatchFilter(ctx, q, filter)
	if err != nil {
		return err
	}
	row, err := q.CreateArena(ctx, db.CreateArenaParams{
		ID:                    id.NewMonotonic(),
		Name:                  in.name,
		MatchFilterID:         filterID,
		Settings:              in.settings,
		SettingsSchemaVersion: arenasettings.CurrentVersion,
		GameID:                in.gameID,
		TournamentID:          in.tournamentID,
	})
	if err != nil {
		return fmt.Errorf("create arena: %w", err)
	}
	return q.MarkArenasStaleFull(ctx, []id.ID{row.ID})
}

// SyncArenaName renames an auto-managed arena after its entity.
func (s *ArenaService) SyncArenaName(ctx context.Context, q *db.Queries, arena Arena, entityName string) error {
	if arena.GameID == nil && arena.TournamentID == nil {
		return nil
	}
	return q.UpdateArenaName(ctx, db.UpdateArenaNameParams{ID: arena.ID, Name: arenaName(entityName)})
}

func arenaName(entityName string) string { return "Арена: " + entityName }

// startingRatingGameArenaDefault preserves the pre-rework per-game starting
// rating (elo_settings.starting_rating_game_arena default).
const startingRatingGameArenaDefault = 900

// ---------------------------------------------------------------------------
// Marks and drains
// ---------------------------------------------------------------------------

// MarkAndDrainAfterMatchWrite refreshes the global arena's precalculated
// stats (its settlements are already maintained transactionally by the match
// settlement path), marks the affected other arenas for an incremental
// recalculation from fromDate, and recalculates them synchronously in the
// caller's transaction (ADR-24: match writes update all arenas).
func (s *ArenaService) MarkAndDrainAfterMatchWrite(ctx context.Context, q *db.Queries, affected []id.ID, fromDate time.Time) error {
	// The stats are aggregates over the arena's match set; the global arena's
	// match set just changed even though its settlements were replayed
	// elsewhere, so recompute them here.
	if err := q.DeleteArenaStats(ctx, GlobalArenaID); err != nil {
		return fmt.Errorf("delete global arena stats: %w", err)
	}
	if err := q.InsertArenaStats(ctx, GlobalArenaID); err != nil {
		return fmt.Errorf("insert global arena stats: %w", err)
	}

	ids := make([]id.ID, 0, len(affected))
	for _, aid := range affected {
		if aid != GlobalArenaID {
			ids = append(ids, aid)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	if err := q.MarkArenasStaleFromDate(ctx, db.MarkArenasStaleFromDateParams{
		FromDate: fromDate,
		ArenaIds: ids,
	}); err != nil {
		return fmt.Errorf("mark arenas stale: %w", err)
	}
	return s.drainDueArenas(ctx, q, time.Now())
}

// MarkTagFilteredArenasStale marks every arena with a tag condition for a full
// recalculation — the conservative response to any game's tag set changing.
func (s *ArenaService) MarkTagFilteredArenasStale(ctx context.Context, q *db.Queries) error {
	ids, err := q.ListTagFilteredArenaIds(ctx)
	if err != nil {
		return fmt.Errorf("list tag-filtered arenas: %w", err)
	}
	if len(ids) == 0 {
		return nil
	}
	return q.MarkArenasStaleFull(ctx, ids)
}

// MarkAllStaleFull marks every non-global arena for a full recalculation.
func (s *ArenaService) MarkAllStaleFull(ctx context.Context, q *db.Queries) error {
	arenas, err := s.ListArenas(ctx)
	if err != nil {
		return err
	}
	ids := make([]id.ID, 0, len(arenas))
	for _, a := range arenas {
		if a.ID != GlobalArenaID {
			ids = append(ids, a.ID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	return q.MarkArenasStaleFull(ctx, ids)
}

// drainDueArenas recalculates every arena whose stale mark is due (mark older
// than the debounce, or drained synchronously by a match write). Runs in the
// caller's transaction.
func (s *ArenaService) drainDueArenas(ctx context.Context, q *db.Queries, now time.Time) error {
	rows, err := q.ListStaleArenas(ctx, now)
	if err != nil {
		return fmt.Errorf("list stale arenas: %w", err)
	}
	for _, r := range rows {
		if r.ID == GlobalArenaID {
			continue // maintained transactionally by the settlement path
		}
		arena, err := arenaFromStaleRow(r)
		if err != nil {
			return err
		}
		if err := s.updateArenaWithinTx(ctx, q, arena); err != nil {
			return fmt.Errorf("update arena %s: %w", r.ID, err)
		}
	}
	return nil
}

// RecalculateArenas recalculates every non-global arena from scratch and
// reports the changed players per arena. One transaction per arena.
func (s *ArenaService) RecalculateArenas(ctx context.Context) ([]ArenaUpdateReport, error) {
	arenas, err := s.ListArenas(ctx)
	if err != nil {
		return nil, err
	}
	reports := make([]ArenaUpdateReport, 0, len(arenas))
	for _, a := range arenas {
		if a.ID == GlobalArenaID {
			continue
		}
		report, err := s.recalculateArena(ctx, a)
		if err != nil {
			return nil, fmt.Errorf("recalculate arena %s: %w", a.ID, err)
		}
		reports = append(reports, report)
	}
	return reports, nil
}

// recalculateArena runs one full arena recalculation with a before/after
// player-state diff, in a single transaction.
func (s *ArenaService) recalculateArena(ctx context.Context, a ArenaWithCount) (ArenaUpdateReport, error) {
	report := ArenaUpdateReport{ArenaID: a.ID, ArenaName: a.Name, MatchesReplayed: a.MatchesCount}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return report, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.Queries.WithTx(tx)

	before, err := q.ListLatestArenaStatePerPlayer(ctx, a.ID)
	if err != nil {
		return report, fmt.Errorf("snapshot before: %w", err)
	}

	if err := q.MarkArenasStaleFull(ctx, []id.ID{a.ID}); err != nil {
		return report, fmt.Errorf("mark stale: %w", err)
	}
	locked, err := s.GetArena(ctx, a.ID)
	if err != nil {
		return report, err
	}
	if err := s.updateArenaWithinTx(ctx, q, locked); err != nil {
		return report, err
	}

	after, err := q.ListLatestArenaStatePerPlayer(ctx, a.ID)
	if err != nil {
		return report, fmt.Errorf("snapshot after: %w", err)
	}
	report.ChangedPlayers = diffArenaState(before, after)

	if err := tx.Commit(ctx); err != nil {
		return report, fmt.Errorf("commit tx: %w", err)
	}
	return report, nil
}

// ScheduleNextUpdate is the background worker loop: every poll interval it
// recalculates arenas whose stale mark has aged past the debounce window, so
// bursts of marks (admin toggling game tags) coalesce into one recalculation.
func (s *ArenaService) ScheduleNextUpdate(ctx context.Context) {
	poll := time.NewTicker(arenaUpdatePollInterval)
	defer poll.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-poll.C:
			due := time.Now().Add(-arenaUpdateDebounce)
			changed, err := s.updateDueArenasOwnTxs(ctx, due)
			if err != nil {
				log.Printf("arena update: %v", err)
				continue
			}
			if changed && s.Hub != nil {
				s.Hub.PublishSignal(TopicData, "matches-changed")
				s.Hub.PublishSignal(TopicData, "players-changed")
			}
		}
	}
}

// updateDueArenasOwnTxs recalculates due stale arenas, each in its own
// transaction, so one failing arena does not block the others. Reports whether
// anything changed.
func (s *ArenaService) updateDueArenasOwnTxs(ctx context.Context, due time.Time) (bool, error) {
	rows, err := s.Queries.ListStaleArenas(ctx, due)
	if err != nil {
		return false, fmt.Errorf("list stale arenas: %w", err)
	}
	changed := false
	for _, r := range rows {
		if r.ID == GlobalArenaID {
			continue
		}
		arena, err := arenaFromStaleRow(r)
		if err != nil {
			return changed, err
		}
		err = runInTx(ctx, s.Pool, func(q *db.Queries) error {
			return s.updateArenaWithinTx(ctx, q, arena)
		})
		if err != nil {
			return changed, fmt.Errorf("update arena %s: %w", r.ID, err)
		}
		changed = true
		log.Printf("arena update: recalculated %q (%s)", arena.Name, arena.ID)
	}
	return changed, nil
}
