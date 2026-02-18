package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func (a *API) ListGames(c *gin.Context) {
	type gameJson struct {
		Id              string `json:"id"`
		Name            string `json:"name"`
		LastPlayedOrder int    `json:"last_played_order"`
		TotalMatches    int    `json:"total_matches"`
	}

	type gamesJson struct {
		Games []gameJson `json:"games"`
	}

	games, err := a.GameService.GetGameTitlesOrderedByLastPlayed(c.Request.Context())
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}

	var gameList = make([]gameJson, 0)
	for i, g := range games {
		gameList = append(gameList, gameJson{
			Id:              g.Id,
			Name:            g.Name,
			LastPlayedOrder: i,
			TotalMatches:    g.TotalMatches,
		})
	}

	SuccessDataResponse(c, gamesJson{
		Games: gameList,
	})
}

func (a *API) GetGame(c *gin.Context) {
	type playerJson struct {
		Id   string  `json:"id"`
		Elo  float64 `json:"elo"`
		Rank int     `json:"rank"`
	}

	type gameJson struct {
		Id           string       `json:"id"`
		Name         string       `json:"name"`
		TotalMatches int          `json:"total_matches"`
		Players      []playerJson `json:"players"`
	}

	id := c.Param("id")
	gameStatistics, err := a.GameService.GetGameStatistics(c, id)
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
		Name:         gameStatistics.Name,
		TotalMatches: gameStatistics.TotalMatches,
		Players:      playerList,
	})
}
