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
type SettleFunc func(ctx context.Context, q *db.Queries, marketID int32, outcome string, resolvedAt time.Time, resolutionMatchID *int32) error

// MarketTypeHandler encapsulates all type-specific behavior for a market type.
type MarketTypeHandler interface {
	// CreateParams stores type-specific parameters in the DB within a transaction.
	CreateParams(ctx context.Context, q *db.Queries, marketID int32, params CreateMarketParams) error

	// TriggerResolutionForMatch evaluates all open markets of this type against the match.
	// Must be called within an active transaction.
	TriggerResolutionForMatch(ctx context.Context, q *db.Queries, match MatchInfo, settle SettleFunc) error

	// ExpireResolve settles all overdue markets of this type.
	// Must be called within an active transaction.
	ExpireResolve(ctx context.Context, q *db.Queries, settle SettleFunc) error
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
