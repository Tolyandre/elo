package elo

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/arenasettings"
	"github.com/tolyandre/elo-web-service/pkg/audit"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

// validateSettings validates a settings document and returns it with the
// current schema version stamped by the caller.
func validateSettings(raw json.RawMessage) (arenasettings.Settings, error) {
	if err := arenasettings.Validate(raw); err != nil {
		return arenasettings.Settings{}, err
	}
	settings, err := arenasettings.Parse(raw)
	if err != nil {
		return arenasettings.Settings{}, err
	}
	return settings, nil
}

// validateCampWrite enforces the camp invariants the DB CHECKs also guard:
// a required, ordered window, and no leagues (camps rank like today's
// tournament arenas — a single rating ≡ elo list).
func validateCampWrite(settings arenasettings.Settings, startsAt, endsAt *time.Time) error {
	if len(settings.Leagues) > 0 {
		return ErrCampLeaguesNotAllowed
	}
	if startsAt == nil || endsAt == nil {
		return ErrCampDatesRequired
	}
	if !startsAt.Before(*endsAt) {
		return ErrCampDatesInvalid
	}
	return nil
}

func (s *ArenaService) CreateArena(ctx context.Context, actor id.ID, opts ArenaWriteOpts) (Arena, error) {
	settings, err := validateSettings(opts.SettingsRaw)
	if err != nil {
		return Arena{}, err
	}
	if opts.Camp {
		if err := validateCampWrite(settings, opts.StartsAt, opts.EndsAt); err != nil {
			return Arena{}, err
		}
	}
	created, err := runInTxResult(ctx, s.Pool, func(q *db.Queries) (Arena, error) {
		if err := ensureArenaNameFree(ctx, q, opts.Name, nil); err != nil {
			return Arena{}, err
		}
		var filterID *id.ID
		if !opts.Camp {
			fid, err := createMatchFilter(ctx, q, opts.Filter)
			if err != nil {
				return Arena{}, err
			}
			filterID = &fid
		}
		row, err := q.CreateArena(ctx, db.CreateArenaParams{
			ID:                    id.NewMonotonic(),
			Name:                  opts.Name,
			MatchFilterID:         filterID,
			Settings:              opts.SettingsRaw,
			SettingsSchemaVersion: arenasettings.CurrentVersion,
			Camp:                  opts.Camp,
			StartsAt:              timePtrTz(opts.StartsAt),
			EndsAt:                timePtrTz(opts.EndsAt),
		})
		if err != nil {
			return Arena{}, fmt.Errorf("create arena: %w", err)
		}
		// A new arena needs a full recalculation before it has data.
		if err := q.MarkArenasStaleFull(ctx, []id.ID{row.ID}); err != nil {
			return Arena{}, fmt.Errorf("mark new arena stale: %w", err)
		}
		if opts.Camp {
			if err := recordAuditEvent(ctx, q, actor, audit.EntityArena, audit.ActionCreated, row.ID,
				audit.KindArenaCampConf, audit.NewCampConfigCreated(opts.Name, *opts.StartsAt, *opts.EndsAt)); err != nil {
				return Arena{}, err
			}
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

func (s *ArenaService) UpdateArena(ctx context.Context, actor id.ID, arenaID id.ID, opts ArenaWriteOpts) (Arena, error) {
	settings, err := validateSettings(opts.SettingsRaw)
	if err != nil {
		return Arena{}, err
	}
	updated, err := runInTxResult(ctx, s.Pool, func(q *db.Queries) (Arena, error) {
		existing, err := s.GetArena(ctx, arenaID)
		if err != nil {
			return Arena{}, err
		}
		// Auto-managed arenas are owned by their game lifecycle; their filters
		// and settings are system-managed (ADR-24). Camp arenas are never
		// auto-managed (their anchors are NULL since ADR-27). A tenant's
		// main arena (ADR-36) — «Синие люди»'s included — is managed through
		// the tenant settings.
		if existing.GameID != nil || existing.TournamentID != nil {
			return Arena{}, ErrArenaIsAutoManaged
		}
		if existing.TenantID != nil {
			return Arena{}, ErrTenantArenaIsManaged
		}
		if err := ensureArenaNameFree(ctx, q, opts.Name, &arenaID); err != nil {
			return Arena{}, err
		}

		var details audit.ArenaCampConfigDetails
		if existing.Camp {
			if err := validateCampWrite(settings, opts.StartsAt, opts.EndsAt); err != nil {
				return Arena{}, err
			}
			// Dates may not be narrowed past a linked match (ADR-27): the
			// checkbox criterion and the stored links must not disagree.
			dateRange, err := q.GetCampMatchDateRange(ctx, arenaID)
			if err != nil && !db.IsNoRows(err) {
				return Arena{}, fmt.Errorf("get camp match date range: %w", err)
			}
			if err == nil {
				if opts.StartsAt.After(dateRange.MinDate) || opts.EndsAt.Before(dateRange.MaxDate) {
					return Arena{}, ErrCampDatesExcludeMatch
				}
			}
			details = campConfigDiff(existing, opts)
		}

		var filterID *id.ID
		if !opts.Camp {
			fid, err := createMatchFilter(ctx, q, opts.Filter)
			if err != nil {
				return Arena{}, err
			}
			filterID = &fid
		}
		if _, err := q.UpdateArena(ctx, db.UpdateArenaParams{
			ID:                    arenaID,
			Name:                  opts.Name,
			MatchFilterID:         filterID,
			Settings:              opts.SettingsRaw,
			SettingsSchemaVersion: arenasettings.CurrentVersion,
			Camp:                  opts.Camp,
			StartsAt:              timePtrTz(opts.StartsAt),
			EndsAt:                timePtrTz(opts.EndsAt),
		}); err != nil {
			return Arena{}, fmt.Errorf("update arena %s: %w", arenaID, err)
		}
		// A filter, window or settings change affects the whole history: full
		// recalc.
		if err := q.MarkArenasStaleFull(ctx, []id.ID{arenaID}); err != nil {
			return Arena{}, fmt.Errorf("mark arena stale: %w", err)
		}
		if existing.Camp {
			if err := recordAuditEvent(ctx, q, actor, audit.EntityArena, audit.ActionUpdated, arenaID,
				audit.KindArenaCampConf, details); err != nil {
				return Arena{}, err
			}
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

// campConfigDiff builds the before → after audit details for a camp update,
// covering only the fields that changed.
func campConfigDiff(existing Arena, opts ArenaWriteOpts) audit.ArenaCampConfigDetails {
	var name, startsAt, endsAt *[2]*string
	if existing.Name != opts.Name {
		name = &[2]*string{strPtr(existing.Name), strPtr(opts.Name)}
	}
	if existing.StartsAt == nil || !existing.StartsAt.Equal(*opts.StartsAt) {
		startsAt = &[2]*string{strPtr(existing.StartsAt.Format(time.RFC3339Nano)), strPtr(opts.StartsAt.Format(time.RFC3339Nano))}
	}
	if existing.EndsAt == nil || !existing.EndsAt.Equal(*opts.EndsAt) {
		endsAt = &[2]*string{strPtr(existing.EndsAt.Format(time.RFC3339Nano)), strPtr(opts.EndsAt.Format(time.RFC3339Nano))}
	}
	return audit.NewCampConfigChanged(name, startsAt, endsAt)
}

func (s *ArenaService) DeleteArena(ctx context.Context, actor id.ID, arenaID id.ID) (Arena, error) {
	deleted, err := runInTxResult(ctx, s.Pool, func(q *db.Queries) (Arena, error) {
		existing, err := s.GetArena(ctx, arenaID)
		if err != nil {
			return Arena{}, err
		}
		if existing.GameID != nil || existing.TournamentID != nil {
			return Arena{}, ErrArenaIsAutoManaged
		}
		if existing.TenantID != nil {
			return Arena{}, ErrTenantArenaIsManaged
		}
		row, err := q.DeleteArena(ctx, arenaID)
		if err != nil {
			return Arena{}, fmt.Errorf("delete arena %s: %w", arenaID, err)
		}
		existing.Name = row.Name
		if existing.Camp {
			// The arena_matches links and settlements cascade; matches survive
			// as ordinary matches (ADR-27).
			if err := recordAuditEvent(ctx, q, actor, audit.EntityArena, audit.ActionDeleted, arenaID,
				audit.KindArenaCampConf, audit.NewCampConfigDeleted(existing.Name, *existing.StartsAt, *existing.EndsAt)); err != nil {
				return Arena{}, err
			}
		}
		return existing, nil
	})
	if err != nil {
		return Arena{}, err
	}
	return deleted, nil
}

// ensureArenaNameFree enforces unique arena names (case-insensitively) for the
// user-facing CRUD. excludeID skips the arena being renamed; nil on create.
// Deliberately service-level rather than a unique index: auto-managed arena
// names follow game renames, and a collision there must not fail the rename.
func ensureArenaNameFree(ctx context.Context, q *db.Queries, name string, excludeID *id.ID) error {
	taken, err := q.ArenaNameExists(ctx, db.ArenaNameExistsParams{
		Name:      name,
		ExcludeID: excludeID,
	})
	if err != nil {
		return fmt.Errorf("check arena name: %w", err)
	}
	if taken {
		return ErrArenaNameTaken
	}
	return nil
}

// createMatchFilter persists a new match_filters row and returns its id.
func createMatchFilter(ctx context.Context, q *db.Queries, f MatchFilter) (id.ID, error) {
	filterID := id.NewMonotonic()
	if _, err := q.CreateMatchFilter(ctx, db.CreateMatchFilterParams{
		ID:       filterID,
		DateFrom: timePtrTz(f.DateFrom),
		DateTo:   timePtrTz(f.DateTo),
		GameIds:  f.GameIDs,
		TagIds:   f.TagIDs,
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

// EnsureTenantArena creates a tenant's main arena when missing (ADR-36,
// called at tenant creation). The arena mirrors the global arena's shape —
// newbie + amateur + elite leagues over the live elo settings, starting
// rating = the standard starting elo — but carries no filter: tenant rules
// decide membership (the attribution lands in a later ADR-36 phase, so a
// fresh tenant arena matches nothing yet).
func (s *ArenaService) EnsureTenantArena(ctx context.Context, q *db.Queries, tenantID id.ID, tenantName string) error {
	if _, err := q.GetArenaByTenant(ctx, &tenantID); !db.IsNoRows(err) {
		return err // exists (or real error)
	}
	newbie, elite, startingElo, err := s.defaultLeagueParams(ctx)
	if err != nil {
		return err
	}
	raw, err := settingsDoc(startingElo, []arenasettings.League{newbie, {Kind: LeagueAmateur}, elite})
	if err != nil {
		return err
	}
	return createAutoArena(ctx, q, arenaCreateInput{
		name:           arenaName(tenantName),
		settings:       raw,
		tenantID:       &tenantID,
		startingRating: startingElo,
		startingElo:    startingElo,
	})
}

type arenaCreateInput struct {
	name           string
	settings       json.RawMessage
	gameID         *id.ID
	tenantID       *id.ID
	startingRating float64
	startingElo    float64
}

// createAutoArena inserts the arena row (and the filter, for game arenas) and
// marks the arena stale. Tenant arenas (ADR-36) take no filter: their
// membership is decided by tenant rules, not by arena_contains_match.
func createAutoArena(ctx context.Context, q *db.Queries, in arenaCreateInput) error {
	var filterID *id.ID
	if in.gameID != nil {
		fid, err := createMatchFilter(ctx, q, MatchFilter{GameIDs: []id.ID{*in.gameID}})
		if err != nil {
			return err
		}
		filterID = &fid
	}
	row, err := q.CreateArena(ctx, db.CreateArenaParams{
		ID:                    id.NewMonotonic(),
		Name:                  in.name,
		MatchFilterID:         filterID,
		Settings:              in.settings,
		SettingsSchemaVersion: arenasettings.CurrentVersion,
		GameID:                in.gameID,
		TenantID:              in.tenantID,
	})
	if err != nil {
		return fmt.Errorf("create arena: %w", err)
	}
	return q.MarkArenasStaleFull(ctx, []id.ID{row.ID})
}

// SyncArenaName renames an auto-managed arena after its entity.
func (s *ArenaService) SyncArenaName(ctx context.Context, q *db.Queries, arena Arena, entityName string) error {
	if arena.GameID == nil {
		return nil
	}
	return q.UpdateArenaName(ctx, db.UpdateArenaNameParams{ID: arena.ID, Name: arenaName(entityName)})
}

// arenaName names an auto-managed arena after its entity — no prefix: the
// arena of game "Skull King" is just "Skull King".
func arenaName(entityName string) string { return entityName }

// startingRatingGameArenaDefault preserves the pre-rework per-game starting
// rating (elo_settings.starting_rating_game_arena default).
const startingRatingGameArenaDefault = 900
