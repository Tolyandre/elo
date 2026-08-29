package elo

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/audit"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
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
		var derr error
		deleted, derr = q.DeleteClub(ctx, clubID)
		if derr != nil {
			return derr
		}
		return recordAuditEvent(ctx, q, actor, audit.EntityClub, audit.ActionDeleted, clubID, audit.KindEntity, audit.NewEntityDetails(deleted.Name))
	})
	return deleted, err
}

func (s *ClubService) AddMember(ctx context.Context, clubID, playerID id.ID) error {
	return s.Queries.AddClubMember(ctx, db.AddClubMemberParams{ClubID: clubID, PlayerID: playerID})
}

func (s *ClubService) RemoveMember(ctx context.Context, clubID, playerID id.ID) error {
	return s.Queries.RemoveClubMember(ctx, db.RemoveClubMemberParams{ClubID: clubID, PlayerID: playerID})
}
