package elo

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/tolyandre/elo-web-service/pkg/audit"
	"github.com/tolyandre/elo-web-service/pkg/bracket"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// Slot play (ADR-26 §Slot play / §Acceptance / §Editing without paradoxes).
// A slot is a small series played by the same seated players until the
// promoted set is beyond doubt: every linked match scores placement points,
// and the slot completes when the top-promote set of the cumulative standings
// is strictly separated. Scores of linked matches are freely editable and a
// promoted set may legitimately change — the invariant is kept by
// re-derivation plus recursive cascade invalidation, never by prohibition.

// ITournamentPlay is the match-write-side surface of the tournament service
// (acceptance inside the match-write transaction, re-evaluation after edits).
type ITournamentPlay interface {
	// AcceptMatch links a newly created match to its unique fitting playing
	// slot (same game, exactly the seated players) and re-evaluates that slot.
	// A match that fits nothing stays unlinked. Runs inside the match-write tx.
	AcceptMatch(ctx context.Context, q *db.Queries, matchID, gameID id.ID, playerIDs []id.ID, actor id.ID) error
}

// acceptanceCandidate rows arrive in the deterministic acceptance order
// (track, round index, table position); seated-set equality is checked per
// candidate against its seats.

// AcceptMatch implements ITournamentPlay.
func (s *TournamentService) AcceptMatch(ctx context.Context, q *db.Queries, matchID, gameID id.ID, playerIDs []id.ID, actor id.ID) error {
	candidates, err := q.ListAcceptanceCandidates(ctx, gameID)
	if err != nil {
		return fmt.Errorf("list acceptance candidates: %w", err)
	}
	if len(candidates) == 0 {
		return nil
	}
	for _, c := range candidates {
		if int(c.SeatCount) != len(playerIDs) {
			continue
		}
		seats, err := q.ListSeatsBySlots(ctx, []id.ID{c.ID})
		if err != nil {
			return fmt.Errorf("list candidate seats: %w", err)
		}
		if !seatSetEquals(seats, playerIDs) {
			continue
		}
		// Unique fit (deterministic (track, index, position) order as the
		// safeguard): link the match, record the permanent tournament link
		// (the arena counts the match even if the slot link is later voided),
		// audit, and re-evaluate the slot.
		if err := q.AddSlotMatch(ctx, db.AddSlotMatchParams{SlotID: c.ID, MatchID: matchID}); err != nil {
			return fmt.Errorf("link match to slot: %w", err)
		}
		if err := q.AddTournamentMatch(ctx, db.AddTournamentMatchParams{
			TournamentID: c.TournamentID, MatchID: matchID,
		}); err != nil {
			return fmt.Errorf("link match to tournament: %w", err)
		}
		if err := recordAuditEvent(ctx, q, actor, audit.EntityTournament, audit.ActionUpdated, c.TournamentID,
			audit.KindSlotLink, audit.NewSlotLinkDetails(audit.SlotLinkAttach, string(c.ID), string(matchID),
				audit.LinkOriginAcceptance, "")); err != nil {
			return err
		}
		return s.recomputeSlot(ctx, q, actor, c.ID, "", "")
	}
	return nil
}

func seatSetEquals(seats []db.TournamentSeat, playerIDs []id.ID) bool {
	seen := make(map[id.ID]bool, len(seats))
	for _, se := range seats {
		if se.PlayerID == nil {
			return false // an unresolved seat cannot host a match
		}
		seen[*se.PlayerID] = true
	}
	if len(seen) != len(playerIDs) {
		return false
	}
	for _, p := range playerIDs {
		if !seen[p] {
			return false
		}
	}
	return true
}

// recomputeSlot re-derives the slot's outcome from the linked matches' scores
// (or the standing organizer ruling), records it when it changed, refills the
// downstream seat caches, and recursively voids downstream slots that already
// recorded results — the bracket never lies (ADR-26 §Editing without
// paradoxes). origin describes the triggering event for the audit trail.
func (s *TournamentService) recomputeSlot(ctx context.Context, q *db.Queries, actor id.ID, slotID id.ID, originKind, originID string) error {
	slot, err := q.GetTournamentSlot(ctx, slotID)
	if err != nil {
		return fmt.Errorf("get slot: %w", err)
	}
	// Waiting slots have no linked matches; nothing to re-derive.
	if slot.Status == TournamentSlotWaiting {
		return nil
	}

	desired, haveOutcome, err := s.desiredOutcome(ctx, q, slot)
	if err != nil {
		return err
	}
	stored, err := q.ListSlotPromotions(ctx, slotID)
	if err != nil {
		return fmt.Errorf("list promotions: %w", err)
	}
	if !outcomeChanged(desired, haveOutcome, stored) {
		return nil
	}

	// Rewrite the recorded outcome.
	if err := q.DeleteSlotPromotions(ctx, slotID); err != nil {
		return fmt.Errorf("clear promotions: %w", err)
	}
	newStatus := TournamentSlotPlaying
	if haveOutcome {
		newStatus = TournamentSlotCompleted
		for place, playerID := range desired {
			if err := q.AddSlotPromotion(ctx, db.AddSlotPromotionParams{
				SlotID: slotID, PlayerID: playerID, Place: int32(place + 1),
			}); err != nil {
				return fmt.Errorf("record promotion: %w", err)
			}
		}
	}
	if err := q.SetSlotStatus(ctx, db.SetSlotStatusParams{ID: slotID, Status: newStatus}); err != nil {
		return fmt.Errorf("set slot status: %w", err)
	}

	// Downstream: refill (or clear) the seat caches fed by this slot, then
	// void every downstream slot that already recorded something — its matches
	// were played by the wrong participants and must be consciously re-played
	// or re-attached (re-acceptance is deliberately not automatic).
	downstream, err := q.ListSlotsBySource(ctx, slotID)
	if err != nil {
		return fmt.Errorf("list downstream slots: %w", err)
	}
	for _, d := range downstream {
		if haveOutcome {
			if err := q.SetSlotSeatsFromPromotions(ctx, d.ID); err != nil {
				return fmt.Errorf("refill seats: %w", err)
			}
		} else {
			if err := q.ClearSlotSeatCaches(ctx, slotID); err != nil {
				return fmt.Errorf("clear seat caches: %w", err)
			}
		}
		if err := s.voidSlotIfDirty(ctx, q, actor, d, audit.LinkOriginCascade, string(slotID)); err != nil {
			return err
		}
		if err := s.refreshDownstreamStatus(ctx, q, d.ID); err != nil {
			return err
		}
	}

	// The champion: a final-track slot promoting exactly one player that
	// feeds nobody completes the tournament.
	if haveOutcome && slot.Track == bracket.TrackFinal && slot.Promote == 1 && len(downstream) == 0 {
		if err := s.completeTournament(ctx, q, actor, slot.TournamentID, desired[0]); err != nil {
			return err
		}
	}
	return nil
}

// desiredOutcome computes what the slot's promotion set should be: the strict
// top-promote cut of the cumulative standings, else the standing organizer
// ruling (which covers abandoned tables and may exist without any matches).
func (s *TournamentService) desiredOutcome(ctx context.Context, q *db.Queries, slot db.GetTournamentSlotRow) (desired []id.ID, have bool, err error) {
	results, err := q.ListSlotMatchResults(ctx, slot.ID)
	if err != nil {
		return nil, false, fmt.Errorf("list slot matches: %w", err)
	}
	var matchResults []bracket.MatchResult
	lastID := id.ID("")
	for _, r := range results {
		if r.MatchID != lastID {
			matchResults = append(matchResults, bracket.MatchResult{
				MatchID: r.MatchID,
				Scores:  make(map[id.ID]float64, 4),
			})
			lastID = r.MatchID
		}
		mr := &matchResults[len(matchResults)-1]
		mr.Scores[r.PlayerID] = r.Score
	}
	if len(matchResults) > 0 {
		sts := bracket.Standings(matchResults, int(slot.SeatCount))
		if bracket.StrictCut(sts, int(slot.Promote)) {
			desired = make([]id.ID, 0, slot.Promote)
			for i := 0; i < int(slot.Promote); i++ {
				desired = append(desired, sts[i].PlayerID)
			}
			return desired, true, nil
		}
	}

	// No strict cut: a standing ruling decides, if present.
	if slot.Ruling != nil {
		var ruling []id.ID
		if err := json.Unmarshal(slot.Ruling, &ruling); err != nil {
			return nil, false, fmt.Errorf("parse ruling: %w", err)
		}
		if len(ruling) == int(slot.Promote) {
			return ruling, true, nil
		}
	}
	return nil, false, nil
}

// outcomeChanged reports whether the desired ordered promotion set differs
// from the stored one (order matters — it drives downstream source places).
func outcomeChanged(desired []id.ID, have bool, stored []db.TournamentSlotPromotion) bool {
	if !have {
		return len(stored) > 0
	}
	if len(desired) != len(stored) {
		return true
	}
	byPlace := make(map[int32]id.ID, len(stored))
	for _, p := range stored {
		byPlace[p.Place] = p.PlayerID
	}
	for i, pid := range desired {
		if byPlace[int32(i+1)] != pid {
			return true
		}
	}
	return false
}

// voidSlotIfDirty voids a downstream slot that already has linked matches or
// recorded promotions (or a ruling): links and promotions are deleted, every
// removal audited with the origin chain, and the invalidation recurses.
func (s *TournamentService) voidSlotIfDirty(ctx context.Context, q *db.Queries, actor id.ID, slot db.ListSlotsBySourceRow, originKind, originID string) error {
	hasMatches, err := q.SlotHasMatches(ctx, slot.ID)
	if err != nil {
		return fmt.Errorf("check slot matches: %w", err)
	}
	hasPromotions, err := q.SlotHasPromotions(ctx, slot.ID)
	if err != nil {
		return fmt.Errorf("check slot promotions: %w", err)
	}
	if !hasMatches && !hasPromotions {
		return nil
	}

	matches, err := q.ListSlotMatchResults(ctx, slot.ID)
	if err != nil {
		return fmt.Errorf("list slot matches: %w", err)
	}
	seen := make(map[id.ID]bool, len(matches))
	for _, r := range matches {
		if seen[r.MatchID] {
			continue
		}
		seen[r.MatchID] = true
		if err := recordAuditEvent(ctx, q, actor, audit.EntityTournament, audit.ActionUpdated, slot.TournamentID,
			audit.KindSlotLink, audit.NewSlotLinkDetails(audit.SlotLinkVoid, string(slot.ID), string(r.MatchID),
				originKind, originID)); err != nil {
			return err
		}
	}
	if err := q.DeleteSlotMatches(ctx, slot.ID); err != nil {
		return fmt.Errorf("delete slot matches: %w", err)
	}
	if err := q.DeleteSlotPromotions(ctx, slot.ID); err != nil {
		return fmt.Errorf("delete slot promotions: %w", err)
	}
	if err := q.SetSlotRuling(ctx, db.SetSlotRulingParams{ID: slot.ID, Ruling: nil}); err != nil {
		return fmt.Errorf("clear ruling: %w", err)
	}
	if err := s.refreshDownstreamStatus(ctx, q, slot.ID); err != nil {
		return err
	}

	// The cascade continues: everything fed by this slot is now invalid.
	children, err := q.ListSlotsBySource(ctx, slot.ID)
	if err != nil {
		return fmt.Errorf("list downstream slots: %w", err)
	}
	for _, d := range children {
		if err := q.ClearSlotSeatCaches(ctx, slot.ID); err != nil {
			return fmt.Errorf("clear seat caches: %w", err)
		}
		if err := s.voidSlotIfDirty(ctx, q, actor, d, audit.LinkOriginCascade, string(slot.ID)); err != nil {
			return err
		}
	}
	return nil
}

// refreshDownstreamStatus keeps the slot status in step with seat resolution:
// waiting→playing once every seat is resolved, playing→waiting when the seat
// caches were cleared because the source outcome disappeared.
func (s *TournamentService) refreshDownstreamStatus(ctx context.Context, q *db.Queries, slotID id.ID) error {
	slot, err := q.GetTournamentSlot(ctx, slotID)
	if err != nil {
		return fmt.Errorf("get slot: %w", err)
	}
	unresolved, err := q.CountUnresolvedSeats(ctx, slotID)
	if err != nil {
		return fmt.Errorf("count unresolved seats: %w", err)
	}
	switch {
	case unresolved == 0 && slot.Status == TournamentSlotWaiting:
		return q.SetSlotStatus(ctx, db.SetSlotStatusParams{ID: slotID, Status: TournamentSlotPlaying})
	case unresolved > 0 && slot.Status == TournamentSlotPlaying:
		return q.SetSlotStatus(ctx, db.SetSlotStatusParams{ID: slotID, Status: TournamentSlotWaiting})
	}
	return nil
}

// completeTournament records the champion and closes the lifecycle.
func (s *TournamentService) completeTournament(ctx context.Context, q *db.Queries, actor id.ID, tid, winner id.ID) error {
	t, err := q.GetTournamentForUpdate(ctx, tid)
	if err != nil {
		return fmt.Errorf("get tournament: %w", err)
	}
	if t.Status != TournamentRunning {
		return nil // cancelled meanwhile — the state stays read-only
	}
	if err := q.SetTournamentCompleted(ctx, db.SetTournamentCompletedParams{ID: tid, WinnerPlayerID: &winner}); err != nil {
		return fmt.Errorf("complete tournament: %w", err)
	}
	return recordAuditEvent(ctx, q, actor, audit.EntityTournament, audit.ActionUpdated, tid,
		audit.KindTournamentState, audit.NewTournamentStateDetails(TournamentRunning, TournamentCompleted, audit.StateReasonFinal))
}
