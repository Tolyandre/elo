package elo

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// UserEvent is an event created by a user, ordered strictly chronologically.
// Events with the same date are ordered by ID ascending.
type UserEvent interface {
	UserEventDate() time.Time
	UserEventID() id.ID
}

// MatchEvent wraps a db.Match as a UserEvent.
type MatchEvent struct{ db.Match }

func (e MatchEvent) UserEventDate() time.Time { return e.Date.Time }
func (e MatchEvent) UserEventID() id.ID       { return e.ID }

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
// A coop match (ADR-33) settles nothing: the Elo step and match-triggered
// market resolution are skipped, but time-based market expiry still advances
// — the match is a point on the replay timeline regardless of its mode.
// settleElo=false (the club predicate keeps the match out of the global
// arena's rating, ADR-36) skips only the Elo step: match-triggered market
// resolution still runs, and so does expiry.
func (p *EventProcessor) processMatchSettlements(
	ctx context.Context,
	q *db.Queries,
	matchID id.ID,
	playerScores map[id.ID]float64,
	state MatchPrevState,
	matchDate time.Time,
	matchMode string,
	settleElo bool,
	eloCalcFn EloCalcFunc,
) error {
	// Step 1: Calculate and store/update the global arena settlement
	if matchMode != MatchModeCoop && settleElo {
		if err := eloCalcFn(ctx, q, matchID, playerScores, state); err != nil {
			return fmt.Errorf("elo calc for match %s: %w", matchID, err)
		}
	}

	// Steps 3 & 4: Match-triggered market resolution (SettleMarket applies rating inside)
	if matchMode != MatchModeCoop {
		if err := p.MarketService.TriggerResolutionForMatch(ctx, q, matchID); err != nil {
			return fmt.Errorf("market resolution for match %s: %w", matchID, err)
		}
	}

	// Steps 5 & 6: Time-based market expiry up to this match's date
	if err := p.MarketService.ExpireMarketsAtDate(ctx, q, matchDate); err != nil {
		return fmt.Errorf("expire markets at date %v: %w", matchDate, err)
	}

	return nil
}

// RecalculateFrom unsettle and reapply all settlements from startDate.
// Must be called within an active transaction.
// The lockAndGetPrevElos callback doubles as the club-membership gate
// (ADR-36): settles=false skips the match's Elo settlement while markets
// still resolve/expire on it.
func (p *EventProcessor) RecalculateFrom(
	ctx context.Context,
	q *db.Queries,
	startDate time.Time,
	calcAndUpdateElo EloCalcFunc,
	lockAndGetPrevElos func(ctx context.Context, q *db.Queries, match db.Match, playerScores map[id.ID]float64) (MatchPrevState, bool, error),
) error {
	// Snapshot resolved_at for all markets that will be unsettled. Used later to detect
	// whether recalculation moves any market's resolution to an earlier time.
	oldResolutions, err := q.GetMarketsForUnsettleWithResolvedAt(ctx, pgtype.Timestamptz{Time: startDate, Valid: true})
	if err != nil {
		return fmt.Errorf("snapshot market resolutions: %w", err)
	}

	// Delete all settlement rows from startDate in one query (match and market
	// rows of the sweep's anchor arena, «Синие люди»'s main arena).
	// The per-market deletes inside UnsettleMarketsFromDate will become
	// no-ops for its own markets.
	if err := q.DeleteSweepArenaSettlementsFromDate(ctx, pgtype.Timestamptz{Time: startDate, Valid: true}); err != nil {
		return fmt.Errorf("delete settlements from date: %w", err)
	}

	// Reset market state (status, resolved_at) for markets resolved on/after startDate.
	if err := p.MarketService.UnsettleMarketsFromDate(ctx, q, startDate); err != nil {
		return fmt.Errorf("unsettle markets: %w", err)
	}

	matches, err := q.GetMatchesFromDate(ctx, pgtype.Timestamptz{Time: startDate, Valid: true})
	if err != nil {
		return fmt.Errorf("get matches from date %v: %w", startDate, err)
	}

	for _, match := range matches {
		matchScores, err := q.GetMatchScoresForMatch(ctx, match.ID)
		if err != nil {
			return fmt.Errorf("get scores for match %s: %w", match.ID, err)
		}

		playerScores := make(map[id.ID]float64)
		for _, ms := range matchScores {
			playerScores[ms.PlayerID] = ms.Score
		}

		state, settles, err := lockAndGetPrevElos(ctx, q, match, playerScores)
		if err != nil {
			return fmt.Errorf("lock/get prev elos for match %s: %w", match.ID, err)
		}

		if err := p.processMatchSettlements(ctx, q, match.ID, playerScores,
			state, match.Date.Time, match.Mode, settles, calcAndUpdateElo); err != nil {
			return err
		}
	}

	// Tournament-winner markets are settled by tournament state, which the
	// replay above does not rewind: re-settle the ones it unset from the
	// tournaments' current state (see tournaments_markets.go).
	if err := p.MarketService.ResolveTournamentWinnerMarkets(ctx, q); err != nil {
		return fmt.Errorf("resolve tournament winner markets: %w", err)
	}

	return validateUserEventsAgainstNewResolutions(ctx, q, oldResolutions)
}

// validateUserEventsAgainstNewResolutions checks that no user events fall in the
// window [newResolvedAt, oldResolvedAt) for markets whose resolution moved earlier.
//
// User events checked (in order of the ADR):
//  1. Bet placements — bets.placed_at
//  2. Betting lock   — markets.betting_closed_at
//
// Adding a new market user event type: implement the check below following the
// same [newResolvedAt, oldResolvedAt) window pattern.
func validateUserEventsAgainstNewResolutions(
	ctx context.Context,
	q *db.Queries,
	oldResolutions []db.GetMarketsForUnsettleWithResolvedAtRow,
) error {
	for _, old := range oldResolutions {
		if !old.ResolvedAt.Valid {
			continue
		}
		newResolvedAt, err := q.GetMarketResolvedAt(ctx, old.ID)
		if err != nil {
			return fmt.Errorf("get new resolved_at for market %s: %w", old.ID, err)
		}
		if !newResolvedAt.Valid {
			// Market was not re-settled (no qualifying match in replayed range).
			continue
		}
		if !newResolvedAt.Time.Before(old.ResolvedAt.Time) {
			// resolved_at did not move earlier; no new conflicts possible.
			continue
		}

		// 1. Bet placements: any bet in [newResolvedAt, oldResolvedAt) is now invalid.
		bets, err := q.GetBetsOnMarketPlacedBetween(ctx, db.GetBetsOnMarketPlacedBetweenParams{
			MarketID:   old.ID,
			PlacedAt:   newResolvedAt,
			PlacedAt_2: pgtype.Timestamptz{Time: old.ResolvedAt.Time, Valid: true},
		})
		if err != nil {
			return fmt.Errorf("check bets for market %s: %w", old.ID, err)
		}
		if len(bets) > 0 {
			b := bets[0]
			return fmt.Errorf("%w: market_id=%s player_id=%s (bet placed after new resolution time)",
				ErrHistoryChangeConflict, old.ID, b.PlayerID)
		}

		// 2. Betting lock: if betting_closed_at falls in [newResolvedAt, oldResolvedAt),
		// the admin would have tried to lock betting on an already-resolved market.
		if old.BettingClosedAt.Valid &&
			!old.BettingClosedAt.Time.Before(newResolvedAt.Time) &&
			old.BettingClosedAt.Time.Before(old.ResolvedAt.Time) {
			return fmt.Errorf("%w: market_id=%s (betting was locked after new resolution time)",
				ErrHistoryChangeConflictBettingLock, old.ID)
		}
	}

	return nil
}
