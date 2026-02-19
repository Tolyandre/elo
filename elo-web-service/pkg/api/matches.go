package api

import (
	"net/http"
	"strconv"
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
	Id       int                        `json:"id"`
	GameId   string                     `json:"game_id"`
	GameName string                     `json:"game_name"`
	Date     *time.Time                 `json:"date"`
	Players  map[string]matchPlayerJson `json:"score"`
}

func (a *API) AddMatch(c *gin.Context) {
	var payload addMatchJson
	if err := c.ShouldBindJSON(&payload); err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}

	user, err := MustGetCurrentUser(c, a.UserService)

	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	if !user.AllowEditing {
		ErrorResponse(c, http.StatusForbidden, "You are not authorized to add matches")
		return
	}

	if err := googlesheet.AddMatch(payload.Game, payload.Score); err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
	}

	SuccessMessageResponse(c, http.StatusCreated, "Match is saved")
}

func (a *API) ListMatches(c *gin.Context) {
	parsedData, err := googlesheet.GetParsedData()
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}

	settings := parsedData.Settings

	// fetch matches and players from DB in a single query
	rows, err := a.Queries.ListMatchesWithPlayers(c.Request.Context())
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	// Group rows by match id
	type tempMatch struct {
		Id           int
		GameId       string
		GameName     string
		Date         *time.Time
		PlayersScore map[int32]float64
		PrevElo      map[int32]float64
	}

	matchesMap := make(map[int32]*tempMatch)
	order := make([]int32, 0)

	for _, r := range rows {
		if _, ok := matchesMap[r.MatchID]; !ok {
			var date *time.Time
			if r.Date.Valid {
				t := r.Date.Time
				date = &t
			}
			matchesMap[r.MatchID] = &tempMatch{
				Id:           int(r.MatchID),
				GameId:       strconv.Itoa(int(r.GameID)),
				GameName:     r.GameName,
				Date:         date,
				PlayersScore: make(map[int32]float64),
				PrevElo:      make(map[int32]float64),
			}
			order = append(order, r.MatchID)
		}

		m := matchesMap[r.MatchID]
		m.PlayersScore[r.PlayerID] = r.Score
		// PrevRating may be NULL; sqlc maps it to interface{} when nullable.
		switch v := r.PrevRating.(type) {
		case nil:
			m.PrevElo[r.PlayerID] = elo.StartingElo
		case float64:
			m.PrevElo[r.PlayerID] = v
		case int64:
			m.PrevElo[r.PlayerID] = float64(v)
		case []byte:
			if s := string(v); s != "" {
				if f, err := strconv.ParseFloat(s, 64); err == nil {
					m.PrevElo[r.PlayerID] = f
				} else {
					m.PrevElo[r.PlayerID] = elo.StartingElo
				}
			} else {
				m.PrevElo[r.PlayerID] = elo.StartingElo
			}
		default:
			m.PrevElo[r.PlayerID] = elo.StartingElo
		}
	}

	// Build response
	matchesJson := make([]matchJson, 0, len(order))
	for _, mid := range order {
		tm := matchesMap[mid]
		m := matchJson{
			Id:       tm.Id,
			GameId:   tm.GameId,
			GameName: tm.GameName,
			Date:     tm.Date,
			Players:  make(map[string]matchPlayerJson, len(tm.PlayersScore)),
		}

		// convert maps to string-keyed maps for elo package
		playersScoreStr := make(map[string]float64, len(tm.PlayersScore))
		prevEloStr := make(map[string]float64, len(tm.PrevElo))
		for pid, sc := range tm.PlayersScore {
			key := strconv.Itoa(int(pid))
			playersScoreStr[key] = sc
		}
		for pid, pr := range tm.PrevElo {
			key := strconv.Itoa(int(pid))
			prevEloStr[key] = pr
		}

		absoluteLoserScore := elo.GetAsboluteLoserScore(playersScoreStr)

		for pid, score := range tm.PlayersScore {
			pidStr := strconv.Itoa(int(pid))
			m.Players[pidStr] = matchPlayerJson{
				Score:   score,
				EloPay:  -settings.EloConstK * elo.WinExpectation(prevEloStr[pidStr], playersScoreStr, elo.StartingElo, prevEloStr, settings.EloConstD),
				EloEarn: settings.EloConstK * elo.NormalizedScore(playersScoreStr[pidStr], playersScoreStr, absoluteLoserScore),
			}
		}

		matchesJson = append(matchesJson, m)
	}

	SuccessDataResponse(c, matchesJson)
}

// eloRows must be ordered; first row number 2 has index 0 (first row is header)
func getByRowNum(eloRows []googlesheet.EloRow, rowNum int) *googlesheet.EloRow {
	return &eloRows[rowNum-2]
}
