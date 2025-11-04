package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	googlesheet "github.com/tolyandre/elo-web-service/pkg/google-sheet"
)

type settingsJson struct {
	EloConstK float64 `json:"elo_const_k"`
	EloConstD float64 `json:"elo_const_d"`
}

func ListSettings(c *gin.Context) {
	parsedData, err := googlesheet.GetParsedData()

	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, settingsJson{
		EloConstK: parsedData.Settings.EloConstK,
		EloConstD: parsedData.Settings.EloConstD,
	})
}
