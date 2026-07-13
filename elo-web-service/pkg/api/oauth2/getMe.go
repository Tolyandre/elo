package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/tolyandre/elo-web-service/pkg/api"
)

type userJson struct {
	Id       string  `json:"id"`
	Name     string  `json:"name"`
	CanEdit  bool    `json:"can_edit"`
	PlayerID *string `json:"player_id"`
}

func (a *OAUTH2) GetMe(ctx *gin.Context) {
	user, err := api.MustGetCurrentUser(ctx, a.UserService)

	if err != nil {
		api.ErrorResponse(ctx, http.StatusInternalServerError, err)
		return
	}

	var playerID *string
	if user.PlayerID != nil {
		s := *user.PlayerID
		playerID = &s
	}

	api.SuccessDataResponse(ctx, userJson{
		Id:       user.ID,
		Name:     user.GoogleOauthUserName,
		CanEdit:  user.AllowEditing,
		PlayerID: playerID,
	})
}

func (a *OAUTH2) PatchMe(ctx *gin.Context) {
	userID, err := api.MustGetCurrentUserId(ctx)
	if err != nil {
		api.ErrorResponse(ctx, http.StatusUnauthorized, err)
		return
	}

	var body struct {
		PlayerID *string `json:"player_id"`
	}
	if err := ctx.BindJSON(&body); err != nil {
		api.ErrorResponse(ctx, http.StatusBadRequest, err)
		return
	}

	if err := a.UserService.SetUserPlayer(ctx.Request.Context(), userID, body.PlayerID); err != nil {
		if err.Error() == "player already linked to another user" {
			api.ErrorResponse(ctx, http.StatusConflict, err)
			return
		}
		api.ErrorResponse(ctx, http.StatusInternalServerError, err)
		return
	}

	ctx.Status(http.StatusNoContent)
}
