package elo

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

type tournamentWinnerHandler struct{}

// CreateParams stores the tournament link and creates one "player wins"
// outcome per tournament participant, read server-side: the roster is frozen
// once the tournament is running (registration closes on start), so the
// outcomes can never drift from the bracket.
func (h *tournamentWinnerHandler) CreateParams(ctx context.Context, q *db.Queries, marketID id.ID, params CreateMarketParams) error {
	p := params.TournamentWinner
	if err := q.CreateTournamentWinnerParams(ctx, db.CreateTournamentWinnerParamsParams{
		MarketID:     marketID,
		TournamentID: p.TournamentID,
	}); err != nil {
		return err
	}
	participants, err := q.ListTournamentParticipants(ctx, p.TournamentID)
	if err != nil {
		return fmt.Errorf("list tournament participants: %w", err)
	}
	playerIDs := make([]id.ID, 0, len(participants))
	for _, p := range participants {
		playerIDs = append(playerIDs, p.PlayerID)
	}
	// One "player wins" outcome per participant and no "other" outcome: a
	// tournament always produces a champion or is cancelled.
	return q.CreatePlayerOutcomes(ctx, db.CreatePlayerOutcomesParams{
		MarketID:  marketID,
		PlayerIds: playerIDs,
	})
}

func (h *tournamentWinnerHandler) ResolutionTrigger() ResolutionTrigger {
	return &tournamentWinnerTrigger{}
}

// tournamentWinnerTrigger implements ResolutionTrigger for the tournament_winner
// market type. The market never expires by time (its fate is the tournament's),
// so OnTimeExpiry and OnOverdue are deliberate no-ops: it settles when the
// tournament completes and is refunded when the tournament is cancelled — both
// via the tournament lifecycle hooks (tournaments_markets.go).
type tournamentWinnerTrigger struct{}

// OnMatch settles a tournament's markets when the processed match is the
// determining match of a tournament that is currently completed and whose
// champion was derived from standings. In the live add flow the match is not
// yet linked to its slot (acceptance runs later in the same transaction), so
// this fires only on replays of already-linked matches — exactly where the
// settlement rows must land to keep the arena ledger ordered. Ruling-decided
// completions attach no match; the recalculation sweep re-settles those.
func (t *tournamentWinnerTrigger) OnMatch(ctx context.Context, q *db.Queries, match MatchInfo, settle SettleFunc) error {
	links, err := q.ListSlotMatchesForMatchIDs(ctx, []id.ID{match.Match.ID})
	if err != nil {
		return fmt.Errorf("list slot links: %w", err)
	}
	if len(links) == 0 {
		return nil
	}
	link := links[0]

	tournament, err := q.GetTournament(ctx, link.TournamentID)
	if err != nil {
		return fmt.Errorf("get tournament: %w", err)
	}
	if tournament.Status != TournamentCompleted || tournament.WinnerPlayerID == nil {
		return nil
	}

	slot, err := q.GetTournamentSlot(ctx, link.SlotID)
	if err != nil {
		return fmt.Errorf("get slot: %w", err)
	}
	if decidedByRuling(slot.Ruling, slot.Promote) {
		return nil
	}
	latest, err := q.LatestSlotMatchID(ctx, link.SlotID)
	if db.IsNoRows(err) {
		return nil // no linked matches — nothing this match could have decided
	}
	if err != nil {
		return fmt.Errorf("latest slot match: %w", err)
	}
	if latest != match.Match.ID {
		return nil
	}

	return settleTournamentWinnerMarkets(ctx, q, link.TournamentID, *tournament.WinnerPlayerID,
		match.Match.Date.Time, &match.Match.ID, settle)
}

func (t *tournamentWinnerTrigger) OnTimeExpiry(ctx context.Context, q *db.Queries, cutoff time.Time, settle SettleFunc) error {
	return nil
}

func (t *tournamentWinnerTrigger) OnOverdue(ctx context.Context, q *db.Queries, settle SettleFunc) error {
	return nil
}

// decidedByRuling reports whether a slot's current outcome comes from a
// standing organizer ruling — the same validity rule desiredOutcome applies
// (a ruling must hold exactly the promoted count to be in force).
func decidedByRuling(ruling json.RawMessage, promote int32) bool {
	if ruling == nil {
		return false
	}
	var parsed []id.ID
	if err := json.Unmarshal(ruling, &parsed); err != nil {
		return false
	}
	return len(parsed) == int(promote)
}

// settleTournamentWinnerMarkets resolves every open tournament_winner market
// on the tournament with the given champion.
func settleTournamentWinnerMarkets(ctx context.Context, q *db.Queries, tid, winner id.ID, resolvedAt time.Time, resolutionMatchID *id.ID, settle SettleFunc) error {
	marketIDs, err := q.ListOpenTournamentWinnerMarkets(ctx, tid)
	if err != nil {
		return fmt.Errorf("list tournament_winner markets: %w", err)
	}
	for _, marketID := range marketIDs {
		outcomeID, err := outcomeIDForKey(ctx, q, marketID, PlayerOutcomeKey(winner))
		if err != nil {
			return fmt.Errorf("resolve outcome for tournament_winner market %s: %w", marketID, err)
		}
		if err := settle(ctx, q, marketID, MarketOutcome(outcomeID), resolvedAt, resolutionMatchID); err != nil {
			return fmt.Errorf("settle tournament_winner market %s: %w", marketID, err)
		}
	}
	return nil
}
