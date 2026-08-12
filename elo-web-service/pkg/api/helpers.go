package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
	elo "github.com/tolyandre/elo-web-service/pkg/elo"
)

// This file holds cross-cutting helpers, types, and middleware that live outside
// the oapi-codegen strict-server layer but are shared across the handler files.
// They were extracted from the legacy gin handlers during the strict-server
// migration; see ADR / git history for the originals.

// ---------------------------------------------------------------------------
// Auth context helpers & middleware (extracted from the former users.go).
// ---------------------------------------------------------------------------

const CurrentUserKey = "currentUser"

// CanonicalizeUserID resolves a JWT "sub" claim to the canonical UUID form.
// Post-migration JWTs already carry a UUID and pass through unchanged. Stale
// pre-migration JWTs carry a bare SERIAL int (e.g. "1"); it is mapped via the
// deterministic int_to_uuid scheme from migration 036 / ADR-08 so it resolves to
// the backfilled users.id. Removable once all legacy JWTs have rotated.
func CanonicalizeUserID(id string) string {
	if _, err := uuid.Parse(id); err == nil {
		return id
	}
	if n, err := strconv.ParseInt(id, 10, 32); err == nil {
		return fmt.Sprintf("00000000-0000-0000-0000-%012x", uint32(n))
	}
	return id // let downstream reject it
}

func MustGetCurrentUserId(ctx *gin.Context) (string, error) {
	userID := ctx.MustGet(CurrentUserKey)

	id, ok := userID.(string)
	if !ok {
		err := fmt.Errorf("invalid user id in context: %v", userID)
		ErrorResponse(ctx, http.StatusInternalServerError, err)
		return "", err
	}

	return id, nil
}

func MustGetCurrentUser(ctx *gin.Context, userService elo.IUserService) (*db.User, error) {
	userID := ctx.MustGet(CurrentUserKey)

	id, ok := userID.(string)
	if !ok {
		return nil, fmt.Errorf("invalid user id in context: %v", userID)
	}

	user, err := userService.GetUserByID(ctx, id)

	if db.IsNoRows(err) {
		return nil, fmt.Errorf("user not found: %w", err)
	}

	if err != nil {
		return nil, err
	}

	return user, nil
}

const CurrentPlayerIDKey = "currentPlayerID"

// RequirePlayerID is a Gin middleware that aborts with 403 if the authenticated
// user has no player_id linked. On success it sets CurrentPlayerIDKey in context.
func (a *API) RequirePlayerID() gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := MustGetCurrentUser(c, a.UserService)
		if err != nil {
			ErrorResponse(c, http.StatusUnauthorized, "authentication required")
			c.Abort()
			return
		}
		if user.PlayerID == nil {
			ErrorResponse(c, http.StatusForbidden, "player association required to use game tables")
			c.Abort()
			return
		}
		c.Set(CurrentPlayerIDKey, *user.PlayerID)
		c.Next()
	}
}

// MustGetCurrentPlayerID retrieves the player ID set by RequirePlayerID middleware.
func MustGetCurrentPlayerID(c *gin.Context) string {
	return c.MustGet(CurrentPlayerIDKey).(string)
}

// RequireEditor is a Gin middleware that aborts with 403 if the authenticated
// user does not have AllowEditing permission.
func (a *API) RequireEditor() gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := MustGetCurrentUser(c, a.UserService)
		if err != nil {
			ErrorResponse(c, http.StatusInternalServerError, err)
			c.Abort()
			return
		}
		if !user.AllowEditing {
			ErrorResponse(c, http.StatusForbidden, "You are not authorized to perform this action")
			c.Abort()
			return
		}
		c.Next()
	}
}

// tryGetCurrentUserID returns the user ID from context if present (extracted from
// the former markets.go). Used by handlers behind OptionalDeserializeUser.
func tryGetCurrentUserID(ctx *gin.Context) (string, bool) {
	val, exists := ctx.Get(CurrentUserKey)
	if !exists {
		return "", false
	}
	id, ok := val.(string)
	if !ok {
		return "", false
	}
	return id, true
}

// ---------------------------------------------------------------------------
// Match helpers (extracted from the former matches.go).
// ---------------------------------------------------------------------------

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

// tempMatch is an intermediate grouping for converting flat query rows into
// ordered match groups.
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

// ---------------------------------------------------------------------------
// Player helper (extracted from the former players.go).
// ---------------------------------------------------------------------------

func findPlayer(players []elo.Player, id string) *elo.Player {
	for _, player := range players {
		if player.ID == id {
			return &player
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Market helpers (extracted from the former markets.go).
// ---------------------------------------------------------------------------

// marketGuarantors loads a market's guarantor players for the Market response.
// Returns nil (omitted from JSON) on error so a read failure never breaks the payload.
func (s *StrictServer) marketGuarantors(ctx context.Context, marketID string) *[]MarketsMarketGuarantor {
	rows, err := s.api.MarketService.ListMarketGuarantors(ctx, marketID)
	if err != nil || len(rows) == 0 {
		return nil
	}
	out := make([]MarketsMarketGuarantor, 0, len(rows))
	for _, r := range rows {
		out = append(out, MarketsMarketGuarantor{PlayerId: r.PlayerID, PlayerName: r.PlayerName})
	}
	return &out
}
