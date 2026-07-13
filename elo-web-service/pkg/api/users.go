package api

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/tolyandre/elo-web-service/pkg/db"
	elo "github.com/tolyandre/elo-web-service/pkg/elo"
)

const CurrentUserKey = "currentUser"

func MustGetCurrentUserId(ctx *gin.Context) (string, error) {
	userID := ctx.MustGet(CurrentUserKey)

	id, ok := userID.(string)
	if !ok {
		err := fmt.Errorf("invalid user id in context: %v", userID)
		ErrorResponse(ctx, http.StatusInternalServerError, err)
		return "", err
	}

	return id, nil
}

func MustGetCurrentUser(ctx *gin.Context, userService elo.IUserService) (*db.User, error) {
	userID := ctx.MustGet(CurrentUserKey)

	id, ok := userID.(string)
	if !ok {
		return nil, fmt.Errorf("invalid user id in context: %v", userID)
	}

	user, err := userService.GetUserByID(ctx, id)

	if db.IsNoRows(err) {
		return nil, fmt.Errorf("user not found: %w", err)
	}

	if err != nil {
		return nil, err
	}

	return user, nil
}

const CurrentPlayerIDKey = "currentPlayerID"

// RequirePlayerID is a Gin middleware that aborts with 403 if the authenticated
// user has no player_id linked. On success it sets CurrentPlayerIDKey in context.
func (a *API) RequirePlayerID() gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := MustGetCurrentUser(c, a.UserService)
		if err != nil {
			ErrorResponse(c, http.StatusUnauthorized, "authentication required")
			c.Abort()
			return
		}
		if user.PlayerID == nil {
			ErrorResponse(c, http.StatusForbidden, "player association required to use game tables")
			c.Abort()
			return
		}
		c.Set(CurrentPlayerIDKey, *user.PlayerID)
		c.Next()
	}
}

// MustGetCurrentPlayerID retrieves the player ID set by RequirePlayerID middleware.
func MustGetCurrentPlayerID(c *gin.Context) string {
	return c.MustGet(CurrentPlayerIDKey).(string)
}

// RequireEditor is a Gin middleware that aborts with 403 if the authenticated
// user does not have AllowEditing permission.
func (a *API) RequireEditor() gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := MustGetCurrentUser(c, a.UserService)
		if err != nil {
			ErrorResponse(c, http.StatusInternalServerError, err)
			c.Abort()
			return
		}
		if !user.AllowEditing {
			ErrorResponse(c, http.StatusForbidden, "You are not authorized to perform this action")
			c.Abort()
			return
		}
		c.Next()
	}
}

type userJson struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	CanEdit bool   `json:"can_edit"`
}

func (a *API) ListUsers(c *gin.Context) {
	users, err := a.UserService.ListUsers(c)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	out := make([]userJson, 0, len(users))
	for _, u := range users {
		out = append(out, userJson{
			ID:      u.ID,
			Name:    u.GoogleOauthUserName,
			CanEdit: u.AllowEditing,
		})
	}

	SuccessDataResponse(c, out)
}

func (a *API) PatchUser(c *gin.Context) {
	userId := c.Param("userId")

	var body struct {
		CanEdit bool `json:"can_edit"`
	}

	if err := c.BindJSON(&body); err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}

	if err := a.UserService.AllowEditing(c, userId, body.CanEdit); err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	user, err := a.UserService.GetUserByID(c, userId)
	if db.IsNoRows(err) {
		ErrorResponse(c, http.StatusNotFound, fmt.Errorf("user not found: %w", err))
		return
	}
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	resp := userJson{
		ID:      user.ID,
		Name:    user.GoogleOauthUserName,
		CanEdit: user.AllowEditing,
	}

	SuccessDataResponse(c, resp)
}
