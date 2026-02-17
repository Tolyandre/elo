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

	if db.NotFound(err) {
		return nil, fmt.Errorf("user not found: %w", err)
	}

	if err != nil {
		return nil, err
	}

	return user, nil
}
