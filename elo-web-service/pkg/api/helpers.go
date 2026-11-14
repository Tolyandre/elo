package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
	elo "github.com/tolyandre/elo-web-service/pkg/elo"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// This file holds cross-cutting helpers, types, and middleware that live outside
// the oapi-codegen strict-server layer but are shared across the handler files.
// They were extracted from the legacy gin handlers during the strict-server
// migration; see ADR / git history for the originals.

// Envelope status values shared by every JSON response (the ApiError and
// ApiSuccessMessage schemas in openapi/common.yaml). Untyped so they assign to
// both the plain `string` Status fields and the generated enum types.
const (
	StatusSuccess = "success"
	StatusFail    = "fail"
)

// ---------------------------------------------------------------------------
// Auth context helpers & middleware (extracted from the former users.go).
// ---------------------------------------------------------------------------

const CurrentUserKey = "currentUser"

// CanonicalizeUserID resolves a JWT "sub" claim to the canonical UUID form.
// Post-migration JWTs already carry a UUID and pass through unchanged. Stale
// pre-migration JWTs carry a bare SERIAL int (e.g. "1"); it is mapped via the
// deterministic int_to_uuid scheme from migration 036 / ADR-08 so it resolves to
// the backfilled users.id. Removable once all legacy JWTs have rotated.
func CanonicalizeUserID(sub string) id.ID {
	if _, err := uuid.Parse(sub); err == nil {
		return id.ID(sub)
	}
	if n, err := strconv.ParseInt(sub, 10, 32); err == nil {
		return id.ID(fmt.Sprintf("00000000-0000-0000-0000-%012x", uint32(n)))
	}
	return id.ID(sub) // let downstream reject it
}

func MustGetCurrentUserId(ctx *gin.Context) (id.ID, error) {
	userID := ctx.MustGet(CurrentUserKey)

	uid, ok := userID.(string)
	if !ok {
		err := fmt.Errorf("invalid user id in context: %v", userID)
		ErrorResponse(ctx, http.StatusInternalServerError, err)
		return "", err
	}

	return id.ID(uid), nil
}

func MustGetCurrentUser(ctx *gin.Context, userService elo.IUserService) (*db.User, error) {
	userID := ctx.MustGet(CurrentUserKey)

	uid, ok := userID.(string)
	if !ok {
		return nil, fmt.Errorf("invalid user id in context: %v", userID)
	}

	user, err := userService.GetUserByID(ctx, id.ID(uid))

	if db.IsNoRows(err) {
		return nil, fmt.Errorf("user not found: %w", err)
	}

	if err != nil {
		return nil, err
	}

	return user, nil
}

// errAuthRequired marks a missing or dangling session (requireUser); the
// handler maps it to its typed 401 response.
var errAuthRequired = errors.New("authentication required")

// requireUser resolves the authenticated user for a strict handler. A session
// referencing a missing user is an invalid session, reported as
// errAuthRequired; other errors are internal.
func (s *StrictServer) requireUser(ctx context.Context) (*db.User, error) {
	ginCtx := ginCtxFromContext(ctx)
	if ginCtx == nil {
		return nil, fmt.Errorf("no gin context in request")
	}
	user, err := MustGetCurrentUser(ginCtx, s.api.UserService)
	if err != nil && domainStatusCode(err) == http.StatusNotFound {
		return nil, errAuthRequired
	}
	return user, err
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
		c.Set(CurrentPlayerIDKey, string(*user.PlayerID))
		c.Next()
	}
}

// MustGetCurrentPlayerID retrieves the player ID set by RequirePlayerID middleware.
func MustGetCurrentPlayerID(c *gin.Context) id.ID {
	return id.ID(c.MustGet(CurrentPlayerIDKey).(string))
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
func tryGetCurrentUserID(ctx *gin.Context) (id.ID, bool) {
	val, exists := ctx.Get(CurrentUserKey)
	if !exists {
		return "", false
	}
	uid, ok := val.(string)
	if !ok {
		return "", false
	}
	return id.ID(uid), true
}

// currentActorID resolves the authenticated user from a strict handler's
// context for the audit log (ADR-14). Returns the zero id when the context
// carries no user (impossible behind editorAuth in practice) — recordAudit
// then skips the audit row rather than failing the write.
func currentActorID(ctx context.Context) id.ID {
	ginCtx := ginCtxFromContext(ctx)
	if ginCtx == nil {
		return ""
	}
	uid, err := MustGetCurrentUserId(ginCtx)
	if err != nil {
		return ""
	}
	return uid
}

// ---------------------------------------------------------------------------
// Match helpers (extracted from the former matches.go).
// ---------------------------------------------------------------------------

type matchPlayerJson struct {
	// The settlement columns are nil when the match did not settle in the
	// display arena — the arena's openness rule does not admit it (ADR-36);
	// the wire form is null, not zero.
	RatingStaked *float64 `json:"rating_staked"`
	RatingEarned *float64 `json:"rating_earned"`
	Score        float64  `json:"score"`
	RatingAfter  *float64 `json:"rating_after"`
}

type matchJson struct {
	Id             id.ID                     `json:"id"`
	GameId         id.ID                     `json:"game_id"`
	GameName       string                    `json:"game_name"`
	Date           time.Time                 `json:"date"`
	Players        map[id.ID]matchPlayerJson `json:"score"`
	HasMarkets     bool                      `json:"has_markets"`
	Mode           string                    `json:"mode"`
	GameScore      pgtype.Float8             `json:"game_score"`
	GameWon        pgtype.Bool               `json:"game_won"`
	CalculatorKind pgtype.Text               `json:"-"`
	// CalculatorData is omitted on the list path (the paginated query does not
	// select it to avoid pulling large JSONB for every list row).
	CalculatorData json.RawMessage `json:"-"`
}

// parseMatchScores validates that the game_id and player_ids are present.
// Inbound body ids are already canonical (IDMap.UnmarshalJSON). The score map
// is optional: coop matches (ADR-33) carry player_ids instead.
func parseMatchScores(gameID id.ID, scores *IDMap[float64]) (id.ID, map[id.ID]float64, error) {
	if gameID.IsZero() {
		return "", nil, fmt.Errorf("invalid game_id: %s", gameID)
	}
	playerScores := make(map[id.ID]float64)
	if scores != nil {
		for k, v := range *scores {
			if k.IsZero() {
				return "", nil, fmt.Errorf("invalid player_id: %s", k)
			}
			playerScores[k] = v
		}
	}
	return gameID, playerScores, nil
}

// rfc3339Time is a cursor timestamp that (un)marshals as an RFC3339Nano
// string — the shared encoding of every cursor payload.
type rfc3339Time time.Time

func (t rfc3339Time) MarshalJSON() ([]byte, error) {
	return json.Marshal(time.Time(t).UTC().Format(time.RFC3339Nano))
}

func (t *rfc3339Time) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	parsed, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		return err
	}
	*t = rfc3339Time(parsed)
	return nil
}

// encodeCursorToken base64-encodes a cursor payload (continuation tokens are
// opaque base64 JSON everywhere).
func encodeCursorToken(payload any) string {
	b, _ := json.Marshal(payload)
	return base64.StdEncoding.EncodeToString(b)
}

// decodeCursorToken decodes a cursor payload; any malformation (bad base64,
// bad JSON, bad embedded timestamp) is the caller's 400 "Invalid cursor".
func decodeCursorToken[T any](token string) (T, error) {
	var c T
	raw, err := base64.StdEncoding.DecodeString(token)
	if err != nil {
		return c, err
	}
	err = json.Unmarshal(raw, &c)
	return c, err
}

// pageLimit clamps an optional ?limit= into the 1..100 window with def as the
// page-1 default (the shared pagination convention).
func pageLimit(p *int, def int32) int32 {
	if p != nil && *p > 0 && *p <= 100 {
		return int32(*p)
	}
	return def
}

// matchCursor is the continuation token encoded as base64 JSON.
// It embeds all search parameters so the client doesn't need to repeat them.
type matchCursor struct {
	GameID       *string     `json:"game_id,omitempty"`
	PlayerID     *string     `json:"player_id,omitempty"`
	ClubID       *string     `json:"club_id,omitempty"`
	TournamentID *string     `json:"tournament_id,omitempty"`
	NoClub       bool        `json:"no_club,omitempty"`
	Date         rfc3339Time `json:"date"` // date of the last returned match
}

func encodeMatchCursor(gameID *string, playerID *string, clubID *string, tournamentID *string, noClub bool, date time.Time) string {
	return encodeCursorToken(matchCursor{
		GameID:       gameID,
		PlayerID:     playerID,
		ClubID:       clubID,
		TournamentID: tournamentID,
		NoClub:       noClub,
		Date:         rfc3339Time(date),
	})
}

// decodeMatchCursor returns gameID, playerID, clubID, tournamentID, noClub,
// cursorDate decoded from the token.
func decodeMatchCursor(token string) (*string, *string, *string, *string, bool, pgtype.Timestamptz, error) {
	c, err := decodeCursorToken[matchCursor](token)
	if err != nil {
		return nil, nil, nil, nil, false, pgtype.Timestamptz{}, err
	}
	return c.GameID, c.PlayerID, c.ClubID, c.TournamentID, c.NoClub, pgtype.Timestamptz{Time: time.Time(c.Date), Valid: true}, nil
}

// tempMatch is an intermediate grouping for converting flat query rows into
// ordered match groups.
type tempMatch struct {
	Id             id.ID
	GameId         id.ID
	GameName       string
	Date           time.Time
	Players        map[id.ID]matchPlayerJson
	HasMarkets     bool
	Mode           string
	GameScore      pgtype.Float8
	GameWon        pgtype.Bool
	CalculatorKind pgtype.Text
	// CalculatorData is only populated on the GetMatchById path; the paginated
	// list query deliberately omits the (potentially large) JSONB column.
	CalculatorData json.RawMessage
}

func buildMatchesResponse(matchesMap map[id.ID]*tempMatch, order []id.ID) []matchJson {
	matchesJson := make([]matchJson, 0, len(order))
	for _, mid := range order {
		tm := matchesMap[mid]
		m := matchJson{
			Id:             tm.Id,
			GameId:         tm.GameId,
			GameName:       tm.GameName,
			Date:           tm.Date,
			Players:        make(map[id.ID]matchPlayerJson, len(tm.Players)),
			HasMarkets:     tm.HasMarkets,
			Mode:           tm.Mode,
			GameScore:      tm.GameScore,
			GameWon:        tm.GameWon,
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

// matchRowParts is the shared column set of the three generated match row
// shapes (paginated list, get-by-id, feed payload); the assembler is written
// once against it. CalculatorData is only selected by the get-by-id query.
type matchRowParts struct {
	MatchID        id.ID
	Date           time.Time
	GameID         id.ID
	GameName       string
	CalculatorKind pgtype.Text
	CalculatorData json.RawMessage
	Mode           string
	GameScore      pgtype.Float8
	GameWon        pgtype.Bool
	PlayerID       id.ID
	Score          float64
	RatingStaked   pgtype.Float8
	RatingEarned   pgtype.Float8
	RatingAfter    interface{}
	HasMarkets     bool
}

// groupMatchRows folds flat per-player rows into ordered match groups (the
// shape buildMatchesResponse consumes), grouped by MatchID in
// first-appearance order.
func groupMatchRows[R any](rows []R, part func(*R) matchRowParts) (map[id.ID]*tempMatch, []id.ID) {
	matchesMap := make(map[id.ID]*tempMatch)
	order := make([]id.ID, 0)
	for i := range rows {
		p := part(&rows[i])
		tm := matchesMap[p.MatchID]
		if tm == nil {
			tm = &tempMatch{
				Id:             p.MatchID,
				GameId:         p.GameID,
				GameName:       p.GameName,
				Date:           p.Date,
				Players:        make(map[id.ID]matchPlayerJson),
				HasMarkets:     p.HasMarkets,
				Mode:           p.Mode,
				GameScore:      p.GameScore,
				GameWon:        p.GameWon,
				CalculatorKind: p.CalculatorKind,
				CalculatorData: p.CalculatorData,
			}
			matchesMap[p.MatchID] = tm
			order = append(order, p.MatchID)
		}
		tm.Players[p.PlayerID] = matchPlayerJson{
			Score:        p.Score,
			RatingStaked: float8Ptr(p.RatingStaked),
			RatingEarned: float8Ptr(p.RatingEarned),
			RatingAfter:  anyFloatPtr(p.RatingAfter),
		}
	}
	return matchesMap, order
}

// ---------------------------------------------------------------------------
// Player helper (extracted from the former players.go).
// ---------------------------------------------------------------------------

// idPtr converts an optional canonical-id string (e.g. from an internal cursor
// token) to *id.ID; strPtr is the inverse. Cursors embed ids in their canonical
// form as plain strings — an id.ID field would marshal to its short wire form.
func idPtr(s *string) *id.ID {
	if s == nil {
		return nil
	}
	v := id.ID(*s)
	return &v
}

// tenantIDPtr exposes the tenant feed's owning tenant for the cursor token
// (the feed's identity, baked like the arena feed's filters).
func tenantIDPtr(req feedRequest) *string {
	if !req.tenantFeed {
		return nil
	}
	v := string(req.feedTenantID)
	return &v
}

func strPtr(v *id.ID) *string {
	if v == nil {
		return nil
	}
	s := string(*v)
	return &s
}

// ---------------------------------------------------------------------------
// Market helpers (extracted from the former markets.go).
// ---------------------------------------------------------------------------

// marketGuarantees loads a market's guarantor wagers (with the derived
// market-level maker fee) for the Market response. Returns nil (omitted from
// JSON) on error or when the market has no wagers yet, so a read failure never
// breaks the payload.
func (s *StrictServer) marketGuarantees(ctx context.Context, marketID id.ID) (*[]MarketGuarantee, *float64) {
	rows, err := s.api.MarketQueries.ListMarketGuarantees(ctx, marketID)
	if err != nil || len(rows) == 0 {
		return nil, nil
	}
	wagers := make([]elo.GuaranteeWager, len(rows))
	out := make([]MarketGuarantee, 0, len(rows))
	for i, r := range rows {
		wagers[i] = elo.GuaranteeWager{
			ID:         r.ID,
			PlayerID:   r.PlayerID,
			RiskAmount: r.RiskAmount,
			FeeRate:    r.FeeRate,
			CreatedAt:  r.CreatedAt,
		}
		out = append(out, MarketGuarantee{
			Id:         r.ID,
			PlayerId:   r.PlayerID,
			PlayerName: r.PlayerName,
			RiskAmount: r.RiskAmount,
			FeeRate:    r.FeeRate,
			PlacedAt:   r.CreatedAt,
		})
	}
	feeRate := elo.MarketFeeRate(wagers)
	return &out, &feeRate
}

// parseIDParam converts a wire-form (Base58 or canonical) path/query parameter
// to its canonical id. Invalid values become the zero id, which no row matches,
// so the handler surfaces its existing not-found response.
func parseIDParam(s string) id.ID {
	parsed, err := id.ParseTolerant(s)
	if err != nil {
		return ""
	}
	return parsed
}

// errTenantRequired marks a tenant-scoped read that arrived without its
// ?tenant= parameter (ADR-36 phase 5: reads are tenant-scoped, there is no
// global default).
var errTenantRequired = errors.New("tenant query parameter is required")

// resolveDisplayArena resolves the display arena behind a request's ?tenant=
// query parameter (ADR-36): the tenant's main arena. An empty value is
// errTenantRequired (400); a named but missing tenant yields no rows
// (db.ErrNoRows) — the caller maps that to its 404 response.
func (s *StrictServer) resolveDisplayArena(ctx context.Context, tenant string) (id.ID, error) {
	if tenant == "" {
		return "", errTenantRequired
	}
	return s.api.TenantService.FeedArena(ctx, parseIDParam(tenant))
}

// derefIDs returns the pointed-to id slice, or nil if the pointer is nil.
func derefIDs(s *[]id.ID) []id.ID {
	if s == nil {
		return nil
	}
	return *s
}

func float8Ptr(v pgtype.Float8) *float64 {
	if !v.Valid {
		return nil
	}
	f := v.Float64
	return &f
}

// anyFloatPtr narrows a nullable float column scanned into interface{} (the
// sqlc CASE trick); any non-float64 value — nil included — reads as absent.
func anyFloatPtr(v interface{}) *float64 {
	f, ok := v.(float64)
	if !ok {
		return nil
	}
	return &f
}

func boolPtr(v pgtype.Bool) *bool {
	if !v.Valid {
		return nil
	}
	b := v.Bool
	return &b
}

// timePtr shapes a nullable timestamp column for the response (null when
// absent); optID copies an optional id so callers don't alias row memory.
func timePtr(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	v := t.Time
	return &v
}

func optID(v *id.ID) *id.ID {
	if v == nil {
		return nil
	}
	c := *v
	return &c
}
