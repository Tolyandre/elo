package elo

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"

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
	// UpdateTenantIcon sets or clears the tenant's icon (an empty string
	// clears; the key is validated at the handler, ADR-36).
	UpdateTenantIcon(ctx context.Context, tenantID id.ID, icon string, actor id.ID) (db.Tenant, error)
	// UpdateTenantSettings changes the openness settings. An
	// arena_membership_mode change re-interprets the main arena's whole
	// history, so the arena is queued for a full recalculation (background
	// worker, ADR-36 phase 6).
	UpdateTenantSettings(ctx context.Context, tenantID id.ID, arenaMembershipMode, tournamentsOpenness string, actor id.ID) (db.Tenant, error)
	// UpdateTenantClubs replaces the club composition wholesale. Composition
	// changes who is a member, so a change queues the main arena for a full
	// recalculation.
	UpdateTenantClubs(ctx context.Context, tenantID id.ID, clubIDs []id.ID, actor id.ID) error
	// UpdateTenantArenaSettings replaces the main arena's settings document
	// (starting rating and leagues, ADR-24 shape) through the tenant (ADR-36
	// phase 5): main arenas are system-managed, arena PATCH on them is a 409.
	// A settings change re-derives every rating from the settlement history,
	// so the arena is queued for a full recalculation.
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
	// Hub is nil-safe: a change that queues the main arena for a
	// recalculation publishes arenas-changed so open views show the spinner
	// and refresh when the background drain lands (ADR-36 phase 6).
	Hub *Hub
}

func NewTenantService(pool *pgxpool.Pool, arenas *ArenaService, hub *Hub) *TenantService {
	return &TenantService{
		Queries: db.New(pool),
		Pool:    pool,
		Arenas:  arenas,
		Hub:     hub,
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
		// arena starts stale and is filled by the background updater;
		// «Синие люди»'s converted arena already exists and is left
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

// UpdateTenantIcon sets or clears the tenant's icon (an empty string clears;
// the handler validates the key). Audit-recorded as a tenant update with the
// icon diff.
func (s *TenantService) UpdateTenantIcon(ctx context.Context, tenantID id.ID, icon string, actor id.ID) (db.Tenant, error) {
	var updated db.Tenant
	err := runInTx(ctx, s.Pool, func(q *db.Queries) error {
		old, err := q.GetTenantByID(ctx, tenantID)
		if err != nil {
			return err
		}
		row, err := q.UpdateTenantIcon(ctx, db.UpdateTenantIconParams{ID: tenantID, Icon: icon})
		if err != nil {
			return err
		}
		updated = row
		details := audit.NewTenantUpdateDetails()
		setIconDiff(&details, old.Icon, icon)
		return recordTenantUpdate(ctx, q, actor, tenantID, details, row.Name)
	})
	return updated, err
}

// UpdateTenantSettings changes the openness settings of an existing tenant
// (ADR-36). An arena_membership_mode change re-interprets the main arena's
// whole history (the mode is a current setting applied over all history), so
// the arena is queued for a full recalculation — the worker replays the match
// rows and re-chains every market settlement against the new history
// (ADR-36 phase 6: settings save and history replay are decoupled).
func (s *TenantService) UpdateTenantSettings(ctx context.Context, tenantID id.ID, arenaMembershipMode, tournamentsOpenness string, actor id.ID) (db.Tenant, error) {
	if err := validateTenantSettings(arenaMembershipMode, tournamentsOpenness); err != nil {
		return db.Tenant{}, err
	}
	var updated db.Tenant
	recalcQueued := false
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
			queued, err := s.markMainArenaForRecalc(ctx, q, tenantID)
			if err != nil {
				return err
			}
			recalcQueued = queued
		}
		updated = row
		details := audit.NewTenantUpdateDetails()
		setModeDiff(&details, old.ArenaMembershipMode, arenaMembershipMode)
		setOpennessDiff(&details, old.TournamentsOpenness, tournamentsOpenness)
		return recordTenantUpdate(ctx, q, actor, tenantID, details, row.Name)
	})
	if err == nil && recalcQueued {
		s.publishArenasChanged()
	}
	return updated, err
}

// UpdateTenantClubs replaces the club composition wholesale (ADR-36). The
// change alters who is a member — and through it the main arena's history
// interpretation — so a real change queues the arena for a full
// recalculation. Audit-recorded as a tenant update.
func (s *TenantService) UpdateTenantClubs(ctx context.Context, tenantID id.ID, clubIDs []id.ID, actor id.ID) error {
	recalcQueued := false
	err := runInTx(ctx, s.Pool, func(q *db.Queries) error {
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
			queued, err := s.markMainArenaForRecalc(ctx, q, tenantID)
			if err != nil {
				return err
			}
			recalcQueued = queued
			details := audit.NewTenantUpdateDetails()
			setClubsDiff(&details, before, after)
			return recordTenantUpdate(ctx, q, actor, tenantID, details, tenant.Name)
		}
		// No composition change: still an audit row (the PUT happened), but
		// with no diff to show — the plain entity shape.
		return recordAuditEvent(ctx, q, actor, audit.EntityTenant, audit.ActionUpdated, tenantID, audit.KindEntity, audit.NewEntityDetails(tenant.Name))
	})
	if err == nil && recalcQueued {
		s.publishArenasChanged()
	}
	return err
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
// rating from the settlement history, so the arena is queued for a full
// recalculation: the worker replays it against the freshly committed
// settings document (ADR-36 phase 6 — decoupling the save from the replay is
// also what makes the replay see the new starting rating at all).
func (s *TenantService) UpdateTenantArenaSettings(ctx context.Context, tenantID id.ID, settingsRaw json.RawMessage, actor id.ID) (db.Tenant, error) {
	settings, err := validateSettings(settingsRaw)
	if err != nil {
		return db.Tenant{}, err
	}
	var updated db.Tenant
	recalcQueued := false
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
		changed := !settingsEqual(current.Settings, settings)
		if changed {
			queued, err := s.markMainArenaForRecalc(ctx, q, tenantID)
			if err != nil {
				return err
			}
			recalcQueued = queued
		}
		tenant, err := q.GetTenantByID(ctx, tenantID)
		if err != nil {
			return err
		}
		updated = tenant
		details := audit.NewTenantUpdateDetails()
		setSettingsDiff(&details, current.Settings, settings)
		return recordTenantUpdate(ctx, q, actor, tenantID, details, tenant.Name)
	})
	if err == nil && recalcQueued {
		s.publishArenasChanged()
	}
	return updated, err
}

// settingsEqual compares two parsed arena settings documents.
func settingsEqual(a, b arenasettings.Settings) bool {
	return a.StartingRating == b.StartingRating && slices.EqualFunc(a.Leagues, b.Leagues, func(x, y arenasettings.League) bool {
		return x.Kind == y.Kind && x.GoalGap == y.GoalGap && x.EarnedMin == y.EarnedMin && x.EarnedMax == y.EarnedMax &&
			x.Tau == y.Tau && x.Matches6M == y.Matches6M && x.Matches2M == y.Matches2M
	})
}

// markMainArenaForRecalc queues the tenant's main arena for a full
// recalculation by the background worker (ADR-36 phase 6): the save
// transaction only writes the stale mark, the worker replays the arena's
// match rows and re-chains the market ledger against the committed state.
// Reports whether a mark was actually set (a tenant always has a main arena;
// nothing to re-settle otherwise).
func (s *TenantService) markMainArenaForRecalc(ctx context.Context, q *db.Queries, tenantID id.ID) (bool, error) {
	row, err := q.GetArenaByTenant(ctx, &tenantID)
	if db.IsNoRows(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if err := q.MarkArenasStaleFull(ctx, []id.ID{row.ID}); err != nil {
		return false, fmt.Errorf("mark main arena stale: %w", err)
	}
	return true, nil
}

// publishArenasChanged nudges open arena views after the transaction
// committed: they refetch the arena (the stale mark shows the spinner) and
// refresh again when the drain lands.
func (s *TenantService) publishArenasChanged() {
	if s.Hub != nil {
		s.Hub.PublishSignal(TopicData, "arenas-changed")
	}
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
