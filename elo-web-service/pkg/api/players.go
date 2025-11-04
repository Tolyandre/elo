package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	elo "github.com/tolyandre/elo-web-service/pkg/elo"
)

type playerJson struct {
	ID          string  `json:"id"`
	Elo         float64 `json:"elo"`
	Rank        int     `json:"rank"`
	RankDayAgo  int     `json:"rank_day_ago"`
	RankWeekAgo int     `json:"rank_week_ago"`
}

func ListPlayers(c *gin.Context) {

	actualPlayers, err := elo.GetPlayersWithElo(nil)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}
	tDay := time.Now().Add(-time.Hour * 12)
	dayAgoPlayers, err := elo.GetPlayersWithElo(&tDay)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}

	tWeek := time.Now().Add(-time.Hour * (24*7 - 12))
	weekAgoPlayers, err := elo.GetPlayersWithElo(&tWeek)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}

	jsonPlayers := make([]playerJson, 0, len(actualPlayers))
	for _, p := range actualPlayers {
		jsonPlayers = append(jsonPlayers, playerJson{
			ID:          p.ID,
			Elo:         p.Elo,
			Rank:        p.Rank,
			RankDayAgo:  findPlayer(dayAgoPlayers, p.ID).Rank,
			RankWeekAgo: findPlayer(weekAgoPlayers, p.ID).Rank,
		})
	}

	c.JSON(http.StatusOK, jsonPlayers)
}

func findPlayer(players []elo.Player, id string) *elo.Player {
	for _, player := range players {
		if player.ID == id {
			return &player
		}
	}
	return nil
}
