package elo

import (
	"context"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/db"
)

// MatchInfo holds derived match data for market resolution evaluation.
type MatchInfo struct {
	Match          db.Match
	ParticipantSet map[string]bool
	PlayerScoreMap map[string]float64
	MaxScore       float64
}

// SoleWinnerID returns the single player holding the strict maximum score of
// the match. When two or more players share the top score (a tie), there is no
// sole winner and ok is false.
func (m MatchInfo) SoleWinnerID() (string, bool) {
	count := 0
	winner := ""
	for pid, score := range m.PlayerScoreMap {
		if score >= m.MaxScore {
			count++
			winner = pid
		}
	}
	return winner, count == 1
}

// SettleFunc settles a market with a given outcome within an active transaction.
type SettleFunc func(ctx context.Context, q *db.Queries, marketID string, outcome MarketOutcome, resolvedAt time.Time, resolutionMatchID *string) error

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
	CreateParams(ctx context.Context, q *db.Queries, marketID string, params CreateMarketParams) error

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
// One "player wins" outcome is created per target player plus the "other"
// outcome (ties / non-target winners); with AllowOtherPlayers=false the market
// only resolves matches consisting of exactly the target players.
type MatchWinnerCreateParams struct {
	TargetPlayerIDs   []string
	AllowOtherPlayers bool
	GameIDs           []string
}

// WinStreakCreateParams holds creation parameters for a win_streak market.
type WinStreakCreateParams struct {
	TargetPlayerID string
	GameIDs        []string
	WinsRequired   int32
	MaxLosses      *int32
}
