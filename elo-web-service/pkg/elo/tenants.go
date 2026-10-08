package elo

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/arenasettings"
	"github.com/tolyandre/elo-web-service/pkg/audit"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// ITenantService is the tenant's surface (ADR-36): lifecycle, openness
// settings, club composition and the community feed. Membership is derived
// from the membership stints of the tenant's clubs (ClubService).
type ITenantService interface {
	ListTenants(ctx context.Context) ([]db.ListTenantsRow, error)
	GetTenant(ctx context.Context, tenantID id.ID) ([]db.GetTenantRow, error)
	// CreateTenant inserts the tenant with its openness settings, attaches the
	// initial clubs and ensures the main arena — all in one transaction.
	// Client-supplied ids (ADR-06) make the insert an idempotent create.
	CreateTenant(ctx context.Context, tenantID id.ID, name, arenaMembershipMode, tournamentsOpenness string, clubIDs []id.ID, actor id.ID) (db.Tenant, error)
	// UpdateTenantName renames the tenant (audit-recorded, ADR-14).
	UpdateTenantName(ctx context.Context, tenantID id.ID, name string, actor id.ID) (db.Tenant, error)
	// UpdateTenantSettings changes the openness settings. An
	// arena_membership_mode change re-interprets the main arena's whole
	// history, so the recalculation runs inside the settings transaction.
	UpdateTenantSettings(ctx context.Context, tenantID id.ID, arenaMembershipMode, tournamentsOpenness string, actor id.ID) (db.Tenant, error)
	// UpdateTenantClubs replaces the club composition wholesale. Composition
	// changes who is a member, so a change recalculates the main arena inside
	// the same transaction.
	UpdateTenantClubs(ctx context.Context, tenantID id.ID, clubIDs []id.ID, actor id.ID) error
	// UpdateTenantArenaSettings replaces the main arena's settings document
	// (starting rating and leagues, ADR-24 shape) through the tenant (ADR-36
	// phase 5): main arenas are system-managed, arena PATCH on them is a 409.
	// A settings change re-derives every rating from the settlement history,
	// so the recalculation runs inside the same transaction.
	UpdateTenantArenaSettings(ctx context.Context, tenantID id.ID, settingsRaw json.RawMessage, actor id.ID) (db.Tenant, error)
	// FeedArena returns the tenant's main arena id — the tenant feed's
	// settlement source (ADR-36). No rows means the tenant is missing.
	FeedArena(ctx context.Context, tenantID id.ID) (id.ID, error)
	// ListTenantFeedEvents selects one page of the tenant feed's event keys
	// (ADR-36); the handler assembles the payloads per type.
	ListTenantFeedEvents(ctx context.Context, arg db.ListTenantFeedEventsParams) ([]db.ListTenantFeedEventsRow, error)
}

type TenantService struct {
	Queries *db.Queries
	Pool    *pgxpool.Pool
	Arenas  *ArenaService
	// GlobalReplay runs the full global-arena settlement replay inside an open
	// transaction (ADR-36): a main-arena openness or composition change on the
	// converted global arena re-settles the whole history right in the
	// calling transaction — the global arena is never drained by the
	// background worker.
	GlobalReplay IGlobalReplay
}

func NewTenantService(pool *pgxpool.Pool, arenas *ArenaService, globalReplay IGlobalReplay) ITenantService {
	return &TenantService{
		Queries:      db.New(pool),
		Pool:         pool,
		Arenas:       arenas,
		GlobalReplay: globalReplay,
	}
}

func (s *TenantService) ListTenants(ctx context.Context) ([]db.ListTenantsRow, error) {
	return s.Queries.ListTenants(ctx)
}

func (s *TenantService) GetTenant(ctx context.Context, tenantID id.ID) ([]db.GetTenantRow, error) {
	return s.Queries.GetTenant(ctx, tenantID)
}

// validateTenantSettings checks the openness settings pair (ADR-36); both are
// always set together for a tenant.
func validateTenantSettings(arenaMembershipMode, tournamentsOpenness string) error {
	switch arenaMembershipMode {
	case ArenaMembershipAnyMember, ArenaMembershipMembersOnly:
	default:
		return ErrTenantSettingsInvalid
	}
	switch tournamentsOpenness {
	case TournamentOpennessMembersOnly, TournamentOpennessOpen:
	default:
		return ErrTenantSettingsInvalid
	}
	return nil
}

// validateTenantClubs checks that every club exists and belongs to no other
// tenant (ADR-36). Duplicate ids in the requested set are a bad request.
func validateTenantClubs(ctx context.Context, q *db.Queries, tenantID id.ID, clubIDs []id.ID) error {
	seen := map[id.ID]struct{}{}
	for _, cid := range clubIDs {
		if _, dup := seen[cid]; dup {
			return ErrTenantClubsInvalid
		}
		seen[cid] = struct{}{}
		club, err := q.GetClubByID(ctx, cid)
		if err != nil {
			return fmt.Errorf("get club %s: %w", cid, err)
		}
		if club.TenantID != nil && *club.TenantID != tenantID {
			return ErrClubAlreadyInTenant
		}
	}
	return nil
}

func (s *TenantService) CreateTenant(ctx context.Context, tenantID id.ID, name, arenaMembershipMode, tournamentsOpenness string, clubIDs []id.ID, actor id.ID) (db.Tenant, error) {
	if name == "" {
		return db.Tenant{}, ErrTenantSettingsInvalid
	}
	if err := validateTenantSettings(arenaMembershipMode, tournamentsOpenness); err != nil {
		return db.Tenant{}, err
	}
	if tenantID.IsZero() {
		tenantID = id.New()
	}
	var created db.Tenant
	err := runInTx(ctx, s.Pool, func(q *db.Queries) error {
		if err := validateTenantClubs(ctx, q, tenantID, clubIDs); err != nil {
			return err
		}
		row, err := q.CreateTenant(ctx, db.CreateTenantParams{
			ID:                  tenantID,
			Name:                name,
			ArenaMembershipMode: arenaMembershipMode,
			TournamentsOpenness: tournamentsOpenness,
		})
		if err != nil {
			return err
		}
		created = row
		if err := q.SetTenantClubs(ctx, db.SetTenantClubsParams{ClubIds: clubIDs, TenantID: tenantID}); err != nil {
			return err
		}
		// The main arena is ensured in the same transaction (a fresh tenant
		// arena starts stale and is filled by the background updater; the
		// converted global arena of «Синие люди» already exists and is left
		// untouched).
		if err := s.Arenas.EnsureTenantArena(ctx, q, tenantID, name); err != nil {
			return err
		}
		return recordAuditEvent(ctx, q, actor, audit.EntityTenant, audit.ActionCreated, tenantID, audit.KindEntity, audit.NewEntityDetails(name))
	})
	return created, err
}

func (s *TenantService) UpdateTenantName(ctx context.Context, tenantID id.ID, name string, actor id.ID) (db.Tenant, error) {
	var updated db.Tenant
	err := runInTx(ctx, s.Pool, func(q *db.Queries) error {
		old, err := q.GetTenantByID(ctx, tenantID)
		if err != nil {
			return err
		}
		updated, err = q.UpdateTenantName(ctx, db.UpdateTenantNameParams{ID: tenantID, Name: name})
		if err != nil {
			return err
		}
		if old.Name != name {
			if err := recordAuditEvent(ctx, q, actor, audit.EntityTenant, audit.ActionRenamed, tenantID, audit.KindRename, audit.NewRenameDetails(old.Name, name)); err != nil {
				return err
			}
			// The main arena is named after the tenant at creation; keep it in
			// sync like game/tournament arenas (user-renamed arenas are
			// impossible for main arenas — they are system-managed).
			if arena, err := q.GetArenaByTenant(ctx, &tenantID); err == nil {
				if err := q.UpdateArenaName(ctx, db.UpdateArenaNameParams{ID: arena.ID, Name: arenaName(name)}); err != nil {
					return err
				}
			} else if !db.IsNoRows(err) {
				return err
			}
		}
		return nil
	})
	return updated, err
}

// UpdateTenantSettings changes the openness settings of an existing tenant
// (ADR-36). An arena_membership_mode change re-interprets the main arena's
// whole history (the mode is a current setting applied over all history), so
// the recalculation runs in the settings transaction: the arena's match rows
// replay (a fresh arena here; the global arena inside the sweep below), then
// the full settlement sweep re-chains every market into its owning tenant's
// arena against the new history.
func (s *TenantService) UpdateTenantSettings(ctx context.Context, tenantID id.ID, arenaMembershipMode, tournamentsOpenness string, actor id.ID) (db.Tenant, error) {
	if err := validateTenantSettings(arenaMembershipMode, tournamentsOpenness); err != nil {
		return db.Tenant{}, err
	}
	var updated db.Tenant
	err := runInTx(ctx, s.Pool, func(q *db.Queries) error {
		old, err := q.GetTenantByID(ctx, tenantID)
		if err != nil {
			return err
		}
		row, err := q.UpdateTenantSettings(ctx, db.UpdateTenantSettingsParams{
			ID:                  tenantID,
			ArenaMembershipMode: arenaMembershipMode,
			TournamentsOpenness: tournamentsOpenness,
		})
		if err != nil {
			return err
		}
		if old.ArenaMembershipMode != arenaMembershipMode {
			if err := s.recalculateMainArena(ctx, q, tenantID); err != nil {
				return err
			}
		}
		updated = row
		return recordAuditEvent(ctx, q, actor, audit.EntityTenant, audit.ActionUpdated, tenantID, audit.KindEntity, audit.NewEntityDetails(row.Name))
	})
	return updated, err
}

// UpdateTenantClubs replaces the club composition wholesale (ADR-36). The
// change alters who is a member — and through it the main arena's history
// interpretation — so a real change recalculates the arena inside the same
// transaction. Audit-recorded as a tenant update.
func (s *TenantService) UpdateTenantClubs(ctx context.Context, tenantID id.ID, clubIDs []id.ID, actor id.ID) error {
	return runInTx(ctx, s.Pool, func(q *db.Queries) error {
		if err := validateTenantClubs(ctx, q, tenantID, clubIDs); err != nil {
			return err
		}
		before, err := attachedClubIDs(ctx, q, tenantID)
		if err != nil {
			return err
		}
		if err := q.SetTenantClubs(ctx, db.SetTenantClubsParams{ClubIds: clubIDs, TenantID: tenantID}); err != nil {
			return err
		}
		tenant, err := q.GetTenantByID(ctx, tenantID)
		if err != nil {
			return err
		}
		after := slices.Clone(clubIDs)
		slices.Sort(after)
		if !slices.Equal(before, after) {
			if err := s.recalculateMainArena(ctx, q, tenantID); err != nil {
				return err
			}
		}
		return recordAuditEvent(ctx, q, actor, audit.EntityTenant, audit.ActionUpdated, tenantID, audit.KindEntity, audit.NewEntityDetails(tenant.Name))
	})
}

// attachedClubIDs returns the tenant's currently attached club ids, sorted.
func attachedClubIDs(ctx context.Context, q *db.Queries, tenantID id.ID) ([]id.ID, error) {
	rows, err := q.GetTenant(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	out := make([]id.ID, 0, len(rows))
	for _, r := range rows {
		if r.ClubID != nil {
			out = append(out, *r.ClubID)
		}
	}
	slices.Sort(out)
	return out, nil
}

// UpdateTenantArenaSettings replaces the main arena's settings document
// (starting rating and leagues) through the tenant (ADR-36 phase 5). Main
// arenas are system-managed — arena PATCH/DELETE on them is a 409 — so the
// tenant is the only edit path. A genuine settings change re-derives every
// rating from the settlement history, so the recalculation runs inside the
// settings transaction (same machinery as an openness or composition change).
func (s *TenantService) UpdateTenantArenaSettings(ctx context.Context, tenantID id.ID, settingsRaw json.RawMessage, actor id.ID) (db.Tenant, error) {
	settings, err := validateSettings(settingsRaw)
	if err != nil {
		return db.Tenant{}, err
	}
	var updated db.Tenant
	err = runInTx(ctx, s.Pool, func(q *db.Queries) error {
		if _, err := q.GetTenantByID(ctx, tenantID); err != nil {
			return err
		}
		row, err := q.GetArenaByTenant(ctx, &tenantID)
		if err != nil {
			return err
		}
		current, err := arenaFromGetArenaByTenantRow(row)
		if err != nil {
			return err
		}
		if err := q.UpdateArenaSettings(ctx, db.UpdateArenaSettingsParams{
			ID:                    current.ID,
			Settings:              settingsRaw,
			SettingsSchemaVersion: arenasettings.CurrentVersion,
		}); err != nil {
			return err
		}
		// Only a genuine change re-derives the arena's history.
		if !settingsEqual(current.Settings, settings) {
			if err := s.recalculateMainArena(ctx, q, tenantID); err != nil {
				return err
			}
		}
		tenant, err := q.GetTenantByID(ctx, tenantID)
		if err != nil {
			return err
		}
		updated = tenant
		return recordAuditEvent(ctx, q, actor, audit.EntityTenant, audit.ActionUpdated, tenantID, audit.KindEntity, audit.NewEntityDetails(tenant.Name))
	})
	return updated, err
}

// settingsEqual compares two parsed arena settings documents.
func settingsEqual(a, b arenasettings.Settings) bool {
	return a.StartingRating == b.StartingRating && slices.EqualFunc(a.Leagues, b.Leagues, func(x, y arenasettings.League) bool {
		return x.Kind == y.Kind && x.GoalGap == y.GoalGap && x.EarnedMin == y.EarnedMin && x.EarnedMax == y.EarnedMax &&
			x.Tau == y.Tau && x.Matches6M == y.Matches6M && x.Matches2M == y.Matches2M
	})
}

// recalculateMainArena re-settles the tenant's main arena from scratch after
// its arena_membership_mode or club composition changed (ADR-36).
func (s *TenantService) recalculateMainArena(ctx context.Context, q *db.Queries, tenantID id.ID) error {
	row, err := q.GetArenaByTenant(ctx, &tenantID)
	if db.IsNoRows(err) {
		// A tenant always has a main arena; nothing to re-settle otherwise.
		return nil
	}
	if err != nil {
		return err
	}
	if row.ID != GlobalArenaID {
		// A fresh tenant arena: replay its match rows right here, in this
		// transaction (market rows survive — the arena replay deletes
		// matches only), so the sweep below re-chains every market
		// settlement against the new history instead of the stale one.
		// The mark is required: the updater's staleness check skips
		// un-marked arenas, and it clears the mark after the clean replay.
		if err := q.MarkArenasStaleFull(ctx, []id.ID{row.ID}); err != nil {
			return err
		}
		arena, err := arenaFromGetArenaByTenantRow(row)
		if err != nil {
			return err
		}
		if err := s.Arenas.updateArenaWithinTx(ctx, q, arena); err != nil {
			return fmt.Errorf("replay main arena: %w", err)
		}
	}
	// The full settlement sweep: matches re-settle per the tenant gate, and
	// every market unsets and re-settles into its owning tenant's main arena
	// against the fresh chains. The global arena is never drained by the
	// background worker, so its share of the replay always runs here.
	return s.GlobalReplay.RecalculateGlobalWithinTx(ctx, q, time.Time{})
}

// FeedArena returns the tenant's main arena id; no rows when the tenant is
// missing.
func (s *TenantService) FeedArena(ctx context.Context, tenantID id.ID) (id.ID, error) {
	row, err := s.Queries.GetArenaByTenant(ctx, &tenantID)
	if err != nil {
		var zero id.ID
		return zero, err
	}
	return row.ID, nil
}

func (s *TenantService) ListTenantFeedEvents(ctx context.Context, arg db.ListTenantFeedEventsParams) ([]db.ListTenantFeedEventsRow, error) {
	return s.Queries.ListTenantFeedEvents(ctx, arg)
}
