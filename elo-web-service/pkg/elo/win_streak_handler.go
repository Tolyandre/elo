package elo

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

type winStreakHandler struct{}

func (h *winStreakHandler) CreateParams(ctx context.Context, q *db.Queries, marketID int32, params CreateMarketParams) error {
	p := params.WinStreak
	maxLosses := pgtype.Int4{}
	if p.MaxLosses != nil {
		maxLosses = pgtype.Int4{Int32: *p.MaxLosses, Valid: true}
	}
	gameIDs := p.GameIDs
	if gameIDs == nil {
		gameIDs = []int32{}
	}
	return q.CreateWinStreakParams(ctx, db.CreateWinStreakParamsParams{
		MarketID:       marketID,
		TargetPlayerID: p.TargetPlayerID,
		GameIds:        gameIDs,
		WinsRequired:   p.WinsRequired,
		MaxLosses:      maxLosses,
	})
}

func (h *winStreakHandler) ResolutionTrigger() ResolutionTrigger {
	return &winStreakTrigger{}
}

// winStreakTrigger implements ResolutionTrigger for the win_streak market type.
type winStreakTrigger struct{}

func (t *winStreakTrigger) OnMatch(ctx context.Context, q *db.Queries, match MatchInfo, settle SettleFunc) error {
	markets, err := q.ListOpenWinStreakMarkets(ctx)
	if err != nil {
		return fmt.Errorf("list win_streak markets: %w", err)
	}

	matchDate := match.Match.Date.Time

	for _, m := range markets {
		if !match.ParticipantSet[m.TargetPlayerID] || !containsInt32(m.GameIds, match.Match.GameID) {
			continue
		}

		stats, err := q.GetPlayerStreakStats(ctx, db.GetPlayerStreakStatsParams{
			PlayerID: m.TargetPlayerID,
			Column2:  m.GameIds,
			Date:     m.StartsAt,
			Date_2:   pgtype.Timestamptz{Time: matchDate, Valid: true},
		})
		if err != nil {
			return fmt.Errorf("streak stats for market %d: %w", m.ID, err)
		}

		cond := WinStreakCondition{WinsRequired: m.WinsRequired, MaxLosses: pgInt4ToPtr(m.MaxLosses)}
		resolved, outcome := cond.Evaluate(stats.Wins, stats.Losses)
		if !resolved {
			continue
		}

		resolutionMatchID := match.Match.ID
		if err := settle(ctx, q, m.ID, outcome, matchDate, &resolutionMatchID); err != nil {
			return fmt.Errorf("settle win_streak market %d: %w", m.ID, err)
		}
	}
	return nil
}

func (t *winStreakTrigger) OnTimeExpiry(ctx context.Context, q *db.Queries, cutoff time.Time, settle SettleFunc) error {
	markets, err := q.ListOverdueWinStreakMarketsAtDate(ctx, pgtype.Timestamptz{Time: cutoff, Valid: true})
	if err != nil {
		return fmt.Errorf("list overdue win_streak markets at date: %w", err)
	}
	for _, m := range markets {
		stats, err := q.GetPlayerStreakStats(ctx, db.GetPlayerStreakStatsParams{
			PlayerID: m.TargetPlayerID,
			Column2:  m.GameIds,
			Date:     m.StartsAt,
			Date_2:   m.ClosesAt,
		})
		if err != nil {
			return fmt.Errorf("streak stats for market %d: %w", m.ID, err)
		}

		cond := WinStreakCondition{WinsRequired: m.WinsRequired, MaxLosses: pgInt4ToPtr(m.MaxLosses)}
		_, outcome := cond.Evaluate(stats.Wins, stats.Losses)
		if outcome == "" {
			outcome = OutcomeNo
		}
		if err := settle(ctx, q, m.ID, outcome, m.ClosesAt.Time, nil); err != nil {
			return fmt.Errorf("settle overdue win_streak market %d: %w", m.ID, err)
		}
	}
	return nil
}

func (t *winStreakTrigger) OnOverdue(ctx context.Context, q *db.Queries, settle SettleFunc) error {
	markets, err := q.ListOverdueWinStreakMarkets(ctx)
	if err != nil {
		return fmt.Errorf("list overdue win_streak markets: %w", err)
	}
	for _, m := range markets {
		stats, err := q.GetPlayerStreakStats(ctx, db.GetPlayerStreakStatsParams{
			PlayerID: m.TargetPlayerID,
			Column2:  m.GameIds,
			Date:     m.StartsAt,
			Date_2:   m.ClosesAt,
		})
		if err != nil {
			return fmt.Errorf("streak stats for market %d: %w", m.ID, err)
		}

		cond := WinStreakCondition{WinsRequired: m.WinsRequired, MaxLosses: pgInt4ToPtr(m.MaxLosses)}
		_, outcome := cond.Evaluate(stats.Wins, stats.Losses)
		if outcome == "" {
			outcome = OutcomeNo
		}
		if err := settle(ctx, q, m.ID, outcome, m.ClosesAt.Time, nil); err != nil {
			return fmt.Errorf("settle overdue win_streak market %d: %w", m.ID, err)
		}
	}
	return nil
}
