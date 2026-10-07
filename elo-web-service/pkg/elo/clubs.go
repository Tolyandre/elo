package elo

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/audit"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// Club kinds and tenant openness settings (ADR-36).
const (
	ClubKindGroup  = "group"
	ClubKindTenant = "tenant"

	// Which matches count into the tenant's main arena, evaluated at the
	// match date against membership history.
	ArenaMembershipAnyMember   = "any_member"   // ≥1 participant was a member; guests accumulate rating and are listed
	ArenaMembershipMembersOnly = "members_only" // all participants were members; the arena lists current members only
	// Whether tournament registration is restricted to club members.
	TournamentOpennessMembersOnly = "members_only"
	TournamentOpennessOpen        = "open"
)

type IClubService interface {
	ListClubs(ctx context.Context) ([]db.ListClubsRow, error)
	GetClub(ctx context.Context, clubID id.ID) ([]db.GetClubRow, error)
	// CreateClub/UpdateClub/DeleteClub record audit events for the actor
	// (ADR-14); a zero actor skips the audit row. Icon updates and membership
	// changes are not audited.
	CreateClub(ctx context.Context, clubID id.ID, name string, actor id.ID) (db.Club, error)
	UpdateClub(ctx context.Context, clubID id.ID, name string, actor id.ID) (db.Club, error)
	// UpdateClubIcon sets (icon non-nil) or clears (icon nil) the club's icon key.
	UpdateClubIcon(ctx context.Context, clubID id.ID, icon *string) (db.Club, error)
	DeleteClub(ctx context.Context, clubID id.ID, actor id.ID) (db.Club, error)
	AddMember(ctx context.Context, clubID, playerID id.ID) error
	RemoveMember(ctx context.Context, clubID, playerID id.ID) error
	// ConvertToTenant performs the one-way group → tenant conversion (ADR-36):
	// kind + openness settings, and the main arena created in the same
	// transaction.
	ConvertToTenant(ctx context.Context, clubID id.ID, arenaMembershipMode, tournamentsOpenness string, actor id.ID) (db.Club, error)
	// UpdateTenantSettings changes the openness settings of an existing tenant.
	UpdateTenantSettings(ctx context.Context, clubID id.ID, arenaMembershipMode, tournamentsOpenness string, actor id.ID) (db.Club, error)
}

type ClubService struct {
	Queries *db.Queries
	Pool    *pgxpool.Pool
	Arenas  *ArenaService
	// GlobalReplay runs the full global-arena settlement replay inside an open
	// transaction (ADR-36): a main-arena openness change on the converted
	// global arena re-settles the whole history right in the settings
	// transaction — the global arena is never drained by the background worker.
	GlobalReplay IGlobalReplay
}

func NewClubService(pool *pgxpool.Pool, arenas *ArenaService, globalReplay IGlobalReplay) IClubService {
	return &ClubService{
		Queries:      db.New(pool),
		Pool:         pool,
		Arenas:       arenas,
		GlobalReplay: globalReplay,
	}
}

func (s *ClubService) ListClubs(ctx context.Context) ([]db.ListClubsRow, error) {
	return s.Queries.ListClubs(ctx)
}

func (s *ClubService) GetClub(ctx context.Context, clubID id.ID) ([]db.GetClubRow, error) {
	return s.Queries.GetClub(ctx, clubID)
}

func (s *ClubService) CreateClub(ctx context.Context, clubID id.ID, name string, actor id.ID) (db.Club, error) {
	var created db.Club
	err := runInTx(ctx, s.Pool, func(q *db.Queries) error {
		// CreateClub conflicts on id (idempotent replay) or on name (a
		// different club already owns it). Audit only genuinely new rows. A
		// zero id cannot exist yet — skip the probe and let CreateClub surface
		// the error.
		isNew := true
		if !clubID.IsZero() {
			_, perr := q.GetClubByID(ctx, clubID)
			isNew = db.IsNoRows(perr)
			if perr != nil && !isNew {
				return perr
			}
		}
		var err error
		created, err = q.CreateClub(ctx, db.CreateClubParams{ID: clubID, Name: name})
		if err != nil {
			return err
		}
		if isNew {
			return recordAuditEvent(ctx, q, actor, audit.EntityClub, audit.ActionCreated, clubID, audit.KindEntity, audit.NewEntityDetails(name))
		}
		return nil
	})
	return created, err
}

func (s *ClubService) UpdateClub(ctx context.Context, clubID id.ID, name string, actor id.ID) (db.Club, error) {
	var updated db.Club
	err := runInTx(ctx, s.Pool, func(q *db.Queries) error {
		old, err := q.GetClubByID(ctx, clubID)
		if err != nil {
			return err
		}
		updated, err = q.UpdateClubName(ctx, db.UpdateClubNameParams{ID: clubID, Name: name})
		if err != nil {
			return err
		}
		if old.Name != name {
			return recordAuditEvent(ctx, q, actor, audit.EntityClub, audit.ActionRenamed, clubID, audit.KindRename, audit.NewRenameDetails(old.Name, name))
		}
		return nil
	})
	return updated, err
}

func (s *ClubService) UpdateClubIcon(ctx context.Context, clubID id.ID, icon *string) (db.Club, error) {
	iconText := pgtype.Text{}
	if icon != nil {
		iconText = pgtype.Text{String: *icon, Valid: true}
	}
	return s.Queries.UpdateClubIcon(ctx, db.UpdateClubIconParams{ID: clubID, Icon: iconText})
}

func (s *ClubService) DeleteClub(ctx context.Context, clubID id.ID, actor id.ID) (db.Club, error) {
	// DeleteClub returns the deleted row, so the audit event captures the name
	// without a pre-read.
	var deleted db.Club
	err := runInTx(ctx, s.Pool, func(q *db.Queries) error {
		// A tenant club is load-bearing: it owns the main arena and the
		// community's rating (ADR-36). The FK from arenas would stop the
		// delete anyway; this is the readable error.
		if club, err := q.GetClubByID(ctx, clubID); err == nil && club.Kind == ClubKindTenant {
			return ErrTenantClubDeleteForbidden
		} else if err != nil && !db.IsNoRows(err) {
			return err
		}
		var derr error
		deleted, derr = q.DeleteClub(ctx, clubID)
		if derr != nil {
			return derr
		}
		return recordAuditEvent(ctx, q, actor, audit.EntityClub, audit.ActionDeleted, clubID, audit.KindEntity, audit.NewEntityDetails(deleted.Name))
	})
	return deleted, err
}

// validateTenantSettings checks the openness settings pair (ADR-36); both are
// always set together for a tenant, both cleared for a group.
func validateTenantSettings(arenaMembershipMode, tournamentsOpenness string) error {
	switch arenaMembershipMode {
	case ArenaMembershipAnyMember, ArenaMembershipMembersOnly:
	default:
		return ErrClubTenantSettingsInvalid
	}
	switch tournamentsOpenness {
	case TournamentOpennessMembersOnly, TournamentOpennessOpen:
	default:
		return ErrClubTenantSettingsInvalid
	}
	return nil
}

func tenantSettingsText(arenaMembershipMode, tournamentsOpenness string) (pgtype.Text, pgtype.Text) {
	return pgtype.Text{String: arenaMembershipMode, Valid: true},
		pgtype.Text{String: tournamentsOpenness, Valid: true}
}

// ConvertToTenant performs the one-way group → tenant conversion (ADR-36):
// kind + openness settings, and the main arena ensured in the same
// transaction (a fresh tenant arena starts stale and is filled by the
// background updater; the converted global arena of «Синие люди» already
// exists and is left untouched). Audit-recorded as a club update.
func (s *ClubService) ConvertToTenant(ctx context.Context, clubID id.ID, arenaMembershipMode, tournamentsOpenness string, actor id.ID) (db.Club, error) {
	if err := validateTenantSettings(arenaMembershipMode, tournamentsOpenness); err != nil {
		return db.Club{}, err
	}
	var converted db.Club
	err := runInTx(ctx, s.Pool, func(q *db.Queries) error {
		old, err := q.GetClubByID(ctx, clubID)
		if err != nil {
			return err
		}
		modeArg, opennessArg := tenantSettingsText(arenaMembershipMode, tournamentsOpenness)
		converted, err = q.ConvertClubToTenant(ctx, db.ConvertClubToTenantParams{
			ID:                  clubID,
			ArenaMembershipMode: modeArg,
			TournamentsOpenness: opennessArg,
		})
		if db.IsNoRows(err) {
			return ErrClubAlreadyTenant
		}
		if err != nil {
			return err
		}
		if err := s.Arenas.EnsureClubArena(ctx, q, clubID, old.Name); err != nil {
			return err
		}
		return recordAuditEvent(ctx, q, actor, audit.EntityClub, audit.ActionUpdated, clubID, audit.KindEntity, audit.NewEntityDetails(old.Name))
	})
	return converted, err
}

// UpdateTenantSettings changes the openness settings of an existing tenant
// (ADR-36). An arena_membership_mode change re-interprets the main arena's
// whole history (the mode is a current setting applied over all history), so
// the arena is recalculated in the same transaction: the converted global
// arena via the full in-transaction replay, any fresh tenant arena via a
// full stale mark picked up by the background updater.
func (s *ClubService) UpdateTenantSettings(ctx context.Context, clubID id.ID, arenaMembershipMode, tournamentsOpenness string, actor id.ID) (db.Club, error) {
	if err := validateTenantSettings(arenaMembershipMode, tournamentsOpenness); err != nil {
		return db.Club{}, err
	}
	var updated db.Club
	err := runInTx(ctx, s.Pool, func(q *db.Queries) error {
		old, err := q.GetClubByID(ctx, clubID)
		if err != nil {
			return err
		}
		modeArg, opennessArg := tenantSettingsText(arenaMembershipMode, tournamentsOpenness)
		row, err := q.UpdateClubTenantSettings(ctx, db.UpdateClubTenantSettingsParams{
			ID:                  clubID,
			ArenaMembershipMode: modeArg,
			TournamentsOpenness: opennessArg,
		})
		if db.IsNoRows(err) {
			return ErrClubNotTenant
		}
		if err != nil {
			return err
		}
		if old.ArenaMembershipMode.String != arenaMembershipMode {
			if err := s.recalculateMainArenaForModeChange(ctx, q, clubID); err != nil {
				return err
			}
		}
		updated = row
		return recordAuditEvent(ctx, q, actor, audit.EntityClub, audit.ActionUpdated, clubID, audit.KindEntity, audit.NewEntityDetails(row.Name))
	})
	return updated, err
}

// recalculateMainArenaForModeChange re-settles the club's main arena from
// scratch after its arena_membership_mode changed (ADR-36).
func (s *ClubService) recalculateMainArenaForModeChange(ctx context.Context, q *db.Queries, clubID id.ID) error {
	arena, err := q.GetArenaByClub(ctx, &clubID)
	if db.IsNoRows(err) {
		// A tenant always has a main arena; nothing to re-settle otherwise.
		return nil
	}
	if err != nil {
		return err
	}
	if arena.ID == GlobalArenaID {
		// The global arena is never drained by the background worker (its
		// market/correction settlements would be lost by a match-only
		// replay) — run the full replay right here, in this transaction.
		return s.GlobalReplay.RecalculateGlobalWithinTx(ctx, q, time.Time{})
	}
	return q.MarkArenasStaleFull(ctx, []id.ID{arena.ID})
}

func (s *ClubService) AddMember(ctx context.Context, clubID, playerID id.ID) error {
	return s.Queries.AddClubMember(ctx, db.AddClubMemberParams{ClubID: clubID, PlayerID: playerID})
}

func (s *ClubService) RemoveMember(ctx context.Context, clubID, playerID id.ID) error {
	return s.Queries.RemoveClubMember(ctx, db.RemoveClubMemberParams{ClubID: clubID, PlayerID: playerID})
}
