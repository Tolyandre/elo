package elo

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

// UserEvent is an event created by a user, ordered strictly chronologically.
// Events with the same date are ordered by ID ascending.
type UserEvent interface {
	UserEventDate() time.Time
	UserEventID() int32
}

// MatchEvent wraps a db.Match as a UserEvent.
type MatchEvent struct{ db.Match }

func (e MatchEvent) UserEventDate() time.Time { return e.Date.Time }
func (e MatchEvent) UserEventID() int32       { return e.ID }

// Settlement is a derived computation triggered by a user event.
type Settlement interface {
	Apply(ctx context.Context, q *db.Queries) error
}

// EventProcessor applies settlements for match events in the order defined by the ADR:
// 1. Rating from match   (rating_pay/earn → player_ratings)
// 2. game_elo            (match_scores game_elo_* fields)
// 3. Market resolution   (match-triggered) → SettleMarket (handles step 4: rating update)
// 5. Time-based expiry   (closes_at <= match.date) → SettleMarket (handles step 6: rating update)
//
// Steps 4 and 6 (rating from settlement) are performed inside SettleMarket.
type EventProcessor struct {
	MarketService IMarketService
}

// processMatchSettlements applies all settlements for a single match event.
func (p *EventProcessor) processMatchSettlements(
	ctx context.Context,
	q *db.Queries,
	matchID int32,
	gameID int32,
	playerScores map[int32]float64,
	previousElo map[int32]float64,
	previousGameElo map[int32]float64,
	settings db.GetEloSettingsForDateRow,
	matchDate time.Time,
	eloCalcFn func(ctx context.Context, q *db.Queries, matchID int32, gameID int32, playerScores map[int32]float64, previousElo map[int32]float64, previousGameElo map[int32]float64, eloConstK float64, eloConstD float64, startingElo float64, winReward float64) error,
) error {
	// Steps 1 & 2: Calculate and store/update rating + game_elo
	if err := eloCalcFn(ctx, q, matchID, gameID, playerScores, previousElo, previousGameElo,
		settings.EloConstK, settings.EloConstD, settings.StartingElo, settings.WinReward); err != nil {
		return fmt.Errorf("elo calc for match %d: %w", matchID, err)
	}

	// Steps 3 & 4: Match-triggered market resolution (SettleMarket applies rating inside)
	if err := p.MarketService.TriggerResolutionForMatch(ctx, q, matchID); err != nil {
		return fmt.Errorf("market resolution for match %d: %w", matchID, err)
	}

	// Steps 5 & 6: Time-based market expiry up to this match's date
	if err := p.MarketService.ExpireMarketsAtDate(ctx, q, matchDate); err != nil {
		return fmt.Errorf("expire markets at date %v: %w", matchDate, err)
	}

	return nil
}

// RecalculateFrom unsettle and reapply all settlements from startDate.
// Must be called within an active transaction.
func (p *EventProcessor) RecalculateFrom(
	ctx context.Context,
	q *db.Queries,
	startDate time.Time,
	calcAndUpdateElo func(ctx context.Context, q *db.Queries, matchID int32, gameID int32, playerScores map[int32]float64, previousElo map[int32]float64, previousGameElo map[int32]float64, eloConstK float64, eloConstD float64, startingElo float64, winReward float64) error,
	lockAndGetPrevElos func(ctx context.Context, q *db.Queries, match db.Match, playerScores map[int32]float64) (map[int32]float64, map[int32]float64, db.GetEloSettingsForDateRow, error),
) error {
	// Unsettle markets resolved by matches on/after startDate
	if err := p.MarketService.UnsettleMarketsFromDate(ctx, q, startDate); err != nil {
		return fmt.Errorf("unsettle markets: %w", err)
	}

	matches, err := q.GetMatchesFromDate(ctx, pgtype.Timestamptz{Time: startDate, Valid: true})
	if err != nil {
		return fmt.Errorf("get matches from date %v: %w", startDate, err)
	}

	allAffectedPlayers := make(map[int32]bool)

	for _, match := range matches {
		matchScores, err := q.GetMatchScoresForMatch(ctx, match.ID)
		if err != nil {
			return fmt.Errorf("get scores for match %d: %w", match.ID, err)
		}

		playerScores := make(map[int32]float64)
		for _, ms := range matchScores {
			playerScores[ms.PlayerID] = ms.Score
			allAffectedPlayers[ms.PlayerID] = true
		}

		previousElo, previousGameElo, settings, err := lockAndGetPrevElos(ctx, q, match, playerScores)
		if err != nil {
			return fmt.Errorf("lock/get prev elos for match %d: %w", match.ID, err)
		}

		if err := p.processMatchSettlements(ctx, q, match.ID, match.GameID, playerScores,
			previousElo, previousGameElo, settings, match.Date.Time, calcAndUpdateElo); err != nil {
			return err
		}
	}

	affectedIDs := make([]int32, 0, len(allAffectedPlayers))
	for pid := range allAffectedPlayers {
		affectedIDs = append(affectedIDs, pid)
	}
	if err := RecalculateBetLimits(ctx, q, affectedIDs); err != nil {
		return fmt.Errorf("recalculate bet limits: %w", err)
	}

	return nil
}
