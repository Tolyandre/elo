package api

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	cfg "github.com/tolyandre/elo-web-service/pkg/configuration"
	googlesheet "github.com/tolyandre/elo-web-service/pkg/google-sheet"
)

type settingsJson struct {
	EloConstK       float64 `json:"elo_const_k"`
	EloConstD       float64 `json:"elo_const_d"`
	GoogleSheetLink string  `json:"google_sheet_link"`
}

func ListSettings(c *gin.Context) {
	parsedData, err := googlesheet.GetParsedData()

	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, settingsJson{
		EloConstK:       parsedData.Settings.EloConstK,
		EloConstD:       parsedData.Settings.EloConstD,
		GoogleSheetLink: fmt.Sprintf("https://docs.google.com/spreadsheets/d/%s", cfg.Config.DocID),
	})
}
