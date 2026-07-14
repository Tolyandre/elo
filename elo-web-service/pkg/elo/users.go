package elo

import (
	"context"
	"fmt"
	"strconv"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

type IUserService interface {
	GetUserByID(ctx context.Context, id string) (*db.User, error)
	CreateOrUpdateGoogleUser(ctx context.Context, googleOauthUserId string, googleOauthUserName string) (string, error)
	ListUsers(ctx context.Context) ([]db.User, error)
	AllowEditing(ctx context.Context, userID string, allow bool) error
	SetUserPlayer(ctx context.Context, userID string, playerID *string) error
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

// GetUserByID resolves a user from the JWT "sub" claim. It tries the UUID lookup
// first (the normal post-migration path). If the id isn't a valid UUID, it
// falls back to the legacy SERIAL int id (ADR-08), so old JWT tokens that still
// carry a bare int (e.g. "1") keep working until all tokens are rotated.
func (s *UserService) GetUserByID(ctx context.Context, id string) (*db.User, error) {
	// Fast path: the id is a UUID (the common case for current JWTs).
	if _, err := uuid.Parse(id); err == nil {
		user, err := s.Queries.GetUser(ctx, id)
		if err != nil {
			return nil, err
		}
		return &user, nil
	}

	// Fallback: the id is a bare int from a pre-migration JWT token.
	intID, err := strconv.ParseInt(id, 10, 32)
	if err != nil {
		// Not a UUID and not an int — return the original lookup error for a
		// meaningful "not found" rather than a misleading parse failure.
		_, _ = s.Queries.GetUser(ctx, id)
		return nil, fmt.Errorf("invalid user id %q", id)
	}
	user, err := s.Queries.GetUserByLegacyIntID(ctx, pgtype.Int4{Int32: int32(intID), Valid: true})
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (s *UserService) CreateOrUpdateGoogleUser(ctx context.Context, googleOauthUserId string, googleOauthUserName string) (string, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return "", err
	}

	defer tx.Rollback(ctx)
	q := s.Queries.WithTx(tx)

	user, err := q.GetUserByGoogleOAuthUserID(ctx, googleOauthUserId)

	if db.IsNoRows(err) {
		newID, err := uuid.NewV7()
		if err != nil {
			return "", fmt.Errorf("generate user id: %w", err)
		}
		userId, err := q.CreateUser(ctx, db.CreateUserParams{
			ID:                  newID.String(),
			AllowEditing:        false,
			GoogleOauthUserID:   googleOauthUserId,
			GoogleOauthUserName: googleOauthUserName,
		})

		if err != nil {
			return "", err
		}

		if err := tx.Commit(ctx); err != nil {
			return "", err
		}

		return userId, nil
	}

	if err != nil {
		return "", err
	}

	if user.GoogleOauthUserName != googleOauthUserName {
		err := q.UpdateUserName(ctx, db.UpdateUserNameParams{
			ID:                  user.ID,
			GoogleOauthUserName: googleOauthUserName,
		})

		if err != nil {
			return "", err
		}

		if err := tx.Commit(ctx); err != nil {
			return "", err
		}
		return user.ID, nil
	}

	return user.ID, nil
}

func (s *UserService) AllowEditing(ctx context.Context, userID string, allow bool) error {
	return s.Queries.UpdateUserAllowEditing(ctx, db.UpdateUserAllowEditingParams{
		ID:           userID,
		AllowEditing: allow,
	})
}

func (s *UserService) SetUserPlayer(ctx context.Context, userID string, playerID *string) error {
	err := s.Queries.UpdateUserPlayerID(ctx, db.UpdateUserPlayerIDParams{
		ID:       userID,
		PlayerID: playerID,
	})
	if err != nil {
		if db.IsUniqueViolation(err) {
			return fmt.Errorf("player already linked to another user")
		}
		return err
	}
	return nil
}
