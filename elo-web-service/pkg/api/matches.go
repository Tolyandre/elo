package api

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

type addMatchJson struct {
	GameId string             `json:"game_id" binding:"required"`
	Score  map[string]float64 `json:"score" binding:"required"` // key is player_id as string
}

type updateMatchJson struct {
	GameId string             `json:"game_id" binding:"required"`
	Score  map[string]float64 `json:"score" binding:"required"` // key is player_id as string
	Date   time.Time          `json:"date" binding:"required"`  // Date is required and cannot be null
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
	match, err := a.MatchService.AddMatch(c.Request.Context(), int32(gameID), playerScores, &now)
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

// matchCursor is the continuation token encoded as base64 JSON.
type matchCursor struct {
	ID   int32   `json:"id"`
	Date *string `json:"date"` // RFC3339Nano, nil means match has no date
}

func encodeMatchCursor(id int32, date *time.Time) string {
	c := matchCursor{ID: id}
	if date != nil {
		s := date.UTC().Format(time.RFC3339Nano)
		c.Date = &s
	}
	b, _ := json.Marshal(c)
	return base64.StdEncoding.EncodeToString(b)
}

func decodeMatchCursor(token string) (pgtype.Int4, pgtype.Timestamptz, error) {
	b, err := base64.StdEncoding.DecodeString(token)
	if err != nil {
		return pgtype.Int4{}, pgtype.Timestamptz{}, err
	}
	var c matchCursor
	if err := json.Unmarshal(b, &c); err != nil {
		return pgtype.Int4{}, pgtype.Timestamptz{}, err
	}
	cursorID := pgtype.Int4{Int32: c.ID, Valid: true}
	var cursorDate pgtype.Timestamptz
	if c.Date != nil {
		t, err := time.Parse(time.RFC3339Nano, *c.Date)
		if err != nil {
			return pgtype.Int4{}, pgtype.Timestamptz{}, err
		}
		cursorDate = pgtype.Timestamptz{Time: t, Valid: true}
	}
	return cursorID, cursorDate, nil
}

// groupMatchRows converts a slice of rows (each row = one player in a match) into
// ordered match groups. Returns the matches map and ID-ordered slice.
type tempMatch struct {
	Id       int
	GameId   string
	GameName string
	Date     *time.Time
	Players  map[int32]matchPlayerJson
}

func buildMatchesResponse(matchesMap map[int32]*tempMatch, order []int32) []matchJson {
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
		for pid, playerData := range tm.Players {
			m.Players[strconv.Itoa(int(pid))] = playerData
		}
		matchesJson = append(matchesJson, m)
	}
	return matchesJson
}

func (a *API) ListMatches(c *gin.Context) {
	// Parse optional filter params
	var gameID pgtype.Int4
	if gStr := c.Query("game_id"); gStr != "" {
		g, err := strconv.ParseInt(gStr, 10, 32)
		if err != nil {
			ErrorResponse(c, http.StatusBadRequest, "Invalid game_id")
			return
		}
		gameID = pgtype.Int4{Int32: int32(g), Valid: true}
	}

	var playerID pgtype.Int4
	if pStr := c.Query("player_id"); pStr != "" {
		p, err := strconv.ParseInt(pStr, 10, 32)
		if err != nil {
			ErrorResponse(c, http.StatusBadRequest, "Invalid player_id")
			return
		}
		playerID = pgtype.Int4{Int32: int32(p), Valid: true}
	}

	// Parse continuation token
	var cursorID pgtype.Int4
	var cursorDate pgtype.Timestamptz
	if beforeToken := c.Query("before"); beforeToken != "" {
		var err error
		cursorID, cursorDate, err = decodeMatchCursor(beforeToken)
		if err != nil {
			ErrorResponse(c, http.StatusBadRequest, "Invalid cursor")
			return
		}
	}

	// Parse page size
	limit := int32(30)
	if lStr := c.Query("limit"); lStr != "" {
		l, err := strconv.ParseInt(lStr, 10, 32)
		if err == nil && l > 0 && l <= 100 {
			limit = int32(l)
		}
	}

	rows, err := a.Queries.ListMatchesWithPlayersPaginated(c.Request.Context(), db.ListMatchesWithPlayersPaginatedParams{
		GameID:     gameID,
		PlayerID:   playerID,
		CursorID:   cursorID,
		CursorDate: cursorDate,
		Limit:      limit,
	})
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
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
		m.Players[r.PlayerID] = matchPlayerJson{
			Score:   r.Score,
			EloPay:  r.EloPay,
			EloEarn: r.EloEarn,
		}
	}

	matchesJson := buildMatchesResponse(matchesMap, order)

	// Build next_cursor if there may be more results
	var nextCursor *string
	if int32(len(order)) == limit {
		lastID := order[len(order)-1]
		token := encodeMatchCursor(int32(matchesMap[lastID].Id), matchesMap[lastID].Date)
		nextCursor = &token
	}

	c.JSON(http.StatusOK, gin.H{
		"status":      "success",
		"data":        matchesJson,
		"next_cursor": nextCursor,
	})
}

func (a *API) GetMatchById(c *gin.Context) {
	matchIDStr := c.Param("id")
	matchID, err := strconv.ParseInt(matchIDStr, 10, 32)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, "Invalid match id: "+matchIDStr)
		return
	}

	rows, err := a.Queries.GetMatchWithPlayers(c.Request.Context(), int32(matchID))
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}
	if len(rows) == 0 {
		ErrorResponse(c, http.StatusNotFound, "Match not found")
		return
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
		m.Players[r.PlayerID] = matchPlayerJson{
			Score:   r.Score,
			EloPay:  r.EloPay,
			EloEarn: r.EloEarn,
		}
	}

	result := buildMatchesResponse(matchesMap, order)
	SuccessDataResponse(c, result[0])
}
