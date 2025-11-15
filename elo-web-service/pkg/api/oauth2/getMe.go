package api

import (
	"net/http"
	"slices"

	"github.com/gin-gonic/gin"
	"github.com/tolyandre/elo-web-service/pkg/api"
	googlesheet "github.com/tolyandre/elo-web-service/pkg/google-sheet"
)

type userJson struct {
	Id      string `json:"id"`
	Name    string `json:"name"`
	CanEdit bool   `json:"can_edit"`
}

func GetMe(ctx *gin.Context) {
	userID := ctx.MustGet(api.CurrentUserKey)

	parsedData, err := googlesheet.GetParsedData()

	if err != nil {
		api.ErrorResponse(ctx, http.StatusInternalServerError, err)
		return
	}

	userRowIndex := slices.IndexFunc(parsedData.Users,
		func(row googlesheet.UserRow) bool { return row.ID == userID })

	if userRowIndex < 0 {
		api.ErrorResponse(ctx, http.StatusInternalServerError, "User not found")
		return
	}

	userRow := parsedData.Users[userRowIndex]
	api.SuccessDataResponse(ctx, userJson{
		Id:      userRow.ID,
		Name:    userRow.Name,
		CanEdit: userRow.CanEdit,
	})
}
