package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

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

	// Get settings for Elo calculation
	parsedData, err := googlesheet.GetParsedData()
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	// Add match to database with current timestamp
	now := time.Now()
	_, err = a.MatchService.AddMatch(c.Request.Context(), payload.Game, payload.Score, &now, nil, parsedData.Settings)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	// Also add to Google Sheets for backwards compatibility
	if err := googlesheet.AddMatch(payload.Game, payload.Score); err != nil {
		// Log error but don't fail the request since DB already has it
		c.Error(err)
	}

	SuccessMessageResponse(c, http.StatusCreated, "Match is saved")
}

func (a *API) ListMatches(c *gin.Context) {
	// fetch matches and players from DB in a single query
	rows, err := a.Queries.ListMatchesWithPlayers(c.Request.Context())
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	// Group rows by match id
	type tempMatch struct {
		Id       int
		GameId   string
		GameName string
		Date     *time.Time
		Players  map[int32]matchPlayerJson
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
				Id:       int(r.MatchID),
				GameId:   strconv.Itoa(int(r.GameID)),
				GameName: r.GameName,
				Date:     date,
				Players:  make(map[int32]matchPlayerJson),
			}
			order = append(order, r.MatchID)
		}

		m := matchesMap[r.MatchID]

		// Read Elo values from database
		var eloPay, eloEarn float64
		if r.EloPay.Valid {
			eloPay = r.EloPay.Float64
		}
		if r.EloEarn.Valid {
			eloEarn = r.EloEarn.Float64
		}

		m.Players[r.PlayerID] = matchPlayerJson{
			Score:   r.Score,
			EloPay:  eloPay,
			EloEarn: eloEarn,
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
			Players:  make(map[string]matchPlayerJson, len(tm.Players)),
		}

		// Convert int32 keys to string keys
		for pid, playerData := range tm.Players {
			pidStr := strconv.Itoa(int(pid))
			m.Players[pidStr] = playerData
		}

		matchesJson = append(matchesJson, m)
	}

	SuccessDataResponse(c, matchesJson)
}

// eloRows must be ordered; first row number 2 has index 0 (first row is header)
func getByRowNum(eloRows []googlesheet.EloRow, rowNum int) *googlesheet.EloRow {
	return &eloRows[rowNum-2]
}
