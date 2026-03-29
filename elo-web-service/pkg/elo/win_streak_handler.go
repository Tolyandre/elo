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
	return q.CreateWinStreakParams(ctx, db.CreateWinStreakParamsParams{
		MarketID:       marketID,
		TargetPlayerID: p.TargetPlayerID,
		GameID:         p.GameID,
		WinsRequired:   p.WinsRequired,
		MaxLosses:      maxLosses,
	})
}

func (h *winStreakHandler) TriggerResolutionForMatch(ctx context.Context, q *db.Queries, match MatchInfo, settle SettleFunc) error {
	markets, err := q.ListOpenWinStreakMarkets(ctx)
	if err != nil {
		return fmt.Errorf("list win_streak markets: %w", err)
	}

	matchDate := match.Match.Date.Time

	for _, m := range markets {
		if !match.ParticipantSet[m.TargetPlayerID] || match.Match.GameID != m.GameID {
			continue
		}

		stats, err := q.GetPlayerStreakStats(ctx, db.GetPlayerStreakStatsParams{
			PlayerID: m.TargetPlayerID,
			GameID:   m.GameID,
			Date:     m.StartsAt,
			Date_2:   pgtype.Timestamptz{Time: matchDate, Valid: true},
		})
		if err != nil {
			return fmt.Errorf("streak stats for market %d: %w", m.ID, err)
		}

		resolutionMatchID := match.Match.ID
		if m.MaxLosses.Valid && stats.Losses > m.MaxLosses.Int32 {
			if err := settle(ctx, q, m.ID, "resolved_no", matchDate, &resolutionMatchID); err != nil {
				return fmt.Errorf("settle win_streak market %d no (loss limit): %w", m.ID, err)
			}
			continue
		}
		if stats.Wins >= m.WinsRequired {
			if err := settle(ctx, q, m.ID, "resolved_yes", matchDate, &resolutionMatchID); err != nil {
				return fmt.Errorf("settle win_streak market %d yes: %w", m.ID, err)
			}
		}
	}
	return nil
}

func (h *winStreakHandler) ExpireResolve(ctx context.Context, q *db.Queries, settle SettleFunc) error {
	markets, err := q.ListOverdueWinStreakMarkets(ctx)
	if err != nil {
		return fmt.Errorf("list overdue win_streak markets: %w", err)
	}
	for _, m := range markets {
		stats, err := q.GetPlayerStreakStats(ctx, db.GetPlayerStreakStatsParams{
			PlayerID: m.TargetPlayerID,
			GameID:   m.GameID,
			Date:     m.StartsAt,
			Date_2:   m.ClosesAt,
		})
		if err != nil {
			return fmt.Errorf("streak stats for market %d: %w", m.ID, err)
		}

		outcome := "resolved_no"
		if stats.Wins >= m.WinsRequired && (!m.MaxLosses.Valid || stats.Losses <= m.MaxLosses.Int32) {
			outcome = "resolved_yes"
		}
		if err := settle(ctx, q, m.ID, outcome, m.ClosesAt.Time, nil); err != nil {
			return fmt.Errorf("settle overdue win_streak market %d: %w", m.ID, err)
		}
	}
	return nil
}

func (h *winStreakHandler) ExpireResolveAtDate(ctx context.Context, q *db.Queries, date time.Time, settle SettleFunc) error {
	markets, err := q.ListOverdueWinStreakMarketsAtDate(ctx, pgtype.Timestamptz{Time: date, Valid: true})
	if err != nil {
		return fmt.Errorf("list overdue win_streak markets at date: %w", err)
	}
	for _, m := range markets {
		stats, err := q.GetPlayerStreakStats(ctx, db.GetPlayerStreakStatsParams{
			PlayerID: m.TargetPlayerID,
			GameID:   m.GameID,
			Date:     m.StartsAt,
			Date_2:   m.ClosesAt,
		})
		if err != nil {
			return fmt.Errorf("streak stats for market %d: %w", m.ID, err)
		}

		outcome := "resolved_no"
		if stats.Wins >= m.WinsRequired && (!m.MaxLosses.Valid || stats.Losses <= m.MaxLosses.Int32) {
			outcome = "resolved_yes"
		}
		if err := settle(ctx, q, m.ID, outcome, m.ClosesAt.Time, nil); err != nil {
			return fmt.Errorf("settle overdue win_streak market %d: %w", m.ID, err)
		}
	}
	return nil
}
