package api

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	cfg "github.com/tolyandre/elo-web-service/pkg/configuration"
)

type settingsJson struct {
	EloConstK       float64 `json:"elo_const_k"`
	EloConstD       float64 `json:"elo_const_d"`
	GoogleSheetLink string  `json:"google_sheet_link"`
}

func (a *API) ListSettings(c *gin.Context) {
	// Get latest Elo settings from database
	settings, err := a.Queries.GetLatestEloSettings(c.Request.Context())
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	SuccessDataResponse(c, settingsJson{
		EloConstK:       settings.EloConstK,
		EloConstD:       settings.EloConstD,
		GoogleSheetLink: fmt.Sprintf("https://docs.google.com/spreadsheets/d/%s", cfg.Config.DocID),
	})
}
