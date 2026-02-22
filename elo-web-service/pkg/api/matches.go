package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

type addMatchJson struct {
	GameId string             `json:"game_id" binding:"required"`
	Score  map[string]float64 `json:"score" binding:"required"` // key is player_id as string
}

type updateMatchJson struct {
	GameId string             `json:"game_id" binding:"required"`
	Score  map[string]float64 `json:"score" binding:"required"` // key is player_id as string
	Date   time.Time          `json:"date" binding:"required"`   // Date is required and cannot be null
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

	// Parse game_id from string to int32
	gameID, err := strconv.ParseInt(payload.GameId, 10, 32)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, "Invalid game_id: "+payload.GameId)
		return
	}

	// Convert player IDs from string to int32
	playerScores := make(map[int32]float64)
	for playerIDStr, score := range payload.Score {
		playerID, err := strconv.ParseInt(playerIDStr, 10, 32)
		if err != nil {
			ErrorResponse(c, http.StatusBadRequest, "Invalid player_id: "+playerIDStr)
			return
		}
		playerScores[int32(playerID)] = score
	}

	// Add match to database with current timestamp
	now := time.Now()
	match, err := a.MatchService.AddMatch(c.Request.Context(), int32(gameID), playerScores, &now, nil)
	if err != nil {
		// Check if error is due to foreign key constraint violation
		if db.IsForeignKeyViolation(err) {
			ErrorResponse(c, http.StatusBadRequest, "Invalid game_id or player_id: "+err.Error())
			return
		}
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	resp := struct {
		Id int32 `json:"id"`
	}{
		Id: match.ID,
	}

	SuccessDataResponse(c, resp)
}

func (a *API) UpdateMatch(c *gin.Context) {
	// Get match ID from URL parameter
	matchIDStr := c.Param("id")
	matchID, err := strconv.ParseInt(matchIDStr, 10, 32)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, "Invalid match id: "+matchIDStr)
		return
	}

	var payload updateMatchJson
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
		ErrorResponse(c, http.StatusForbidden, "You are not authorized to update matches")
		return
	}

	// Parse game_id from string to int32
	gameID, err := strconv.ParseInt(payload.GameId, 10, 32)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, "Invalid game_id: "+payload.GameId)
		return
	}

	// Convert player IDs from string to int32
	playerScores := make(map[int32]float64)
	for playerIDStr, score := range payload.Score {
		playerID, err := strconv.ParseInt(playerIDStr, 10, 32)
		if err != nil {
			ErrorResponse(c, http.StatusBadRequest, "Invalid player_id: "+playerIDStr)
			return
		}
		playerScores[int32(playerID)] = score
	}

	// Update match in database
	_, err = a.MatchService.UpdateMatch(c.Request.Context(), int32(matchID), int32(gameID), playerScores, payload.Date)
	if err != nil {
		// Check for specific error cases
		if db.IsForeignKeyViolation(err) {
			ErrorResponse(c, http.StatusBadRequest, "Invalid game_id or player_id: "+err.Error())
			return
		}
		if contains(err.Error(), "date change exceeds") {
			ErrorResponse(c, http.StatusBadRequest, err.Error())
			return
		}
		if contains(err.Error(), "unable to get match") {
			ErrorResponse(c, http.StatusNotFound, "Match not found")
			return
		}
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}

	SuccessMessageResponse(c, http.StatusOK, "Match is updated")
}

// contains checks if a string contains a substring (helper for error checking)
func contains(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
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
// func getByRowNum(eloRows []googlesheet.EloRow, rowNum int) *googlesheet.EloRow {
// 	return &eloRows[rowNum-2]
// }
