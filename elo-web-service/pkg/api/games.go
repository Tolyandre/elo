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
		TotalMatches    int    `json:"total_matches"`
	}

	type gamesJson struct {
		Games []gameJson `json:"games"`
	}

	games, err := elo.GetGameTitlesOrderedByLastPlayed()
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}

	var gameList []gameJson
	for i, g := range games {
		gameList = append(gameList, gameJson{
			Id:              g.Id,
			LastPlayedOrder: i,
			TotalMatches:    g.TotalMatches,
		})
	}

	SuccessDataResponse(c, gamesJson{
		Games: gameList,
	})
}

func GetGame(c *gin.Context) {
	type playerJson struct {
		Id   string  `json:"id"`
		Elo  float64 `json:"elo"`
		Rank int     `json:"rank"`
	}

	type gameJson struct {
		Id           string       `json:"id"`
		TotalMatches int          `json:"total_matches"`
		Players      []playerJson `json:"players"`
	}

	id := c.Param("id")
	gameStatistics, err := elo.GetGameStatistics(id)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}

	var playerList []playerJson = make([]playerJson, 0, len(gameStatistics.Players))
	for _, p := range gameStatistics.Players {
		playerList = append(playerList, playerJson{
			Id:   p.Id,
			Elo:  p.Elo,
			Rank: p.Rank,
		})
	}

	SuccessDataResponse(c, gameJson{
		Id:           id,
		TotalMatches: gameStatistics.TotalMatches,
		Players:      playerList,
	})
}
