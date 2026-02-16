package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	elo "github.com/tolyandre/elo-web-service/pkg/elo"
)

type playerJson struct {
	ID   string          `json:"id"`
	Rank historyRankJson `json:"rank"`
}

type historyRankJson struct {
	Now     playerEloRankJson `json:"now"`
	DayAgo  playerEloRankJson `json:"day_ago"`
	WeekAgo playerEloRankJson `json:"week_ago"`
}
type playerEloRankJson struct {
	Elo                  float64 `json:"elo"`
	Rank                 *int    `json:"rank"`
	MatchesLeftForRanked int     `json:"matches_left_for_ranked"`
}

func (a *API) ListPlayers(c *gin.Context) {

	actualPlayers, err := elo.GetPlayersWithRank(nil)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}
	tDay := time.Now().Add(-time.Hour * 12)
	dayAgoPlayers, err := elo.GetPlayersWithRank(&tDay)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}

	tWeek := time.Now().Add(-time.Hour * (24*7 - 12))
	weekAgoPlayers, err := elo.GetPlayersWithRank(&tWeek)
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
			Rank: historyRankJson{
				Now: playerEloRankJson{
					Elo:                  p.Elo,
					Rank:                 p.Rank,
					MatchesLeftForRanked: p.MatchesLeftForRanked,
				},
				DayAgo: playerEloRankJson{
					Elo:                  dayAgo.Elo,
					Rank:                 dayAgo.Rank,
					MatchesLeftForRanked: p.MatchesLeftForRanked,
				},
				WeekAgo: playerEloRankJson{
					Elo:                  weekAgo.Elo,
					Rank:                 weekAgo.Rank,
					MatchesLeftForRanked: p.MatchesLeftForRanked,
				},
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
