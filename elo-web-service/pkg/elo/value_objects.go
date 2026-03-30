package elo

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

// EloSettings holds the Elo calculation constants effective at a point in time.
type EloSettings struct {
	K           float64
	D           float64
	StartingElo float64
	WinReward   float64
}

// EloSettingsFromDB converts a sqlc-generated row to a domain value object,
// decoupling the domain from the generated DB type.
func EloSettingsFromDB(row db.GetEloSettingsForDateRow) EloSettings {
	return EloSettings{
		K:           row.EloConstK,
		D:           row.EloConstD,
		StartingElo: row.StartingElo,
		WinReward:   row.WinReward,
	}
}

// EloCalcFunc is the signature for functions that compute and persist Elo for one match.
// Using a named type avoids repeating the long anonymous function signature at every call site.
type EloCalcFunc func(
	ctx context.Context,
	q *db.Queries,
	matchID, gameID int32,
	playerScores, previousElo, previousGameElo map[int32]float64,
	settings EloSettings,
) error

// TimeWindow is a closed time interval used to constrain market resolution.
type TimeWindow struct {
	StartsAt time.Time
	ClosesAt time.Time
}

// Contains reports whether t falls within the closed interval [StartsAt, ClosesAt].
func (w TimeWindow) Contains(t time.Time) bool {
	return !t.Before(w.StartsAt) && !t.After(w.ClosesAt)
}

// MarketOutcome is the string identifier of the winning outcome of a market.
// For binary markets: OutcomeYes / OutcomeNo.
// For N-outcome markets: any free-text label (e.g. "player_42").
// OutcomeCancelled is a special value that returns all stakes without redistribution.
type MarketOutcome string

const (
	OutcomeCancelled MarketOutcome = "cancelled"
	OutcomeYes       MarketOutcome = "yes"
	OutcomeNo        MarketOutcome = "no"
)

// statusForOutcome maps a MarketOutcome to the new two-value market status.
func statusForOutcome(o MarketOutcome) string {
	if o == OutcomeCancelled {
		return "cancelled"
	}
	return "resolved"
}

// validateMatchDateChange returns ErrDateChangeTooLarge if the date shift exceeds 3 days.
func validateMatchDateChange(old, new time.Time) error {
	d := new.Sub(old)
	if d > 3*24*time.Hour || d < -3*24*time.Hour {
		return fmt.Errorf("%w: old=%v new=%v", ErrDateChangeTooLarge, old, new)
	}
	return nil
}

// pgInt4ToPtr converts a nullable pgtype.Int4 to *int32 (nil when not valid).
func pgInt4ToPtr(v pgtype.Int4) *int32 {
	if !v.Valid {
		return nil
	}
	return &v.Int32
}
