package main

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
	settings, err := googlesheet.ParseSettings()

	if err != nil {
		errorResponse(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, settingsJson{
		EloConstK: settings.EloConstK,
		EloConstD: settings.EloConstD,
	})
}
