package elo

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/audit"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// Openness settings of a tenant (ADR-36); the values live on the tenants
// table (tenants.go), listed here for the shared vocabulary.
const (
	// Which matches count into the tenant's main arena, evaluated at the
	// match date against membership history.
	ArenaMembershipAll         = "all"          // every rated match; membership irrelevant
	ArenaMembershipAnyMember   = "any_member"   // ≥1 participant was a member; guests accumulate rating and are listed
	ArenaMembershipMembersOnly = "members_only" // all participants were members; the arena lists current members only
	// Whether tournament registration is restricted to club members.
	TournamentOpennessMembersOnly = "members_only"
	TournamentOpennessOpen        = "open"
)

// IClubService is the club's grouping surface (ADR-05) plus the membership
// stint history (ADR-36). Everything community-shaped lives on the tenant
// (TenantService).
type IClubService interface {
	ListClubs(ctx context.Context) ([]db.ListClubsRow, error)
	GetClub(ctx context.Context, clubID id.ID) ([]db.GetClubRow, error)
	// CreateClub/UpdateClub/DeleteClub record audit events for the actor
	// (ADR-14); a zero actor skips the audit row. Icon updates and membership
	// changes are audited the same way (club-update events, ADR-36); their
	// no-ops (same icon, stint already open/closed) write no row.
	CreateClub(ctx context.Context, clubID id.ID, name string, actor id.ID) (db.Club, error)
	UpdateClub(ctx context.Context, clubID id.ID, name string, actor id.ID) (db.Club, error)
	// UpdateClubIcon sets (icon non-nil) or clears (icon nil) the club's icon key.
	UpdateClubIcon(ctx context.Context, clubID id.ID, icon *string, actor id.ID) (db.Club, error)
	DeleteClub(ctx context.Context, clubID id.ID, actor id.ID) (db.Club, error)
	AddMember(ctx context.Context, actor, clubID, playerID id.ID) error
	RemoveMember(ctx context.Context, actor, clubID, playerID id.ID) error
	// ListMemberHistory exposes the club's membership stint history (ADR-36) —
	// the raw material of tenant membership, shown as audit-style items on the
	// admin club page.
	ListMemberHistory(ctx context.Context, clubID id.ID) ([]db.ListClubMembershipHistoryRow, error)
}

type ClubService struct {
	Queries *db.Queries
	Pool    *pgxpool.Pool
}

func NewClubService(pool *pgxpool.Pool) IClubService {
	return &ClubService{
		Queries: db.New(pool),
		Pool:    pool,
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
			return recordAuditEvent(ctx, q, actor, audit.EntityClub, audit.ActionUpdated, clubID, audit.KindClubUpdate, audit.NewClubNameChange(old.Name, name))
		}
		return nil
	})
	return updated, err
}

func (s *ClubService) UpdateClubIcon(ctx context.Context, clubID id.ID, icon *string, actor id.ID) (db.Club, error) {
	iconText := pgtype.Text{}
	if icon != nil {
		iconText = pgtype.Text{String: *icon, Valid: true}
	}
	var updated db.Club
	err := runInTx(ctx, s.Pool, func(q *db.Queries) error {
		old, err := q.GetClubByID(ctx, clubID)
		if err != nil {
			return err
		}
		updated, err = q.UpdateClubIcon(ctx, db.UpdateClubIconParams{ID: clubID, Icon: iconText})
		if err != nil {
			return err
		}
		if textEqual(old.Icon, updated.Icon) {
			return nil
		}
		return recordAuditEvent(ctx, q, actor, audit.EntityClub, audit.ActionUpdated, clubID,
			audit.KindClubUpdate, audit.NewClubIconChange(textPtr(old.Icon), textPtr(updated.Icon)))
	})
	return updated, err
}

func (s *ClubService) DeleteClub(ctx context.Context, clubID id.ID, actor id.ID) (db.Club, error) {
	// DeleteClub returns the deleted row, so the audit event captures the name
	// without a pre-read.
	var deleted db.Club
	err := runInTx(ctx, s.Pool, func(q *db.Queries) error {
		// A club attached to a tenant is load-bearing: its members' stints
		// decide the tenant's arena attribution (ADR-36). The FK from
		// player_club_membership would often stop the delete anyway; this is
		// the readable error.
		if club, err := q.GetClubByID(ctx, clubID); err == nil && club.TenantID != nil {
			return ErrClubInTenantDeleteForbidden
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

// AddMember opens a membership stint and records the change in the audit log
// for the actor (ADR-14). A still-active stint for the same (club, player)
// makes this a no-op via the partial unique index — no audit row.
func (s *ClubService) AddMember(ctx context.Context, actor, clubID, playerID id.ID) error {
	return runInTx(ctx, s.Pool, func(q *db.Queries) error {
		if _, err := q.AddClubMember(ctx, db.AddClubMemberParams{ClubID: clubID, PlayerID: playerID}); err != nil {
			if db.IsNoRows(err) {
				return nil
			}
			return err
		}
		return recordAuditEvent(ctx, q, actor, audit.EntityClub, audit.ActionUpdated, clubID,
			audit.KindClubUpdate, audit.NewClubMemberChange([]string{string(playerID)}, nil))
	})
}

// RemoveMember closes the active stint and records the change in the audit
// log for the actor (ADR-14); removing a player without an active stint is a
// no-op with no audit row.
func (s *ClubService) RemoveMember(ctx context.Context, actor, clubID, playerID id.ID) error {
	return runInTx(ctx, s.Pool, func(q *db.Queries) error {
		if _, err := q.RemoveClubMember(ctx, db.RemoveClubMemberParams{ClubID: clubID, PlayerID: playerID}); err != nil {
			if db.IsNoRows(err) {
				return nil
			}
			return err
		}
		return recordAuditEvent(ctx, q, actor, audit.EntityClub, audit.ActionUpdated, clubID,
			audit.KindClubUpdate, audit.NewClubMemberChange(nil, []string{string(playerID)}))
	})
}

func (s *ClubService) ListMemberHistory(ctx context.Context, clubID id.ID) ([]db.ListClubMembershipHistoryRow, error) {
	return s.Queries.ListClubMembershipHistory(ctx, clubID)
}
