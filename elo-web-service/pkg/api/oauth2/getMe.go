package api

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/tolyandre/elo-web-service/pkg/api"
	"github.com/tolyandre/elo-web-service/pkg/elo"
	"github.com/tolyandre/elo-web-service/pkg/id"
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

	// This response is rendered by gin directly (not the generated DTO layer),
	// so the wire encoding is applied by hand: raw gin responses bypass the
	// type-driven conversion (ADR-12).
	var playerID *string
	if user.PlayerID != nil {
		s := string(user.PlayerID.Base58())
		playerID = &s
	}

	api.SuccessDataResponse(ctx, userJson{
		Id:       string(user.ID.Base58()),
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

	// Typed field: id.ID's UnmarshalJSON decodes the Base58 wire form (ADR-12);
	// JSON null unmarshals to a nil pointer (unlink).
	var body struct {
		PlayerID *api.Base58ID `json:"player_id"`
	}
	if err := ctx.BindJSON(&body); err != nil {
		api.ErrorResponse(ctx, http.StatusBadRequest, err)
		return
	}

	var playerID *id.ID
	if body.PlayerID != nil && *body.PlayerID != "" {
		playerID = body.PlayerID
	}

	if err := a.UserService.SetUserPlayer(ctx.Request.Context(), userID, playerID); err != nil {
		if errors.Is(err, elo.ErrPlayerAlreadyLinked) {
			api.ErrorResponse(ctx, http.StatusConflict, err)
			return
		}
		api.ErrorResponse(ctx, http.StatusInternalServerError, err)
		return
	}

	ctx.Status(http.StatusNoContent)
}
