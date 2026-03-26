package elo

import (
	"context"
	"fmt"

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

	matchDate := match.Match.Date.Time

	for _, m := range markets {
		if matchDate.Before(m.StartsAt.Time) || matchDate.After(m.ClosesAt.Time) {
			continue
		}
		if m.GameID.Valid && m.GameID.Int32 != match.Match.GameID {
			continue
		}
		allPresent := true
		for _, reqID := range m.RequiredPlayerIds {
			if !match.ParticipantSet[reqID] {
				allPresent = false
				break
			}
		}
		if !allPresent || !match.ParticipantSet[m.TargetPlayerID] {
			continue
		}

		resolutionMatchID := match.Match.ID
		outcome := "resolved_no"
		if match.PlayerScoreMap[m.TargetPlayerID] >= match.MaxScore {
			outcome = "resolved_yes"
		}
		if err := settle(ctx, q, m.ID, outcome, matchDate, &resolutionMatchID); err != nil {
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
