package elo

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

type IClubService interface {
	ListClubs(ctx context.Context) ([]db.ListClubsRow, error)
	GetClub(ctx context.Context, id string) ([]db.GetClubRow, error)
	CreateClub(ctx context.Context, id, name string) (db.Club, error)
	UpdateClub(ctx context.Context, id string, name string) (db.Club, error)
	// UpdateClubIcon sets (iconSvg non-nil) or clears (iconSvg nil) the club icon.
	UpdateClubIcon(ctx context.Context, id string, iconSvg *string) (db.Club, error)
	DeleteClub(ctx context.Context, id string) (db.Club, error)
	AddMember(ctx context.Context, clubID, playerID string) error
	RemoveMember(ctx context.Context, clubID, playerID string) error
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

func (s *ClubService) GetClub(ctx context.Context, id string) ([]db.GetClubRow, error) {
	return s.Queries.GetClub(ctx, id)
}

func (s *ClubService) CreateClub(ctx context.Context, id, name string) (db.Club, error) {
	return s.Queries.CreateClub(ctx, db.CreateClubParams{ID: id, Name: name})
}

func (s *ClubService) UpdateClub(ctx context.Context, id string, name string) (db.Club, error) {
	return s.Queries.UpdateClubName(ctx, db.UpdateClubNameParams{ID: id, Name: name})
}

func (s *ClubService) UpdateClubIcon(ctx context.Context, id string, iconSvg *string) (db.Club, error) {
	icon := pgtype.Text{}
	if iconSvg != nil {
		icon = pgtype.Text{String: *iconSvg, Valid: true}
	}
	return s.Queries.UpdateClubIcon(ctx, db.UpdateClubIconParams{ID: id, IconSvg: icon})
}

func (s *ClubService) DeleteClub(ctx context.Context, id string) (db.Club, error) {
	return s.Queries.DeleteClub(ctx, id)
}

func (s *ClubService) AddMember(ctx context.Context, clubID, playerID string) error {
	return s.Queries.AddClubMember(ctx, db.AddClubMemberParams{ClubID: clubID, PlayerID: playerID})
}

func (s *ClubService) RemoveMember(ctx context.Context, clubID, playerID string) error {
	return s.Queries.RemoveClubMember(ctx, db.RemoveClubMemberParams{ClubID: clubID, PlayerID: playerID})
}
