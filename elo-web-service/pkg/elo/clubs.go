package elo

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

type IClubService interface {
	ListClubs(ctx context.Context) ([]db.ListClubsRow, error)
	GetClub(ctx context.Context, clubID id.ID) ([]db.GetClubRow, error)
	CreateClub(ctx context.Context, clubID id.ID, name string) (db.Club, error)
	UpdateClub(ctx context.Context, clubID id.ID, name string) (db.Club, error)
	// UpdateClubIcon sets (icon non-nil) or clears (icon nil) the club's icon key.
	UpdateClubIcon(ctx context.Context, clubID id.ID, icon *string) (db.Club, error)
	DeleteClub(ctx context.Context, clubID id.ID) (db.Club, error)
	AddMember(ctx context.Context, clubID, playerID id.ID) error
	RemoveMember(ctx context.Context, clubID, playerID id.ID) error
}

type ClubService struct {
	Queries *db.Queries
}

func NewClubService(pool *pgxpool.Pool) IClubService {
	return &ClubService{Queries: db.New(pool)}
}

func (s *ClubService) ListClubs(ctx context.Context) ([]db.ListClubsRow, error) {
	return s.Queries.ListClubs(ctx)
}

func (s *ClubService) GetClub(ctx context.Context, clubID id.ID) ([]db.GetClubRow, error) {
	return s.Queries.GetClub(ctx, clubID)
}

func (s *ClubService) CreateClub(ctx context.Context, clubID id.ID, name string) (db.Club, error) {
	return s.Queries.CreateClub(ctx, db.CreateClubParams{ID: clubID, Name: name})
}

func (s *ClubService) UpdateClub(ctx context.Context, clubID id.ID, name string) (db.Club, error) {
	return s.Queries.UpdateClubName(ctx, db.UpdateClubNameParams{ID: clubID, Name: name})
}

func (s *ClubService) UpdateClubIcon(ctx context.Context, clubID id.ID, icon *string) (db.Club, error) {
	iconText := pgtype.Text{}
	if icon != nil {
		iconText = pgtype.Text{String: *icon, Valid: true}
	}
	return s.Queries.UpdateClubIcon(ctx, db.UpdateClubIconParams{ID: clubID, Icon: iconText})
}

func (s *ClubService) DeleteClub(ctx context.Context, clubID id.ID) (db.Club, error) {
	return s.Queries.DeleteClub(ctx, clubID)
}

func (s *ClubService) AddMember(ctx context.Context, clubID, playerID id.ID) error {
	return s.Queries.AddClubMember(ctx, db.AddClubMemberParams{ClubID: clubID, PlayerID: playerID})
}

func (s *ClubService) RemoveMember(ctx context.Context, clubID, playerID id.ID) error {
	return s.Queries.RemoveClubMember(ctx, db.RemoveClubMemberParams{ClubID: clubID, PlayerID: playerID})
}
