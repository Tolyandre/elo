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
	requiredIDs := p.RequiredPlayerIDs
	if requiredIDs == nil {
		requiredIDs = []int32{}
	}
	gameIDs := p.GameIDs
	if gameIDs == nil {
		gameIDs = []int32{}
	}
	return q.CreateMatchWinnerParams(ctx, db.CreateMatchWinnerParamsParams{
		MarketID:          marketID,
		TargetPlayerID:    p.TargetPlayerID,
		RequiredPlayerIds: requiredIDs,
		GameIds:           gameIDs,
	})
}

func (h *matchWinnerHandler) ResolutionTrigger() ResolutionTrigger {
	return &matchWinnerTrigger{}
}

// matchWinnerTrigger implements ResolutionTrigger for the match_winner market type.
type matchWinnerTrigger struct{}

func (t *matchWinnerTrigger) OnMatch(ctx context.Context, q *db.Queries, match MatchInfo, settle SettleFunc) error {
	markets, err := q.ListOpenMatchWinnerMarkets(ctx)
	if err != nil {
		return fmt.Errorf("list match_winner markets: %w", err)
	}

	for _, m := range markets {
		cond := MatchWinnerCondition{
			TargetPlayerID:    m.TargetPlayerID,
			RequiredPlayerIDs: m.RequiredPlayerIds,
			GameIDs:           m.GameIds,
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

func (t *matchWinnerTrigger) OnTimeExpiry(ctx context.Context, q *db.Queries, cutoff time.Time, settle SettleFunc) error {
	markets, err := q.ListOverdueMatchWinnerMarketsAtDate(ctx, pgtype.Timestamptz{Time: cutoff, Valid: true})
	if err != nil {
		return fmt.Errorf("list overdue match_winner markets at date: %w", err)
	}
	for _, m := range markets {
		if err := settle(ctx, q, m.ID, OutcomeCancelled, m.ClosesAt.Time, nil); err != nil {
			return fmt.Errorf("cancel overdue match_winner market %d: %w", m.ID, err)
		}
	}
	return nil
}

func (t *matchWinnerTrigger) OnOverdue(ctx context.Context, q *db.Queries, settle SettleFunc) error {
	markets, err := q.ListOverdueMatchWinnerMarkets(ctx)
	if err != nil {
		return fmt.Errorf("list overdue match_winner markets: %w", err)
	}
	for _, m := range markets {
		if err := settle(ctx, q, m.ID, OutcomeCancelled, m.ClosesAt.Time, nil); err != nil {
			return fmt.Errorf("cancel overdue match_winner market %d: %w", m.ID, err)
		}
	}
	return nil
}
