package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
	googlesheet "github.com/tolyandre/elo-web-service/pkg/google-sheet"
)

type gamesJson struct {
	Games []string `json:"games"`
}

func ListGames(c *gin.Context) {
	games, err := googlesheet.GetGames()

	if err != nil {
		errorResponse(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, gamesJson{
		Games: games,
	})
}
