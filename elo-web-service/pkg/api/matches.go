package api

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/elo"
)

type updateMatchJson struct {
	GameId string             `json:"game_id" binding:"required"`
	Score  map[string]float64 `json:"score" binding:"required"` // key is player_id as string
	Date   time.Time          `json:"date" binding:"required"`  // Date is required and cannot be null
}

type matchPlayerJson struct {
	RatingStaked float64 `json:"rating_staked"`
	RatingEarned float64 `json:"rating_earned"`
	Score        float64 `json:"score"`
	RatingAfter  float64 `json:"rating_after"`
}

type matchJson struct {
	Id             string                     `json:"id"`
	GameId         string                     `json:"game_id"`
	GameName       string                     `json:"game_name"`
	Date           time.Time                  `json:"date"`
	Players        map[string]matchPlayerJson `json:"score"`
	HasMarkets     bool                       `json:"has_markets"`
	CalculatorKind pgtype.Text                `json:"-"`
	// CalculatorData is omitted on the list path (the paginated query does not
	// select it to avoid pulling large JSONB for every list row).
	CalculatorData json.RawMessage `json:"-"`
}

// parseMatchScores validates that the game_id and player_ids are present.
func parseMatchScores(gameIDStr string, scores map[string]float64) (string, map[string]float64, error) {
	if gameIDStr == "" {
		return "", nil, fmt.Errorf("invalid game_id: %s", gameIDStr)
	}
	playerScores := make(map[string]float64, len(scores))
	for k, v := range scores {
		if k == "" {
			return "", nil, fmt.Errorf("invalid player_id: %s", k)
		}
		playerScores[k] = v
	}
	return gameIDStr, playerScores, nil
}

func (p updateMatchJson) toDomain() (string, map[string]float64, error) {
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

func (a *API) UpdateMatch(c *gin.Context) {
	matchID := c.Param("id")

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

	_, err = a.MatchService.UpdateMatch(c.Request.Context(), matchID, gameID, playerScores, payload.Date, elo.UpdateMatchOpts{})
	if err != nil {
		matchErrorToHTTP(c, err)
		return
	}

	SuccessMessageResponse(c, http.StatusOK, "Match is updated")
}

// matchCursor is the continuation token encoded as base64 JSON.
// It embeds all search parameters so the client doesn't need to repeat them.
type matchCursor struct {
	GameID   *string `json:"game_id,omitempty"`
	PlayerID *string `json:"player_id,omitempty"`
	ClubID   *string `json:"club_id,omitempty"`
	NoClub   bool    `json:"no_club,omitempty"`
	Date     string  `json:"date"` // RFC3339Nano — date of the last returned match
}

func encodeMatchCursor(gameID *string, playerID *string, clubID *string, noClub bool, date time.Time) string {
	c := matchCursor{Date: date.UTC().Format(time.RFC3339Nano), NoClub: noClub}
	c.GameID = gameID
	c.PlayerID = playerID
	c.ClubID = clubID
	b, _ := json.Marshal(c)
	return base64.StdEncoding.EncodeToString(b)
}

// decodeMatchCursor returns gameID, playerID, clubID, noClub, cursorDate decoded from the token.
func decodeMatchCursor(token string) (*string, *string, *string, bool, pgtype.Timestamptz, error) {
	b, err := base64.StdEncoding.DecodeString(token)
	if err != nil {
		return nil, nil, nil, false, pgtype.Timestamptz{}, err
	}
	var c matchCursor
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, nil, nil, false, pgtype.Timestamptz{}, err
	}
	t, err := time.Parse(time.RFC3339Nano, c.Date)
	if err != nil {
		return nil, nil, nil, false, pgtype.Timestamptz{}, err
	}
	return c.GameID, c.PlayerID, c.ClubID, c.NoClub, pgtype.Timestamptz{Time: t, Valid: true}, nil
}

// groupMatchRows converts a slice of rows (each row = one player in a match) into
// ordered match groups. Returns the matches map and ID-ordered slice.
type tempMatch struct {
	Id             string
	GameId         string
	GameName       string
	Date           time.Time
	Players        map[string]matchPlayerJson
	HasMarkets     bool
	CalculatorKind pgtype.Text
	// CalculatorData is only populated on the GetMatchById path; the paginated
	// list query deliberately omits the (potentially large) JSONB column.
	CalculatorData json.RawMessage
}

func buildMatchesResponse(matchesMap map[string]*tempMatch, order []string) []matchJson {
	matchesJson := make([]matchJson, 0, len(order))
	for _, mid := range order {
		tm := matchesMap[mid]
		m := matchJson{
			Id:             tm.Id,
			GameId:         tm.GameId,
			GameName:       tm.GameName,
			Date:           tm.Date,
			Players:        make(map[string]matchPlayerJson, len(tm.Players)),
			HasMarkets:     tm.HasMarkets,
			CalculatorKind: tm.CalculatorKind,
			CalculatorData: tm.CalculatorData,
		}
		for pid, playerData := range tm.Players {
			m.Players[pid] = playerData
		}
		matchesJson = append(matchesJson, m)
	}
	return matchesJson
}

func (a *API) ListMatches(c *gin.Context) {
	var gameID *string
	var playerID *string
	var clubID *string
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
			gameID = &gStr
		}
		if pStr := c.Query("player_id"); pStr != "" {
			playerID = &pStr
		}
		if cStr := c.Query("club_id"); cStr == "__no_club__" {
			noClub = true
		} else if cStr != "" {
			clubID = &cStr
		}
	}

	// Parse page size (always from query string).
	limit := int32(30)
	if lStr := c.Query("limit"); lStr != "" {
		var l int32
		if _, err := fmt.Sscanf(lStr, "%d", &l); err == nil && l > 0 && l <= 100 {
			limit = l
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

	matchesMap := make(map[string]*tempMatch)
	order := make([]string, 0)

	for _, r := range rows {
		if _, ok := matchesMap[r.MatchID]; !ok {
			matchesMap[r.MatchID] = &tempMatch{
				Id:         r.MatchID,
				GameId:     r.GameID,
				GameName:   r.GameName,
				Date:       r.Date.Time,
				Players:    make(map[string]matchPlayerJson),
				HasMarkets: r.HasMarkets,
			}
			order = append(order, r.MatchID)
		}

		m := matchesMap[r.MatchID]
		var ratingAfter float64
		if v, ok := r.RatingAfter.(float64); ok {
			ratingAfter = v
		}
		m.Players[r.PlayerID] = matchPlayerJson{
			Score:        r.Score,
			RatingStaked: r.RatingStaked.Float64,
			RatingEarned: r.RatingEarned.Float64,
			RatingAfter:  ratingAfter,
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
	matchID := c.Param("id")

	rows, err := a.Queries.GetMatchWithPlayers(c.Request.Context(), matchID)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, err)
		return
	}
	if len(rows) == 0 {
		ErrorResponse(c, http.StatusNotFound, "Match not found")
		return
	}

	matchesMap := make(map[string]*tempMatch)
	order := make([]string, 0)
	for _, r := range rows {
		if _, ok := matchesMap[r.MatchID]; !ok {
			matchesMap[r.MatchID] = &tempMatch{
				Id:       r.MatchID,
				GameId:   r.GameID,
				GameName: r.GameName,
				Date:     r.Date.Time,
				Players:  make(map[string]matchPlayerJson),
			}
			order = append(order, r.MatchID)
		}
		m := matchesMap[r.MatchID]
		var ratingAfter float64
		if v, ok := r.RatingAfter.(float64); ok {
			ratingAfter = v
		}
		m.Players[r.PlayerID] = matchPlayerJson{
			Score:        r.Score,
			RatingStaked: r.RatingStaked.Float64,
			RatingEarned: r.RatingEarned.Float64,
			RatingAfter:  ratingAfter,
		}
	}

	result := buildMatchesResponse(matchesMap, order)
	SuccessDataResponse(c, result[0])
}
