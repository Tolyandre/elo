package elo

import (
	"context"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/db"
)

// MatchInfo holds derived match data for market resolution evaluation.
type MatchInfo struct {
	Match          db.Match
	ParticipantSet map[int32]bool
	PlayerScoreMap map[int32]float64
	MaxScore       float64
}

// SettleFunc settles a market with a given outcome within an active transaction.
type SettleFunc func(ctx context.Context, q *db.Queries, marketID int32, outcome MarketOutcome, resolvedAt time.Time, resolutionMatchID *int32) error

// ResolutionTrigger describes when and how markets of a given type are resolved.
// Implementations must be safe to call as no-ops when the trigger type does not respond
// to a particular event (e.g. a match-based trigger should ignore time expiry calls).
type ResolutionTrigger interface {
	// OnMatch is called inside a transaction after every match is settled.
	// Must settle any open markets whose condition is now met.
	OnMatch(ctx context.Context, q *db.Queries, match MatchInfo, settle SettleFunc) error

	// OnTimeExpiry is called during sequential event replay with a cutoff date.
	// Must settle markets whose closes_at <= cutoff.
	OnTimeExpiry(ctx context.Context, q *db.Queries, cutoff time.Time, settle SettleFunc) error

	// OnOverdue is called by the background timer outside of event replay.
	// Must settle all currently overdue open markets.
	OnOverdue(ctx context.Context, q *db.Queries, settle SettleFunc) error
}

// MarketTypeHandler encapsulates all type-specific behavior for a market type.
type MarketTypeHandler interface {
	// CreateParams stores type-specific parameters in the DB within a transaction.
	CreateParams(ctx context.Context, q *db.Queries, marketID int32, params CreateMarketParams) error

	// ResolutionTrigger returns the strategy that decides when and how markets of
	// this type are resolved. Called once per handler; the result may be cached.
	ResolutionTrigger() ResolutionTrigger
}

// marketTypeHandlers is the registry of all known market type handlers.
var marketTypeHandlers = map[string]MarketTypeHandler{
	"match_winner": &matchWinnerHandler{},
	"win_streak":   &winStreakHandler{},
}

// MatchWinnerCreateParams holds creation parameters for a match_winner market.
type MatchWinnerCreateParams struct {
	TargetPlayerID    int32
	RequiredPlayerIDs []int32
	GameID            *int32
}

// WinStreakCreateParams holds creation parameters for a win_streak market.
type WinStreakCreateParams struct {
	TargetPlayerID int32
	GameID         int32
	WinsRequired   int32
	MaxLosses      *int32
}
