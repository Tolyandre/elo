package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	elo "github.com/tolyandre/elo-web-service/pkg/elo"
)

type playerJson struct {
	ID      string            `json:"id"`
	Now     playerEloRankJson `json:"now"`
	DayAgo  playerEloRankJson `json:"day_ago"`
	WeekAgo playerEloRankJson `json:"week_ago"`
}

type playerEloRankJson struct {
	Elo  float64 `json:"elo"`
	Rank int     `json:"rank"`
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
		dayAgo := findPlayer(dayAgoPlayers, p.ID)
		weekAgo := findPlayer(weekAgoPlayers, p.ID)
		jsonPlayers = append(jsonPlayers, playerJson{
			ID: p.ID,
			Now: playerEloRankJson{
				Elo:  p.Elo,
				Rank: p.Rank,
			},
			DayAgo: playerEloRankJson{
				Elo:  dayAgo.Elo,
				Rank: dayAgo.Rank,
			},
			WeekAgo: playerEloRankJson{
				Elo:  weekAgo.Elo,
				Rank: weekAgo.Rank,
			},
		})
	}

	SuccessDataResponse(c, jsonPlayers)
}

func findPlayer(players []elo.Player, id string) *elo.Player {
	for _, player := range players {
		if player.ID == id {
			return &player
		}
	}
	return nil
}
