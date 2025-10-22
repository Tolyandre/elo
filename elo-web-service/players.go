package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
	elo "github.com/tolyandre/elo-web-service/pkg/elo"
)

type playerJson struct {
	ID   string  `json:"id"`
	Elo  float64 `json:"elo"`
	Rank int     `json:"rank"`
}

func ListPlayers(c *gin.Context) {
	players, err := elo.GetPlayersWithElo()

	if err != nil {
		errorResponse(c, http.StatusBadRequest, err)
		return
	}

	jsonPlayers := make([]playerJson, 0, len(players))
	for _, p := range players {
		jsonPlayers = append(jsonPlayers, playerJson{
			ID:   p.ID,
			Elo:  p.Elo,
			Rank: p.Rank,
		})
	}

	c.JSON(http.StatusOK, jsonPlayers)
}
