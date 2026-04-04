package api

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/elo"
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
	RatingPay  float64 `json:"rating_pay"`
	RatingEarn float64 `json:"rating_earn"`
	Score      float64 `json:"score"`
}

type matchJson struct {
	Id       int                        `json:"id"`
	GameId   string                     `json:"game_id"`
	GameName string                     `json:"game_name"`
	Date     time.Time                  `json:"date"`
	Players  map[string]matchPlayerJson `json:"score"`
}

// parseMatchScores converts string-keyed game/player IDs to int32.
func parseMatchScores(gameIDStr string, scores map[string]float64) (int32, map[int32]float64, error) {
	gameID, err := strconv.ParseInt(gameIDStr, 10, 32)
	if err != nil {
		return 0, nil, fmt.Errorf("invalid game_id: %s", gameIDStr)
	}
	playerScores := make(map[int32]float64, len(scores))
	for k, v := range scores {
		pid, err := strconv.ParseInt(k, 10, 32)
		if err != nil {
			return 0, nil, fmt.Errorf("invalid player_id: %s", k)
		}
		playerScores[int32(pid)] = v
	}
	return int32(gameID), playerScores, nil
}

func (p addMatchJson) toDomain() (int32, map[int32]float64, error) {
	return parseMatchScores(p.GameId, p.Score)
}

func (p updateMatchJson) toDomain() (int32, map[int32]float64, error) {
	return parseMatchScores(p.GameId, p.Score)
}

// matchErrorToHTTP maps domain errors from MatchService to HTTP responses.
func matchErrorToHTTP(c *gin.Context, err error) {
	switch {
	case errors.Is(err, elo.ErrTooFewPlayers):
		ErrorResponse(c, http.StatusBadRequest, err.Error())
	case errors.Is(err, elo.ErrDateChangeTooLarge):
		ErrorResponse(c, http.StatusBadRequest, err.Error())
	case errors.Is(err, elo.ErrHistoryChangeConflict), errors.Is(err, elo.ErrHistoryChangeConflictBettingLock):
		ErrorResponse(c, http.StatusConflict, err.Error())
	case errors.Is(err, elo.ErrMatchNotFound):
		ErrorResponse(c, http.StatusNotFound, err.Error())
	case db.IsForeignKeyViolation(err):
		ErrorResponse(c, http.StatusBadRequest, "invalid game_id or player_id: "+err.Error())
	default:
		ErrorResponse(c, http.StatusInternalServerError, err)
	}
}

func (a *API) AddMatch(c *gin.Context) {
	var payload addMatchJson
	if err := c.ShouldBindJSON(&payload); err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}

	gameID, playerScores, err := payload.toDomain()
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}

	match, err := a.MatchService.AddMatch(c.Request.Context(), gameID, playerScores, time.Now())
	if err != nil {
		matchErrorToHTTP(c, err)
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

	gameID, playerScores, err := payload.toDomain()
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, err)
		return
	}

	_, err = a.MatchService.UpdateMatch(c.Request.Context(), int32(matchID), gameID, playerScores, payload.Date)
	if err != nil {
		matchErrorToHTTP(c, err)
		return
	}

	SuccessMessageResponse(c, http.StatusOK, "Match is updated")
}

// matchCursor is the continuation token encoded as base64 JSON.
// It embeds all search parameters so the client doesn't need to repeat them.
type matchCursor struct {
	GameID   *int32 `json:"game_id,omitempty"`
	PlayerID *int32 `json:"player_id,omitempty"`
	ClubID   *int32 `json:"club_id,omitempty"`
	NoClub   bool   `json:"no_club,omitempty"`
	Date     string `json:"date"` // RFC3339Nano — date of the last returned match
}

func encodeMatchCursor(gameID pgtype.Int4, playerID pgtype.Int4, clubID pgtype.Int4, noClub bool, date time.Time) string {
	c := matchCursor{Date: date.UTC().Format(time.RFC3339Nano), NoClub: noClub}
	if gameID.Valid {
		c.GameID = &gameID.Int32
	}
	if playerID.Valid {
		c.PlayerID = &playerID.Int32
	}
	if clubID.Valid {
		c.ClubID = &clubID.Int32
	}
	b, _ := json.Marshal(c)
	return base64.StdEncoding.EncodeToString(b)
}

// decodeMatchCursor returns gameID, playerID, clubID, noClub, cursorDate decoded from the token.
func decodeMatchCursor(token string) (pgtype.Int4, pgtype.Int4, pgtype.Int4, bool, pgtype.Timestamptz, error) {
	b, err := base64.StdEncoding.DecodeString(token)
	if err != nil {
		return pgtype.Int4{}, pgtype.Int4{}, pgtype.Int4{}, false, pgtype.Timestamptz{}, err
	}
	var c matchCursor
	if err := json.Unmarshal(b, &c); err != nil {
		return pgtype.Int4{}, pgtype.Int4{}, pgtype.Int4{}, false, pgtype.Timestamptz{}, err
	}
	t, err := time.Parse(time.RFC3339Nano, c.Date)
	if err != nil {
		return pgtype.Int4{}, pgtype.Int4{}, pgtype.Int4{}, false, pgtype.Timestamptz{}, err
	}
	var gameID pgtype.Int4
	if c.GameID != nil {
		gameID = pgtype.Int4{Int32: *c.GameID, Valid: true}
	}
	var playerID pgtype.Int4
	if c.PlayerID != nil {
		playerID = pgtype.Int4{Int32: *c.PlayerID, Valid: true}
	}
	var clubID pgtype.Int4
	if c.ClubID != nil {
		clubID = pgtype.Int4{Int32: *c.ClubID, Valid: true}
	}
	return gameID, playerID, clubID, c.NoClub, pgtype.Timestamptz{Time: t, Valid: true}, nil
}

// groupMatchRows converts a slice of rows (each row = one player in a match) into
// ordered match groups. Returns the matches map and ID-ordered slice.
type tempMatch struct {
	Id       int
	GameId   string
	GameName string
	Date     time.Time
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
	var gameID pgtype.Int4
	var playerID pgtype.Int4
	var clubID pgtype.Int4
	var noClub bool
	var cursorDate pgtype.Timestamptz

	if nextToken := c.Query("next"); nextToken != "" {
		// Continuation mode: all search params come from the cursor token.
		var err error
		gameID, playerID, clubID, noClub, cursorDate, err = decodeMatchCursor(nextToken)
		if err != nil {
			ErrorResponse(c, http.StatusBadRequest, "Invalid cursor")
			return
		}
	} else {
		// Initial mode: read search params from query string.
		if gStr := c.Query("game_id"); gStr != "" {
			g, err := strconv.ParseInt(gStr, 10, 32)
			if err != nil {
				ErrorResponse(c, http.StatusBadRequest, "Invalid game_id")
				return
			}
			gameID = pgtype.Int4{Int32: int32(g), Valid: true}
		}
		if pStr := c.Query("player_id"); pStr != "" {
			p, err := strconv.ParseInt(pStr, 10, 32)
			if err != nil {
				ErrorResponse(c, http.StatusBadRequest, "Invalid player_id")
				return
			}
			playerID = pgtype.Int4{Int32: int32(p), Valid: true}
		}
		if cStr := c.Query("club_id"); cStr == "__no_club__" {
			noClub = true
		} else if cStr != "" {
			cl, err := strconv.ParseInt(cStr, 10, 32)
			if err != nil {
				ErrorResponse(c, http.StatusBadRequest, "Invalid club_id")
				return
			}
			clubID = pgtype.Int4{Int32: int32(cl), Valid: true}
		}
	}

	// Parse page size (always from query string).
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
		ClubID:     clubID,
		NoClub:     pgtype.Bool{Bool: noClub, Valid: noClub},
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
			matchesMap[r.MatchID] = &tempMatch{
				Id:       int(r.MatchID),
				GameId:   strconv.Itoa(int(r.GameID)),
				GameName: r.GameName,
				Date:     r.Date.Time,
				Players:  make(map[int32]matchPlayerJson),
			}
			order = append(order, r.MatchID)
		}

		m := matchesMap[r.MatchID]
		m.Players[r.PlayerID] = matchPlayerJson{
			Score:      r.Score,
			RatingPay:  r.RatingPay,
			RatingEarn: r.RatingEarn,
		}
	}

	matchesJson := buildMatchesResponse(matchesMap, order)

	// Build next cursor if there may be more results.
	var next *string
	if int32(len(order)) == limit {
		lastID := order[len(order)-1]
		token := encodeMatchCursor(gameID, playerID, clubID, noClub, matchesMap[lastID].Date)
		next = &token
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data":   matchesJson,
		"next":   next,
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
			matchesMap[r.MatchID] = &tempMatch{
				Id:       int(r.MatchID),
				GameId:   strconv.Itoa(int(r.GameID)),
				GameName: r.GameName,
				Date:     r.Date.Time,
				Players:  make(map[int32]matchPlayerJson),
			}
			order = append(order, r.MatchID)
		}
		m := matchesMap[r.MatchID]
		m.Players[r.PlayerID] = matchPlayerJson{
			Score:      r.Score,
			RatingPay:  r.RatingPay,
			RatingEarn: r.RatingEarn,
		}
	}

	result := buildMatchesResponse(matchesMap, order)
	SuccessDataResponse(c, result[0])
}
