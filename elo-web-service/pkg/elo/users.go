package elo

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

type IUserService interface {
	GetUserByID(ctx context.Context, id int32) (*db.User, error)
	CreateOrUpdateGoogleUser(ctx context.Context, googleOauthUserId string, googleOauthUserName string) (int32, error)
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

	if db.NotFound(err) {
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
