package api

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/tolyandre/elo-web-service/pkg/db"
	elo "github.com/tolyandre/elo-web-service/pkg/elo"
)

const CurrentUserKey = "currentUser"

func MustGetCurrentUserId(ctx *gin.Context) (int32, error) {
	userID := ctx.MustGet(CurrentUserKey)

	userIdInt, err := strconv.Atoi(userID.(string))
	if err != nil {
		ErrorResponse(ctx, http.StatusInternalServerError, fmt.Errorf("invalid user id in context: %w", err))
		return 0, err
	}

	return int32(userIdInt), nil
}

func MustGetCurrentUser(ctx *gin.Context, userService elo.IUserService) (*db.User, error) {
	userID := ctx.MustGet(CurrentUserKey)

	userIdInt, err := strconv.Atoi(userID.(string))
	if err != nil {
		return nil, fmt.Errorf("invalid user id in context: %w", err)
	}

	user, err := userService.GetUserByID(ctx, int32(userIdInt))

	if db.IsNoRows(err) {
		return nil, fmt.Errorf("user not found: %w", err)
	}

	if err != nil {
		return nil, err
	}

	return user, nil
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
			ID:      strconv.Itoa(int(u.ID)),
			Name:    u.GoogleOauthUserName,
			CanEdit: u.AllowEditing,
		})
	}

	SuccessDataResponse(c, out)
}

func (a *API) PatchUser(c *gin.Context) {
	currentUser, err := MustGetCurrentUser(c, a.UserService)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	if !currentUser.AllowEditing {
		ErrorResponse(c, http.StatusForbidden, fmt.Errorf("You are not authorized to edit users"))
		return
	}

	userIdStr := c.Param("userId")
	userIdInt, err := strconv.Atoi(userIdStr)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, fmt.Errorf("invalid user id: %w", err))
		return
	}

	var body struct {
		CanEdit bool `json:"can_edit"`
	}

	if err := c.BindJSON(&body); err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}

	if err := a.UserService.AllowEditing(c, int32(userIdInt), body.CanEdit); err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	user, err := a.UserService.GetUserByID(c, int32(userIdInt))
	if db.IsNoRows(err) {
		ErrorResponse(c, http.StatusNotFound, fmt.Errorf("user not found: %w", err))
		return
	}
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	resp := userJson{
		ID:      strconv.Itoa(int(user.ID)),
		Name:    user.GoogleOauthUserName,
		CanEdit: user.AllowEditing,
	}

	SuccessDataResponse(c, resp)
}
