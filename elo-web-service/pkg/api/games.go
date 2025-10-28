package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	elo "github.com/tolyandre/elo-web-service/pkg/elo"
)

func ListGames(c *gin.Context) {
	type gameJson struct {
		Id              string `json:"id"`
		LastPlayedOrder int    `json:"last_played_order"`
	}

	type gamesJson struct {
		Games []gameJson `json:"games"`
	}

	games, err := elo.GetGameTitlesOrderedByLastPlayed()
	if err != nil {
		errorResponse(c, http.StatusBadRequest, err)
		return
	}

	var gameList []gameJson
	for i, g := range games {
		gameList = append(gameList, gameJson{
			Id:              g,
			LastPlayedOrder: i,
		})
	}

	c.JSON(http.StatusOK, gamesJson{
		Games: gameList,
	})
}

func GetGame(c *gin.Context) {
	type gameJson struct {
		Id           string `json:"id"`
		TotalMatches int    `json:"total_matches"`
	}

	id := c.Param("id")
	gameStatistics, err := elo.GetGameStatistics(id)
	if err != nil {
		errorResponse(c, http.StatusBadRequest, err)
		return
	}

	c.JSON(http.StatusOK, gameJson{
		Id:           id,
		TotalMatches: gameStatistics.TotalMatches,
	})
}
