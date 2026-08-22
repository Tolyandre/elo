package elo

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

type matchWinnerHandler struct{}

func (h *matchWinnerHandler) CreateParams(ctx context.Context, q *db.Queries, marketID string, params CreateMarketParams) error {
	p := params.MatchWinner
	targets := p.TargetPlayerIDs
	if targets == nil {
		targets = []string{}
	}
	gameIDs := p.GameIDs
	if gameIDs == nil {
		gameIDs = []string{}
	}
	if err := q.CreateMatchWinnerParams(ctx, db.CreateMatchWinnerParamsParams{
		MarketID:          marketID,
		TargetPlayerIds:   targets,
		AllowOtherPlayers: p.AllowOtherPlayers,
		GameIds:           gameIDs,
	}); err != nil {
		return err
	}
	// One "player wins" outcome per target plus the "other" outcome that ties
	// and non-target winners resolve to.
	if err := q.CreatePlayerOutcomes(ctx, db.CreatePlayerOutcomesParams{
		MarketID:  marketID,
		PlayerIds: targets,
	}); err != nil {
		return err
	}
	return q.CreateOtherOutcome(ctx, marketID)
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
			TargetPlayerIDs:   m.TargetPlayerIds,
			AllowOtherPlayers: m.AllowOtherPlayers,
			GameIDs:           m.GameIds,
		}
		window := TimeWindow{StartsAt: m.StartsAt.Time, ClosesAt: m.ClosesAt.Time}
		resolved, key := cond.Evaluate(match, window)
		if !resolved {
			continue
		}

		outcomeID, err := outcomeIDForKey(ctx, q, m.ID, key)
		if err != nil {
			return fmt.Errorf("resolve outcome for match_winner market %s: %w", m.ID, err)
		}

		resolutionMatchID := match.Match.ID
		if err := settle(ctx, q, m.ID, MarketOutcome(outcomeID), match.Match.Date.Time, &resolutionMatchID); err != nil {
			return fmt.Errorf("settle match_winner market %s: %w", m.ID, err)
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
			return fmt.Errorf("cancel overdue match_winner market %s: %w", m.ID, err)
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
			return fmt.Errorf("cancel overdue match_winner market %s: %w", m.ID, err)
		}
	}
	return nil
}

// outcomeIDForKey maps a semantic OutcomeKey ("player:<uuid>" / "other" /
// "yes" / "no") to the market's concrete market_outcomes row id that bets and
// resolution store.
func outcomeIDForKey(ctx context.Context, q *db.Queries, marketID string, key OutcomeKey) (string, error) {
	kind := string(key)
	playerID := ""
	if pid, ok := key.PlayerID(); ok {
		kind = "player"
		playerID = pid
	}
	if kind != "player" && kind != "other" && kind != "yes" && kind != "no" {
		return "", fmt.Errorf("unknown outcome key %q", key)
	}
	outcomes, err := q.ListMarketOutcomes(ctx, marketID)
	if err != nil {
		return "", err
	}
	for _, o := range outcomes {
		if o.Kind != kind {
			continue
		}
		if kind == "player" {
			if o.PlayerID != nil && *o.PlayerID == playerID {
				return o.ID, nil
			}
			continue
		}
		return o.ID, nil
	}
	if kind == "player" {
		return "", fmt.Errorf("market %s has no player outcome for %s", marketID, playerID)
	}
	return "", fmt.Errorf("market %s has no %q outcome", marketID, kind)
}
