package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	elo "github.com/tolyandre/elo-web-service/pkg/elo"
)

type gamesJson struct {
	Games []string `json:"games"`
}

func ListGames(c *gin.Context) {
	games, err := elo.GetGames()

	if err != nil {
		errorResponse(c, http.StatusBadRequest, err)
		return
	}
	c.JSON(http.StatusOK, gamesJson{
		Games: games,
	})
}
