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

	// Newbie league earned scaling parameters.
	NewbieLeagueEarnedMin float64
	NewbieLeagueEarnedMax float64
	NewbieLeagueEarnedTau float64
	NewbieLeagueGoalGap   float64 // gap threshold for newbie → amateur promotion

	// Starting display rating per arena type.
	StartingRatingGlobal float64
	StartingRatingGame   float64

	EliteMatches6M int
	EliteMatches2M int
}

// EloSettingsFromDB converts a sqlc-generated row to a domain value object,
// decoupling the domain from the generated DB type.
func EloSettingsFromDB(row db.GetEloSettingsForDateRow) EloSettings {
	return EloSettings{
		K:             row.EloConstK,
		D:             row.EloConstD,
		StartingElo:   row.StartingElo,
		WinReward:     row.WinReward,
		NewbieLeagueEarnedMin: row.NewbieLeagueEarnedMin,
		NewbieLeagueEarnedMax: row.NewbieLeagueEarnedMax,
		NewbieLeagueEarnedTau: row.NewbieLeagueEarnedTau,
		NewbieLeagueGoalGap:   row.NewbieLeagueGoalGap,
		StartingRatingGlobal:  row.StartingRatingGlobalArena,
		StartingRatingGame:    row.StartingRatingGameArena,
		EliteMatches6M:   int(row.EliteLeagueMatches6months),
		EliteMatches2M:   int(row.EliteLeagueMatches2months),
	}
}

// MatchPrevState bundles all per-player prior state needed to compute one match's settlements.
type MatchPrevState struct {
	Elo        map[int32]float64 // true global Elo before this match
	GameElo    map[int32]float64 // true game Elo before this match
	Rating     map[int32]float64 // display global rating before this match
	GameRating map[int32]float64 // display game rating before this match
	League     map[int32]string  // global league before this match ("newbie"/"amateur"/"elite")
	GameLeague map[int32]string  // game league before this match ("newbie"/"amateur")

	// Elite promotion match counts for the match date (includes the current match).
	Count6M map[int32]int // matches in last 6 months
	Count2M map[int32]int // matches in last 2 months

	Settings EloSettings
}

// EloCalcFunc is the signature for functions that compute and persist Elo for one match.
// Using a named type avoids repeating the long anonymous function signature at every call site.
type EloCalcFunc func(
	ctx context.Context,
	q *db.Queries,
	matchID, gameID int32,
	playerScores map[int32]float64,
	state MatchPrevState,
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

// newMatchMaxAge limits how far in the past a client-supplied match date may be.
// Covers offline-created matches synced after a long stretch without network.
const newMatchMaxAge = 30 * 24 * time.Hour

// newMatchClockSkewTolerance allows slightly-future dates from devices with a fast clock.
const newMatchClockSkewTolerance = 10 * time.Minute

// validateNewMatchDate returns ErrMatchDateOutOfRange if a client-supplied date
// for a new match is in the future (beyond clock-skew tolerance) or older than 30 days.
func validateNewMatchDate(now, date time.Time) error {
	if date.After(now.Add(newMatchClockSkewTolerance)) || date.Before(now.Add(-newMatchMaxAge)) {
		return fmt.Errorf("%w: now=%v date=%v", ErrMatchDateOutOfRange, now, date)
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
