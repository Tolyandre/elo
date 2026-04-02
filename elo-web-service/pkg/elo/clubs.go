package elo

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

type IClubService interface {
	ListClubs(ctx context.Context) ([]db.ListClubsRow, error)
	GetClub(ctx context.Context, id int32) ([]db.GetClubRow, error)
	CreateClub(ctx context.Context, name string) (db.Club, error)
	UpdateClub(ctx context.Context, id int32, name string) (db.Club, error)
	DeleteClub(ctx context.Context, id int32) (db.Club, error)
	AddMember(ctx context.Context, clubID, playerID int32) error
	RemoveMember(ctx context.Context, clubID, playerID int32) error
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

func (s *ClubService) GetClub(ctx context.Context, id int32) ([]db.GetClubRow, error) {
	return s.Queries.GetClub(ctx, id)
}

func (s *ClubService) CreateClub(ctx context.Context, name string) (db.Club, error) {
	return s.Queries.CreateClub(ctx, name)
}

func (s *ClubService) UpdateClub(ctx context.Context, id int32, name string) (db.Club, error) {
	return s.Queries.UpdateClubName(ctx, db.UpdateClubNameParams{ID: id, Name: name})
}

func (s *ClubService) DeleteClub(ctx context.Context, id int32) (db.Club, error) {
	return s.Queries.DeleteClub(ctx, id)
}

func (s *ClubService) AddMember(ctx context.Context, clubID, playerID int32) error {
	return s.Queries.AddClubMember(ctx, db.AddClubMemberParams{ClubID: clubID, PlayerID: playerID})
}

func (s *ClubService) RemoveMember(ctx context.Context, clubID, playerID int32) error {
	return s.Queries.RemoveClubMember(ctx, db.RemoveClubMemberParams{ClubID: clubID, PlayerID: playerID})
}
