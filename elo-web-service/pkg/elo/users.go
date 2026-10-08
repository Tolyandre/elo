package elo

import (
	"context"
	"fmt"
	"strconv"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/audit"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

type IUserService interface {
	GetUserByID(ctx context.Context, userID id.ID) (*db.User, error)
	CreateOrUpdateGoogleUser(ctx context.Context, googleOauthUserId string, googleOauthUserName string) (id.ID, error)
	ListUsers(ctx context.Context) ([]db.User, error)
	// AllowEditing grants/revokes the edit permission and records the change
	// in the audit log for the actor (ADR-14); a zero actor records a NULL
	// actor. A no-op (the permission already has the requested value) writes
	// nothing.
	AllowEditing(ctx context.Context, actor, userID id.ID, allow bool) error
	SetUserPlayer(ctx context.Context, userID id.ID, playerID *id.ID) error
	// ListUserIDsByPlayerIDs resolves the controlling user of each linked
	// player; used to route per-user SSE events.
	ListUserIDsByPlayerIDs(ctx context.Context, playerIDs []id.ID) ([]db.ListUserIDsByPlayerIDsRow, error)
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

func (s *UserService) ListUserIDsByPlayerIDs(ctx context.Context, playerIDs []id.ID) ([]db.ListUserIDsByPlayerIDsRow, error) {
	return s.Queries.ListUserIDsByPlayerIDs(ctx, playerIDs)
}

// GetUserByID resolves a user from the JWT "sub" claim. It tries the UUID lookup
// first (the normal post-migration path). If the id isn't a valid UUID, it
// falls back to the legacy SERIAL int id (ADR-08), so old JWT tokens that still
// carry a bare int (e.g. "1") keep working until all tokens are rotated.
func (s *UserService) GetUserByID(ctx context.Context, userID id.ID) (*db.User, error) {
	// Fast path: the id is a UUID (the common case for current JWTs).
	if _, err := uuid.Parse(string(userID)); err == nil {
		user, err := s.Queries.GetUser(ctx, userID)
		if err != nil {
			return nil, err
		}
		return &user, nil
	}

	// Fallback: the id is a bare int from a pre-migration JWT token.
	intID, err := strconv.ParseInt(string(userID), 10, 32)
	if err != nil {
		// Not a UUID and not an int — return the original lookup error for a
		// meaningful "not found" rather than a misleading parse failure.
		_, _ = s.Queries.GetUser(ctx, userID)
		return nil, fmt.Errorf("invalid user id %q", userID)
	}
	user, err := s.Queries.GetUserByLegacyIntID(ctx, pgtype.Int4{Int32: int32(intID), Valid: true})
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (s *UserService) CreateOrUpdateGoogleUser(ctx context.Context, googleOauthUserId string, googleOauthUserName string) (id.ID, error) {
	return runInTxResult(ctx, s.Pool, func(q *db.Queries) (id.ID, error) {
		user, err := q.GetUserByGoogleOAuthUserID(ctx, googleOauthUserId)

		if db.IsNoRows(err) {
			return q.CreateUser(ctx, db.CreateUserParams{
				ID:                  id.New(),
				AllowEditing:        false,
				GoogleOauthUserID:   googleOauthUserId,
				GoogleOauthUserName: googleOauthUserName,
			})
		}
		if err != nil {
			return "", err
		}

		if user.GoogleOauthUserName != googleOauthUserName {
			if err := q.UpdateUserName(ctx, db.UpdateUserNameParams{
				ID:                  user.ID,
				GoogleOauthUserName: googleOauthUserName,
			}); err != nil {
				return "", err
			}
		}

		return user.ID, nil
	})
}

func (s *UserService) AllowEditing(ctx context.Context, actor, userID id.ID, allow bool) error {
	return runInTx(ctx, s.Pool, func(q *db.Queries) error {
		old, err := q.GetUser(ctx, userID)
		if err != nil {
			return err
		}
		if old.AllowEditing == allow {
			return nil
		}
		if err := q.UpdateUserAllowEditing(ctx, db.UpdateUserAllowEditingParams{
			ID:           userID,
			AllowEditing: allow,
		}); err != nil {
			return err
		}
		return recordAuditEvent(ctx, q, actor, audit.EntityUser, audit.ActionUpdated, userID,
			audit.KindUserUpdate, audit.NewUserUpdateDetails(old.AllowEditing, allow))
	})
}

func (s *UserService) SetUserPlayer(ctx context.Context, userID id.ID, playerID *id.ID) error {
	err := s.Queries.UpdateUserPlayerID(ctx, db.UpdateUserPlayerIDParams{
		ID:       userID,
		PlayerID: playerID,
	})
	if err != nil {
		if db.IsUniqueViolation(err) {
			return ErrPlayerAlreadyLinked
		}
		return err
	}
	return nil
}
