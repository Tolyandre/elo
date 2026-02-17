package api

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/tolyandre/elo-web-service/pkg/api"
)

type userJson struct {
	Id      string `json:"id"`
	Name    string `json:"name"`
	CanEdit bool   `json:"can_edit"`
}

func (a *OAUTH2) GetMe(ctx *gin.Context) {
	user, err := api.MustGetCurrentUser(ctx, a.UserService)

	if err != nil {
		api.ErrorResponse(ctx, http.StatusInternalServerError, err)
		return
	}

	api.SuccessDataResponse(ctx, userJson{
		Id:      fmt.Sprintf("%d", user.ID),
		Name:    user.GoogleOauthUserName,
		CanEdit: user.AllowEditing,
	})
}
