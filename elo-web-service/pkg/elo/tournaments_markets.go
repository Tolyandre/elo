package elo

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// Tournament-winner market hooks: the points where a tournament's lifecycle
// state drives its markets' settlement. All of them must be called within an
// active transaction — they settle through SettleMarket (or rewrite market
// rows directly) against the caller's transactional queries.

// SettleTournamentWinnerMarketsOnComplete resolves a just-completed
// tournament's open markets. Called from the tournament completion flow, which
// runs after the settlement replay in every match-write path, so the
// settlement is never undone by it.
func (s *MarketService) SettleTournamentWinnerMarketsOnComplete(ctx context.Context, q *db.Queries, tid, winner id.ID, slot db.GetTournamentSlotRow) error {
	return settleCompletedTournamentWinnerMarkets(ctx, q, s.SettleMarket, tid, winner, slot.ID, slot.Ruling, slot.Promote)
}

// ReopenTournamentWinnerMarkets unsets the resolved tournament_winner markets
// of a tournament whose completion was reverted by a bracket-edit cascade
// (the champion is no longer trustworthy, so its settled markets reopen).
func (s *MarketService) ReopenTournamentWinnerMarkets(ctx context.Context, q *db.Queries, tid id.ID) error {
	marketIDs, err := q.ListResolvedTournamentWinnerMarketsByTournament(ctx, tid)
	if err != nil {
		return fmt.Errorf("list resolved tournament_winner markets: %w", err)
	}
	for _, marketID := range marketIDs {
		if err := q.DeleteArenaSettlementByMarket(ctx, db.DeleteArenaSettlementByMarketParams{
			ArenaID:  GlobalArenaID,
			MarketID: &marketID,
		}); err != nil {
			return fmt.Errorf("delete global arena settlement for market %s: %w", marketID, err)
		}
		if err := q.UnsettleMarket(ctx, marketID); err != nil {
			return fmt.Errorf("unsettle market %s: %w", marketID, err)
		}
	}
	return nil
}

// CancelTournamentWinnerMarkets refunds the open tournament_winner markets of
// a cancelled tournament (organizer decision or grand-final deadline). The
// refund is net-zero for every participant, so dating it now stays correct
// even when a later recalculation unsets and re-cancels the market.
func (s *MarketService) CancelTournamentWinnerMarkets(ctx context.Context, q *db.Queries, tid id.ID) error {
	marketIDs, err := q.ListOpenTournamentWinnerMarkets(ctx, tid)
	if err != nil {
		return fmt.Errorf("list open tournament_winner markets: %w", err)
	}
	for _, marketID := range marketIDs {
		if err := s.SettleMarket(ctx, q, marketID, OutcomeCancelled, time.Now(), nil); err != nil {
			return fmt.Errorf("cancel tournament_winner market %s: %w", marketID, err)
		}
	}
	return nil
}

// ResolveTournamentWinnerMarkets is the recalculation sweep: it settles open
// tournament_winner markets from the tournaments' current lifecycle state.
// The tournament tables are live state — they are not part of the settlement
// replay — so markets the replay unsettled are re-settled from what they say
// now, after the replayed matches. Standings-decided completions normally
// re-settle inline during the replay (the per-match trigger), so the sweep
// mostly serves ruling-decided completions and cancellations; for those,
// dating at now keeps the arena ledger append-ordered.
func (s *MarketService) ResolveTournamentWinnerMarkets(ctx context.Context, q *db.Queries) error {
	rows, err := q.ListOpenTournamentWinnerMarketsWithState(ctx)
	if err != nil {
		return fmt.Errorf("list tournament_winner markets with state: %w", err)
	}
	for _, row := range rows {
		switch row.TournamentStatus {
		case TournamentCompleted:
			if row.WinnerPlayerID == nil {
				continue
			}
			slot, err := q.GetTournamentFinalSlot(ctx, row.TournamentID)
			if err != nil {
				return fmt.Errorf("get final slot of tournament %s: %w", row.TournamentID, err)
			}
			if err := settleCompletedTournamentWinnerMarkets(ctx, q, s.SettleMarket, row.TournamentID, *row.WinnerPlayerID, slot.ID, slot.Ruling, slot.Promote); err != nil {
				return err
			}
		case TournamentCancelled:
			if err := s.CancelTournamentWinnerMarkets(ctx, q, row.TournamentID); err != nil {
				return err
			}
		}
	}
	return nil
}

// settleCompletedTournamentWinnerMarkets settles a completed tournament's open
// markets, deriving the resolution attachment from the final slot's current
// state: a standing ruling means the organizer decided the champion (no match
// attached), otherwise the slot's latest match determined it.
func settleCompletedTournamentWinnerMarkets(
	ctx context.Context, q *db.Queries, settle SettleFunc, tid, winner, slotID id.ID, ruling json.RawMessage, promote int32,
) error {
	if decidedByRuling(ruling, promote) {
		return settleTournamentWinnerMarkets(ctx, q, tid, winner, time.Now(), nil, settle)
	}
	latest, err := q.LatestSlotMatchID(ctx, slotID)
	if db.IsNoRows(err) {
		// Standings cannot decide a match-less slot; treat defensively as a
		// match-less completion instead of failing the tournament flow.
		return settleTournamentWinnerMarkets(ctx, q, tid, winner, time.Now(), nil, settle)
	}
	if err != nil {
		return fmt.Errorf("latest slot match: %w", err)
	}
	match, err := q.GetMatch(ctx, latest)
	if err != nil {
		return fmt.Errorf("get determining match: %w", err)
	}
	return settleTournamentWinnerMarkets(ctx, q, tid, winner, match.Date.Time, &latest, settle)
}
