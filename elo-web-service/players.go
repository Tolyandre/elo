package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
	googlesheet "github.com/tolyandre/elo-web-service/pkg/google-sheet"
)

type playerJson struct {
	ID  string  `json:"id"`
	Elo float64 `json:"elo"`
}

func ListPlayers(c *gin.Context) {
	players, err := googlesheet.ParsePlayersAndElo()

	if err != nil {
		errorResponse(c, http.StatusBadRequest, err)
		return
	}

	jsonPlayers := make([]playerJson, 0, len(players))
	for _, p := range players {
		jsonPlayers = append(jsonPlayers, playerJson{
			ID:  p.ID,
			Elo: p.Elo,
		})
	}

	c.JSON(http.StatusOK, jsonPlayers)
}
