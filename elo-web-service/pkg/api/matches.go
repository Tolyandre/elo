package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	elo "github.com/tolyandre/elo-web-service/pkg/elo"
	googlesheet "github.com/tolyandre/elo-web-service/pkg/google-sheet"
)

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
	parsedData, err := googlesheet.GetParsedData()
	if err != nil {
		errorResponse(c, http.StatusBadRequest, err)
		return
	}

	settings := parsedData.Settings

	matchesJson := make([]matchJson, 0, len(parsedData.Matches))
	// skip first row as it contains start elo value (fake match)
	for _, pm := range parsedData.Matches[1:] {
		m := matchJson{
			Id:      pm.RowNum,
			Game:    pm.Game,
			Date:    pm.Date,
			Players: make(map[string]matchPlayerJson, len(pm.PlayersScore)),
		}

		absoluteLoserScore := elo.GetAsboluteLoserScore(&pm)

		for pid, score := range pm.PlayersScore {
			prevElo := getByRowNum(parsedData.Elo, pm.RowNum-1)
			m.Players[pid] = matchPlayerJson{
				Score:   score,
				EloPay:  -settings.EloConstK * elo.WinExpectation(prevElo.PlayersElo[pid], &pm, prevElo, settings.EloConstD),
				EloEarn: settings.EloConstK * elo.NormalizedScore(pm.PlayersScore[pid], &pm, absoluteLoserScore),
			}
		}

		matchesJson = append(matchesJson, m)
	}

	c.JSON(http.StatusOK, matchesJson)
}

// eloRows must be ordered; first row number 2 has index 0 (first row is header)
func getByRowNum(eloRows []googlesheet.EloRow, rowNum int) *googlesheet.EloRow {
	return &eloRows[rowNum-2]
}

func errorResponse(c *gin.Context, code int, err error) {
	c.JSON(code, gin.H{
		"error": err.Error(),
	})
}

func statusMessageResponse(c *gin.Context, code int, message string) {
	c.JSON(code, gin.H{"status": message})
}
