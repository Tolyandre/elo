package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	elo "github.com/tolyandre/elo-web-service/pkg/elo"
)

type gameJson struct {
	ID              string `json:"id"`
	LastPlayedOrder int    `json:"last_played_order"`
}

type gamesJson struct {
	Games []gameJson `json:"games"`
}

func ListGames(c *gin.Context) {
	games, err := elo.GetGames()
	if err != nil {
		errorResponse(c, http.StatusBadRequest, err)
		return
	}

	var gameList []gameJson
	for i, g := range games {
		gameList = append(gameList, gameJson{
			ID:              g,
			LastPlayedOrder: i,
		})
	}

	c.JSON(http.StatusOK, gamesJson{
		Games: gameList,
	})
}
