package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type settingsJson struct {
	EloConstK float64 `json:"elo_const_k"`
	EloConstD float64 `json:"elo_const_d"`
}

func (a *API) ListSettings(c *gin.Context) {
	// Get latest Elo settings from database
	settings, err := a.Queries.GetLatestEloSettings(c.Request.Context())
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	SuccessDataResponse(c, settingsJson{
		EloConstK: settings.EloConstK,
		EloConstD: settings.EloConstD,
	})
}
