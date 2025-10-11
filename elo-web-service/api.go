package main

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	googlesheet "github.com/tolyandre/elo-web-service/pkg/google-sheet"
)

type playerJson struct {
	ID  string  `json:"id"`
	Elo float64 `json:"elo"`
}

type addMatchJson struct {
	Game  string             `json:"game" binding:"required"`
	Score map[string]float64 `json:"score" binding:"required"`
}

type matchPlayerJson struct {
	EloPay  float64 `json:"eloPay"`
	EloEarn float64 `json:"eloEarn"`
	Score   float64 `json:"score"`
}

type matchJson struct {
	Id      int                        `json:"id"`
	Game    string                     `json:"game"`
	Date    *time.Time                 `json:"date"`
	Players map[string]matchPlayerJson `json:"score"`
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

func AddMatch(c *gin.Context) {
	var payload addMatchJson

	if err := c.ShouldBindJSON(&payload); err != nil {
		errorResponse(c, http.StatusBadRequest, err)
		return
	}

	if err := googlesheet.AddMatch(payload.Game, payload.Score); err != nil {
		errorResponse(c, http.StatusInternalServerError, err)
	}

	statusMessageResponse(c, http.StatusCreated, "Match is saved")
}

func ListMatches(c *gin.Context) {
	parsedMatches, err := googlesheet.ParseMatchesSheet()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": err.Error(),
		})
		return
	}

	matchesJson := make([]matchJson, 0, len(parsedMatches))
	for _, pm := range parsedMatches {
		m := matchJson{
			Id:      pm.RowNum,
			Game:    pm.Game,
			Date:    pm.Date,
			Players: make(map[string]matchPlayerJson, len(pm.PlayersScore)),
		}

		for pid, score := range pm.PlayersScore {
			m.Players[pid] = matchPlayerJson{
				Score:   score,
				EloPay:  0,
				EloEarn: 0,
			}
		}

		matchesJson = append(matchesJson, m)
	}

	c.JSON(http.StatusOK, matchesJson)
}

func errorResponse(c *gin.Context, code int, err error) {
	c.JSON(code, gin.H{
		"error": err.Error(),
	})
}

func statusMessageResponse(c *gin.Context, code int, message string) {
	c.JSON(code, gin.H{"status": message})
}
