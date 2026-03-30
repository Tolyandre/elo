package elo

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
)


type matchWinnerHandler struct{}

func (h *matchWinnerHandler) CreateParams(ctx context.Context, q *db.Queries, marketID int32, params CreateMarketParams) error {
	p := params.MatchWinner
	gameID := pgtype.Int4{}
	if p.GameID != nil {
		gameID = pgtype.Int4{Int32: *p.GameID, Valid: true}
	}
	requiredIDs := p.RequiredPlayerIDs
	if requiredIDs == nil {
		requiredIDs = []int32{}
	}
	return q.CreateMatchWinnerParams(ctx, db.CreateMatchWinnerParamsParams{
		MarketID:          marketID,
		TargetPlayerID:    p.TargetPlayerID,
		RequiredPlayerIds: requiredIDs,
		GameID:            gameID,
	})
}

func (h *matchWinnerHandler) TriggerResolutionForMatch(ctx context.Context, q *db.Queries, match MatchInfo, settle SettleFunc) error {
	markets, err := q.ListOpenMatchWinnerMarkets(ctx)
	if err != nil {
		return fmt.Errorf("list match_winner markets: %w", err)
	}

	for _, m := range markets {
		cond := MatchWinnerCondition{
			TargetPlayerID:    m.TargetPlayerID,
			RequiredPlayerIDs: m.RequiredPlayerIds,
			GameID:            pgInt4ToPtr(m.GameID),
		}
		window := TimeWindow{StartsAt: m.StartsAt.Time, ClosesAt: m.ClosesAt.Time}
		resolved, outcome := cond.Evaluate(match, window)
		if !resolved {
			continue
		}

		resolutionMatchID := match.Match.ID
		if err := settle(ctx, q, m.ID, outcome, match.Match.Date.Time, &resolutionMatchID); err != nil {
			return fmt.Errorf("settle match_winner market %d: %w", m.ID, err)
		}
	}
	return nil
}

func (h *matchWinnerHandler) ExpireResolve(ctx context.Context, q *db.Queries, settle SettleFunc) error {
	markets, err := q.ListOverdueMatchWinnerMarkets(ctx)
	if err != nil {
		return fmt.Errorf("list overdue match_winner markets: %w", err)
	}
	for _, m := range markets {
		if err := settle(ctx, q, m.ID, "cancelled", m.ClosesAt.Time, nil); err != nil {
			return fmt.Errorf("cancel overdue match_winner market %d: %w", m.ID, err)
		}
	}
	return nil
}

func (h *matchWinnerHandler) ExpireResolveAtDate(ctx context.Context, q *db.Queries, date time.Time, settle SettleFunc) error {
	markets, err := q.ListOverdueMatchWinnerMarketsAtDate(ctx, pgtype.Timestamptz{Time: date, Valid: true})
	if err != nil {
		return fmt.Errorf("list overdue match_winner markets at date: %w", err)
	}
	for _, m := range markets {
		if err := settle(ctx, q, m.ID, "cancelled", m.ClosesAt.Time, nil); err != nil {
			return fmt.Errorf("cancel overdue match_winner market %d: %w", m.ID, err)
		}
	}
	return nil
}
