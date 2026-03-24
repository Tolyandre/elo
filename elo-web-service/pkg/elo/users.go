package elo

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/db"
)


type IUserService interface {
	GetUserByID(ctx context.Context, id int32) (*db.User, error)
	CreateOrUpdateGoogleUser(ctx context.Context, googleOauthUserId string, googleOauthUserName string) (int32, error)
	ListUsers(ctx context.Context) ([]db.User, error)
	AllowEditing(ctx context.Context, userID int32, allow bool) error
	SetUserPlayer(ctx context.Context, userID int32, playerID *int32) error
}

type UserService struct {
	Queries *db.Queries
	Pool    *pgxpool.Pool
}

func NewUserService(pool *pgxpool.Pool) IUserService {
	return &UserService{
		Queries: db.New(pool),
		Pool:    pool,
	}
}

func (s *UserService) ListUsers(ctx context.Context) ([]db.User, error) {
	users, err := s.Queries.ListUsers(ctx)
	if err != nil {
		return nil, err
	}

	return users, nil
}

func (s *UserService) GetUserByID(ctx context.Context, id int32) (*db.User, error) {
	user, err := s.Queries.GetUser(ctx, id)
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (s *UserService) CreateOrUpdateGoogleUser(ctx context.Context, googleOauthUserId string, googleOauthUserName string) (int32, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return 0, err

	}

	defer tx.Rollback(ctx)
	q := s.Queries.WithTx(tx)

	user, err := q.GetUserByGoogleOAuthUserID(ctx, googleOauthUserId)

	if db.IsNoRows(err) {
		userId, err := q.CreateUser(ctx, db.CreateUserParams{
			AllowEditing:        false,
			GoogleOauthUserID:   googleOauthUserId,
			GoogleOauthUserName: googleOauthUserName,
		})

		if err != nil {
			return 0, err
		}

		if err := tx.Commit(ctx); err != nil {
			return 0, err
		}

		return userId, nil
	}

	if err != nil {
		return 0, err
	}

	if user.GoogleOauthUserName != googleOauthUserName {
		err := q.UpdateUserName(ctx, db.UpdateUserNameParams{
			ID:                  user.ID,
			GoogleOauthUserName: googleOauthUserName,
		})

		if err != nil {
			return 0, err
		}

		if err := tx.Commit(ctx); err != nil {
			return 0, err
		}
		return user.ID, nil
	}

	return user.ID, nil
}

func (s *UserService) AllowEditing(ctx context.Context, userID int32, allow bool) error {
	return s.Queries.UpdateUserAllowEditing(ctx, db.UpdateUserAllowEditingParams{
		ID:           userID,
		AllowEditing: allow,
	})
}

func (s *UserService) SetUserPlayer(ctx context.Context, userID int32, playerID *int32) error {
	var pid pgtype.Int4
	if playerID != nil {
		pid = pgtype.Int4{Int32: *playerID, Valid: true}
	}
	err := s.Queries.UpdateUserPlayerID(ctx, db.UpdateUserPlayerIDParams{
		ID:       userID,
		PlayerID: pid,
	})
	if err != nil {
		if db.IsUniqueViolation(err) {
			return fmt.Errorf("player already linked to another user")
		}
		return err
	}
	return nil
}
