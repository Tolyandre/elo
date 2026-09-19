package elo

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5/pgtype"
	"math/rand"
	"slices"
	"time"

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
	// CheckAssociationEditable rejects association-breaking edits (409): a
	// linked match keeps its exact player set and game.
	CheckAssociationEditable(ctx context.Context, q *db.Queries, matchID, gameID id.ID, playerIDs []id.ID) error
	// SetMatchLinkState applies the edit form's desired tournament-link state
	// (ADR-26): true detaches a stored link (guarded against voiding played
	// downstream matches), false attaches to the unique fitting playing slot,
	// and an already-satisfied state is a no-op. Runs inside the match-write tx.
	SetMatchLinkState(ctx context.Context, q *db.Queries, matchID id.ID, ensureUnlinked bool, actor id.ID) error
	// OnMatchChanged re-evaluates the slot owning an edited match.
	OnMatchChanged(ctx context.Context, q *db.Queries, matchID, actor id.ID) error
}

// acceptanceCandidate rows arrive in the deterministic acceptance order
// (track, round index, table position); seated-set equality is checked per
// candidate against its seats.

// AcceptMatch implements ITournamentPlay.
func (s *TournamentService) AcceptMatch(ctx context.Context, q *db.Queries, matchID, gameID id.ID, playerIDs []id.ID, actor id.ID) error {
	// The lazy deadline check precedes acceptance: a tournament whose
	// grand-final deadline passed no longer takes matches.
	if err := s.enforceDeadlineTx(ctx, q); err != nil {
		return err
	}
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
		// safeguard): link the match, record the tournament-membership link
		// (the arena counts slot-linked matches), audit, and re-evaluate the
		// slot.
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
	// or re-attached (re-acceptance is deliberately not automatic). The direct
	// voids carry the triggering event in the audit origin chain; deeper ones
	// carry the upstream slot whose change cascaded. The refill uses the
	// source's FULL derived placing: losers-bracket and merge seats source
	// drops (places beyond promote), which promotions do not record.
	directKind, directID := originKind, originID
	if directKind == "" {
		directKind, directID = audit.LinkOriginCascade, string(slotID)
	}
	downstream, err := q.ListSlotsBySource(ctx, slotID)
	if err != nil {
		return fmt.Errorf("list downstream slots: %w", err)
	}
	for _, d := range downstream {
		if haveOutcome {
			if err := s.refillSeatCaches(ctx, q, slot, desired); err != nil {
				return fmt.Errorf("refill seats: %w", err)
			}
		} else {
			if err := q.ClearSlotSeatCaches(ctx, slotID); err != nil {
				return fmt.Errorf("clear seat caches: %w", err)
			}
		}
		if err := s.voidSlotIfDirty(ctx, q, actor, d, directKind, directID); err != nil {
			return err
		}
		if err := s.refreshDownstreamStatus(ctx, q, d.ID); err != nil {
			return err
		}
	}

	// A completed tournament whose bracket just changed can no longer trust
	// its champion — revert to running (the grand final is re-decided); the
	// revert is audited.
	if err := s.revertCompletedTournament(ctx, q, actor, slot.TournamentID); err != nil {
		return err
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

// revertCompletedTournament flips a completed tournament back to running when
// its bracket changed after completion (an edit cascade invalidated the
// champion); a no-op in every other state.
func (s *TournamentService) revertCompletedTournament(ctx context.Context, q *db.Queries, actor id.ID, tid id.ID) error {
	t, err := q.GetTournament(ctx, tid)
	if err != nil {
		return fmt.Errorf("get tournament: %w", err)
	}
	if t.Status != TournamentCompleted {
		return nil
	}
	if err := q.SetTournamentStatus(ctx, db.SetTournamentStatusParams{ID: tid, Status: TournamentRunning}); err != nil {
		return fmt.Errorf("revert to running: %w", err)
	}
	if err := q.ClearTournamentWinner(ctx, tid); err != nil {
		return fmt.Errorf("clear winner: %w", err)
	}
	return recordAuditEvent(ctx, q, actor, audit.EntityTournament, audit.ActionUpdated, tid,
		audit.KindTournamentState, audit.NewTournamentStateDetails(TournamentCompleted, TournamentRunning, audit.StateReasonCascade))
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
	var voided []id.ID
	for _, r := range matches {
		if seen[r.MatchID] {
			continue
		}
		seen[r.MatchID] = true
		voided = append(voided, r.MatchID)
		if err := recordAuditEvent(ctx, q, actor, audit.EntityTournament, audit.ActionUpdated, slot.TournamentID,
			audit.KindSlotLink, audit.NewSlotLinkDetails(audit.SlotLinkVoid, string(slot.ID), string(r.MatchID),
				originKind, originID)); err != nil {
			return err
		}
	}
	if err := q.DeleteSlotMatches(ctx, slot.ID); err != nil {
		return fmt.Errorf("delete slot matches: %w", err)
	}
	// The voided matches leave the tournament arena together with the bracket
	// (ADR-26: arena membership follows the slot link); the stale mark below
	// schedules the arena's full recalculation.
	if err := s.forgetTournamentMatches(ctx, q, slot.TournamentID, voided); err != nil {
		return err
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
	case unresolved > 0 && slot.Status != TournamentSlotWaiting:
		// Seat caches cleared by a cascade (a voided slot included) — the
		// slot must be re-played by whoever advances.
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

// ---------------------------------------------------------------------------
// Edit consistency (ADR-26 §Editing without paradoxes)
// ---------------------------------------------------------------------------

// SlotRef identifies the bracket slot a match counts for.
type SlotRef struct {
	SlotID       id.ID
	TournamentID id.ID
}

// SlotOfMatch returns the slot the match is counted for, or nil.
func (s *TournamentService) SlotOfMatch(ctx context.Context, q *db.Queries, matchID id.ID) (*SlotRef, error) {
	rows, err := q.ListSlotMatchesForMatchIDs(ctx, []id.ID{matchID})
	if err != nil {
		return nil, fmt.Errorf("list slot links: %w", err)
	}
	if len(rows) == 0 {
		return nil, nil
	}
	return &SlotRef{SlotID: rows[0].SlotID, TournamentID: rows[0].TournamentID}, nil
}

// CheckAssociationEditable rejects association-breaking edits: a linked match
// keeps its exact player set and game — editing never silently changes
// whether a match counts for the tournament (the organizer detaches first).
// Scores, date and calculator data stay freely editable.
func (s *TournamentService) CheckAssociationEditable(ctx context.Context, q *db.Queries, matchID, gameID id.ID, playerIDs []id.ID) error {
	ref, err := s.SlotOfMatch(ctx, q, matchID)
	if err != nil || ref == nil {
		return err
	}
	slot, err := q.GetTournamentSlot(ctx, ref.SlotID)
	if err != nil {
		return fmt.Errorf("get slot: %w", err)
	}
	if slot.GameID != gameID {
		return ErrSlotAssociationLocked
	}
	seats, err := q.ListSeatsBySlots(ctx, []id.ID{ref.SlotID})
	if err != nil {
		return fmt.Errorf("list seats: %w", err)
	}
	if !seatSetEquals(seats, playerIDs) {
		return ErrSlotAssociationLocked
	}
	return nil
}

// OnMatchChanged re-evaluates the slot owning an edited match: points
// recompute, the strict top-promote set is re-evaluated, and a changed
// outcome cascades (audit origin: the triggering match edit).
func (s *TournamentService) OnMatchChanged(ctx context.Context, q *db.Queries, matchID, actor id.ID) error {
	if err := s.enforceDeadlineTx(ctx, q); err != nil {
		return err
	}
	ref, err := s.SlotOfMatch(ctx, q, matchID)
	if err != nil || ref == nil {
		return err
	}
	return s.recomputeSlot(ctx, q, actor, ref.SlotID, audit.LinkOriginMatchEdit, string(matchID))
}

// SetMatchLinkState applies the edit form's desired tournament-link state
// (ADR-26): ensureUnlinked detaches a stored slot link; ensureLinked attaches
// the match to its unique fitting playing slot — the same equality rule as
// acceptance, but "fits nothing" is an error instead of a silent skip (a
// playing slot has no recorded promotions, so attaching can never invalidate
// played history). A desired state that already holds is a no-op with no
// audit rows. Detaching is refused while any downstream slot still holds
// linked matches — voiding played rounds stays the organizer's explicit
// tool. Runs inside the match-write tx; audit origin: match edit.
func (s *TournamentService) SetMatchLinkState(ctx context.Context, q *db.Queries, matchID id.ID, ensureUnlinked bool, actor id.ID) error {
	if err := s.enforceDeadlineTx(ctx, q); err != nil {
		return err
	}
	ref, err := s.SlotOfMatch(ctx, q, matchID)
	if err != nil {
		return err
	}
	if ensureUnlinked {
		if ref == nil {
			return nil // already out of the bracket — nothing to change
		}
		if err := s.downstreamHasPlayedMatches(ctx, q, ref.SlotID); err != nil {
			return err
		}
		if err := q.DeleteSlotMatch(ctx, db.DeleteSlotMatchParams{SlotID: ref.SlotID, MatchID: matchID}); err != nil {
			return fmt.Errorf("unlink match: %w", err)
		}
		// The match leaves the tournament arena together with the bracket
		// (ADR-26); the match-write flow drains the arena later in its tx.
		if err := s.forgetTournamentMatches(ctx, q, ref.TournamentID, []id.ID{matchID}); err != nil {
			return err
		}
		if err := recordAuditEvent(ctx, q, actor, audit.EntityTournament, audit.ActionUpdated, ref.TournamentID,
			audit.KindSlotLink, audit.NewSlotLinkDetails(audit.SlotLinkDetach, string(ref.SlotID), string(matchID),
				audit.LinkOriginMatchEdit, "")); err != nil {
			return err
		}
		return s.recomputeSlot(ctx, q, actor, ref.SlotID, audit.LinkOriginMatchEdit, string(matchID))
	}

	// ensureLinked: already counted is a no-op; otherwise find the unique
	// fitting playing slot (deterministic acceptance order).
	if ref != nil {
		return nil
	}
	m, err := q.GetMatch(ctx, matchID)
	if err != nil {
		return fmt.Errorf("get match: %w", err)
	}
	scores, err := q.GetMatchScores(ctx, matchID)
	if err != nil {
		return fmt.Errorf("get match scores: %w", err)
	}
	playerIDs := make([]id.ID, 0, len(scores))
	for _, sc := range scores {
		playerIDs = append(playerIDs, sc.PlayerID)
	}
	candidates, err := q.ListAcceptanceCandidates(ctx, m.GameID)
	if err != nil {
		return fmt.Errorf("list acceptance candidates: %w", err)
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
		if err := q.AddSlotMatch(ctx, db.AddSlotMatchParams{SlotID: c.ID, MatchID: matchID}); err != nil {
			return fmt.Errorf("link match to slot: %w", err)
		}
		if err := q.AddTournamentMatch(ctx, db.AddTournamentMatchParams{TournamentID: c.TournamentID, MatchID: matchID}); err != nil {
			return fmt.Errorf("link match to tournament: %w", err)
		}
		if err := recordAuditEvent(ctx, q, actor, audit.EntityTournament, audit.ActionUpdated, c.TournamentID,
			audit.KindSlotLink, audit.NewSlotLinkDetails(audit.SlotLinkAttach, string(c.ID), string(matchID),
				audit.LinkOriginMatchEdit, "")); err != nil {
			return err
		}
		return s.recomputeSlot(ctx, q, actor, c.ID, audit.LinkOriginMatchEdit, string(matchID))
	}
	return ErrTournamentMatchFitsNoSlot
}

// downstreamHasPlayedMatches reports whether any slot reachable through the
// promotions holds linked matches: a link-state change would then void rounds
// that were actually played, which the edit form must not do silently
// (ErrTournamentLinkChangeUnsafe).
func (s *TournamentService) downstreamHasPlayedMatches(ctx context.Context, q *db.Queries, slotID id.ID) error {
	downstream, err := q.ListSlotsBySource(ctx, slotID)
	if err != nil {
		return fmt.Errorf("list downstream slots: %w", err)
	}
	for _, d := range downstream {
		if has, err := q.SlotHasMatches(ctx, d.ID); err != nil {
			return fmt.Errorf("check slot matches: %w", err)
		} else if has {
			return ErrTournamentLinkChangeUnsafe
		}
		if err := s.downstreamHasPlayedMatches(ctx, q, d.ID); err != nil {
			return err
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Organizer tooling + grand-final deadline (ADR-26 §Organizer ruling /
// §Explicit corrections / §Organizer adjustments / §Grand-final deadline)
// ---------------------------------------------------------------------------

// SetRuling records the organizer's ordered promotion set for a slot
// (abandoned tables, no-shows, disputes). The ruling replaces the current
// outcome and can be replaced by the standings-based result: recompute
// prefers a strict cut, clears the ruling and audits the revert when the
// scores later decide on their own.
func (s *TournamentService) SetRuling(ctx context.Context, tid, slotID, actorUserID id.ID, playerIDs []id.ID) error {
	return runInTx(ctx, s.Pool, func(q *db.Queries) error {
		if err := s.enforceDeadlineTx(ctx, q); err != nil {
			return err
		}
		slot, err := s.slotOfTournament(ctx, q, tid, slotID)
		if err != nil {
			return err
		}
		if slot.Status == TournamentSlotWaiting {
			return ErrTournamentSlotNotPlaying
		}
		if len(playerIDs) != int(slot.Promote) {
			return ErrTournamentRulingInvalid
		}
		seats, err := q.ListSeatsBySlots(ctx, []id.ID{slotID})
		if err != nil {
			return fmt.Errorf("list seats: %w", err)
		}
		seated := make(map[id.ID]bool, len(seats))
		for _, se := range seats {
			if se.PlayerID != nil {
				seated[*se.PlayerID] = true
			}
		}
		for _, p := range playerIDs {
			if !seated[p] {
				return ErrTournamentRulingInvalid
			}
		}

		// Audit the decision (before = the prior recorded outcome, if any).
		stored, err := q.ListSlotPromotions(ctx, slotID)
		if err != nil {
			return fmt.Errorf("list promotions: %w", err)
		}
		op := audit.RulingSet
		var before []string
		if len(stored) > 0 {
			op = audit.RulingReplace
			byPlace := make(map[int32]id.ID, len(stored))
			for _, p := range stored {
				byPlace[p.Place] = p.PlayerID
			}
			for i := 0; i < len(stored); i++ {
				before = append(before, string(byPlace[int32(i+1)]))
			}
		}
		if err := recordAuditEvent(ctx, q, actorUserID, audit.EntityTournament, audit.ActionUpdated, tid,
			audit.KindSlotRuling, audit.NewSlotRulingDetails(op, string(slotID), before, idStrings(playerIDs))); err != nil {
			return err
		}

		rulingRaw, err := json.Marshal(playerIDs)
		if err != nil {
			return fmt.Errorf("marshal ruling: %w", err)
		}
		if err := q.SetSlotRuling(ctx, db.SetSlotRulingParams{ID: slotID, Ruling: rulingRaw}); err != nil {
			return fmt.Errorf("set ruling: %w", err)
		}
		if err := s.recomputeSlot(ctx, q, actorUserID, slotID, audit.LinkOriginOrganizer, ""); err != nil {
			return err
		}
		// The recompute cascade may have voided downstream slot links — their
		// matches left the arena; refresh it (a no-op while nothing is stale).
		return s.refreshTournamentArena(ctx, q, tid)
	})
}

// AttachMatch links an existing, still-unlinked match to a playing slot —
// the repair for a mistakenly unchecked checkbox (same equality rules as
// acceptance).
func (s *TournamentService) AttachMatch(ctx context.Context, tid, slotID, matchID, actorUserID id.ID) error {
	return runInTx(ctx, s.Pool, func(q *db.Queries) error {
		if err := s.enforceDeadlineTx(ctx, q); err != nil {
			return err
		}
		slot, err := s.slotOfTournament(ctx, q, tid, slotID)
		if err != nil {
			return err
		}
		if slot.Status != TournamentSlotPlaying {
			return ErrTournamentSlotNotPlaying
		}
		if ref, err := s.SlotOfMatch(ctx, q, matchID); err != nil {
			return err
		} else if ref != nil {
			return ErrMatchAlreadyLinked
		}
		m, err := q.GetMatch(ctx, matchID)
		if err != nil {
			return fmt.Errorf("get match: %w", err)
		}
		if m.GameID != slot.GameID {
			return ErrTournamentMatchFitsNoSlot
		}
		scores, err := q.GetMatchScores(ctx, matchID)
		if err != nil {
			return fmt.Errorf("get match scores: %w", err)
		}
		playerIDs := make([]id.ID, 0, len(scores))
		for _, sc := range scores {
			playerIDs = append(playerIDs, sc.PlayerID)
		}
		seats, err := q.ListSeatsBySlots(ctx, []id.ID{slotID})
		if err != nil {
			return fmt.Errorf("list seats: %w", err)
		}
		if !seatSetEquals(seats, playerIDs) {
			return ErrTournamentMatchFitsNoSlot
		}

		if err := q.AddSlotMatch(ctx, db.AddSlotMatchParams{SlotID: slotID, MatchID: matchID}); err != nil {
			return fmt.Errorf("link match to slot: %w", err)
		}
		if err := q.AddTournamentMatch(ctx, db.AddTournamentMatchParams{TournamentID: tid, MatchID: matchID}); err != nil {
			return fmt.Errorf("link match to tournament: %w", err)
		}
		// The arena's match set grew; refresh it at the end of this tx.
		if err := recordAuditEvent(ctx, q, actorUserID, audit.EntityTournament, audit.ActionUpdated, tid,
			audit.KindSlotLink, audit.NewSlotLinkDetails(audit.SlotLinkAttach, string(slotID), string(matchID),
				audit.LinkOriginOrganizer, "")); err != nil {
			return err
		}
		if err := s.recomputeSlot(ctx, q, actorUserID, slotID, audit.LinkOriginOrganizer, ""); err != nil {
			return err
		}
		return s.refreshTournamentArena(ctx, q, tid)
	})
}

// DetachMatch removes a wrongly linked match from its slot — the match leaves
// the tournament arena together with the bracket (ADR-26) — then
// re-evaluates the slot and refreshes the arena synchronously.
func (s *TournamentService) DetachMatch(ctx context.Context, tid, slotID, matchID, actorUserID id.ID) error {
	return runInTx(ctx, s.Pool, func(q *db.Queries) error {
		if err := s.enforceDeadlineTx(ctx, q); err != nil {
			return err
		}
		if _, err := s.slotOfTournament(ctx, q, tid, slotID); err != nil {
			return err
		}
		ref, err := s.SlotOfMatch(ctx, q, matchID)
		if err != nil {
			return err
		}
		if ref == nil || ref.SlotID != slotID {
			return ErrTournamentMatchNotLinked
		}
		if err := q.DeleteSlotMatch(ctx, db.DeleteSlotMatchParams{SlotID: slotID, MatchID: matchID}); err != nil {
			return fmt.Errorf("unlink match: %w", err)
		}
		if err := s.forgetTournamentMatches(ctx, q, tid, []id.ID{matchID}); err != nil {
			return err
		}
		if err := recordAuditEvent(ctx, q, actorUserID, audit.EntityTournament, audit.ActionUpdated, tid,
			audit.KindSlotLink, audit.NewSlotLinkDetails(audit.SlotLinkDetach, string(slotID), string(matchID),
				audit.LinkOriginOrganizer, "")); err != nil {
			return err
		}
		if err := s.recomputeSlot(ctx, q, actorUserID, slotID, audit.LinkOriginOrganizer, ""); err != nil {
			return err
		}
		// An organizer call, not a match write: refresh the affected arena
		// here (a no-op while nothing is stale).
		return s.refreshTournamentArena(ctx, q, tid)
	})
}

// AdjustSlotGame reassigns a slot's game — only while no match is linked.
func (s *TournamentService) AdjustSlotGame(ctx context.Context, tid, slotID, gameID, actorUserID id.ID) error {
	return runInTx(ctx, s.Pool, func(q *db.Queries) error {
		if err := s.enforceDeadlineTx(ctx, q); err != nil {
			return err
		}
		if _, err := s.slotOfTournament(ctx, q, tid, slotID); err != nil {
			return err
		}
		if has, err := q.SlotHasMatches(ctx, slotID); err != nil {
			return fmt.Errorf("check slot matches: %w", err)
		} else if has {
			return ErrTournamentSlotAdjustInvalid
		}
		if err := q.SetSlotGame(ctx, db.SetSlotGameParams{ID: slotID, GameID: gameID}); err != nil {
			return fmt.Errorf("set slot game: %w", err)
		}
		return recordAuditEvent(ctx, q, actorUserID, audit.EntityTournament, audit.ActionUpdated, tid,
			audit.KindSlotAdjust, audit.NewSlotGameAdjust(string(slotID), string(gameID)))
	})
}

// AdjustSlotSeatCount changes a first-round slot's seat count (zero linked
// matches, direct seats only — the draw seats re-deal from the stored seed,
// absorbing bye players when the table grows). promote stays put, so the
// downstream arithmetic is untouched.
func (s *TournamentService) AdjustSlotSeatCount(ctx context.Context, tid, slotID, actorUserID id.ID, seatCount int) error {
	return runInTx(ctx, s.Pool, func(q *db.Queries) error {
		if err := s.enforceDeadlineTx(ctx, q); err != nil {
			return err
		}
		slot, err := s.slotOfTournament(ctx, q, tid, slotID)
		if err != nil {
			return err
		}
		if slot.Track != bracket.TrackWinners || slot.RoundIndex != 1 {
			return ErrTournamentSlotAdjustInvalid
		}
		if has, err := q.SlotHasMatches(ctx, slotID); err != nil {
			return fmt.Errorf("check slot matches: %w", err)
		} else if has {
			return ErrTournamentSlotAdjustInvalid
		}
		if has, err := q.SlotHasPromotions(ctx, slotID); err != nil {
			return fmt.Errorf("check slot promotions: %w", err)
		} else if has {
			return ErrTournamentSlotAdjustInvalid
		}
		if seatCount < 2 || seatCount <= int(slot.Promote) {
			return ErrTournamentPoolEntryInvalid
		}
		// The new size must fit some pool game.
		pool, err := q.ListTournamentGames(ctx, tid)
		if err != nil {
			return fmt.Errorf("list pool: %w", err)
		}
		fits := false
		for _, g := range pool {
			if seatCount >= int(g.MinPlayers) && seatCount <= int(g.MaxPlayers) {
				fits = true
				break
			}
		}
		if !fits {
			return ErrTournamentPoolEntryInvalid
		}

		seats, err := q.ListSeatsBySlots(ctx, []id.ID{slotID})
		if err != nil {
			return fmt.Errorf("list seats: %w", err)
		}
		current := make([]id.ID, 0, len(seats))
		for _, se := range seats {
			if se.SourceSlotID != nil {
				// A slot with provenance seats is downstream — not adjustable.
				return ErrTournamentSlotAdjustInvalid
			}
			current = append(current, *se.PlayerID)
		}

		// Growing absorbs the tournament's bye players (plan-declared bye
		// seats in later rounds), each only from a slot that recorded nothing.
		if seatCount > len(current) {
			byes, err := s.byePlayerSeats(ctx, q, tid)
			if err != nil {
				return err
			}
			need := seatCount - len(current)
			if len(byes) < need {
				return ErrTournamentSlotAdjustInvalid
			}
			for _, b := range byes[:need] {
				if has, err := q.SlotHasMatches(ctx, b.slot.ID); err != nil {
					return fmt.Errorf("check bye slot: %w", err)
				} else if has {
					return ErrTournamentSlotAdjustInvalid
				}
				if has, err := q.SlotHasPromotions(ctx, b.slot.ID); err != nil {
					return fmt.Errorf("check bye slot: %w", err)
				} else if has {
					return ErrTournamentSlotAdjustInvalid
				}
				current = append(current, *b.seat.PlayerID)
				// The bye seat leaves its later-round slot; that slot's
				// arithmetic is unaffected (its promote is fixed).
				if err := q.DeleteSlotSeat(ctx, db.DeleteSlotSeatParams{SlotID: b.slot.ID, Position: b.seat.Position}); err != nil {
					return fmt.Errorf("drop bye seat: %w", err)
				}
			}
		}

		// Re-deal from the stored seed (a per-slot deterministic stream).
		row, err := q.GetTournamentPlan(ctx, tid)
		if err != nil {
			return fmt.Errorf("get plan: %w", err)
		}
		if !row.Seed.Valid {
			return ErrTournamentNotStarted
		}
		rng := rand.New(rand.NewSource(row.Seed.Int64 ^ int64(binary.BigEndian.Uint64([]byte(slotID)[:8]))))
		deal := slices.Clone(current)
		rng.Shuffle(len(deal), func(i, j int) { deal[i], deal[j] = deal[j], deal[i] })

		if err := q.DeleteSlotSeats(ctx, slotID); err != nil {
			return fmt.Errorf("clear seats: %w", err)
		}
		for pos := 0; pos < seatCount; pos++ {
			p := deal[pos]
			if err := q.CreateTournamentSeat(ctx, db.CreateTournamentSeatParams{
				ID: id.New(), SlotID: slotID, Position: int32(pos + 1),
				PlayerID: &p, SourceSlotID: nil, SourcePlace: pgtype.Int4{},
			}); err != nil {
				return fmt.Errorf("re-create seat: %w", err)
			}
		}
		return recordAuditEvent(ctx, q, actorUserID, audit.EntityTournament, audit.ActionUpdated, tid,
			audit.KindSlotAdjust, audit.NewSlotSeatCountAdjust(string(slotID), seatCount))
	})
}

// byeSeat is one plan-declared bye seat with its materialized coordinates.
type byeSeat struct {
	slot db.ListTournamentSlotsRow
	seat db.TournamentSeat
}

// byePlayerSeats walks the stored plan's bye seats and resolves their
// materialized (slot, seat) rows.
func (s *TournamentService) byePlayerSeats(ctx context.Context, q *db.Queries, tid id.ID) ([]byeSeat, error) {
	row, err := q.GetTournamentPlan(ctx, tid)
	if err != nil {
		return nil, fmt.Errorf("get plan: %w", err)
	}
	plan, err := bracket.ParsePlan(row.Plan)
	if err != nil {
		return nil, fmt.Errorf("parse plan: %w", err)
	}
	slots, err := q.ListTournamentSlots(ctx, tid)
	if err != nil {
		return nil, fmt.Errorf("list slots: %w", err)
	}
	byAddress := make(map[[2]int]db.ListTournamentSlotsRow, len(slots))
	for _, sl := range slots {
		byAddress[[2]int{tournamentTrackRank[sl.Track], int(sl.RoundIndex)}] = sl
	}
	allSeats, err := q.ListSeatsBySlots(ctx, func() []id.ID {
		ids := make([]id.ID, 0, len(slots))
		for _, sl := range slots {
			ids = append(ids, sl.ID)
		}
		return ids
	}())
	if err != nil {
		return nil, fmt.Errorf("list seats: %w", err)
	}
	seatsBySlot := make(map[id.ID][]db.TournamentSeat, len(slots))
	for _, se := range allSeats {
		seatsBySlot[se.SlotID] = append(seatsBySlot[se.SlotID], se)
	}

	out := make([]byeSeat, 0)
	for ri, r := range plan.Rounds {
		if ri == 0 {
			continue // round-1 draw seats are not byes
		}
		for slotPos, ps := range r.Slots {
			key := [2]int{tournamentTrackRank[r.Track], r.Index}
			slotRow, ok := byAddress[key]
			if !ok {
				continue
			}
			_ = slotPos
			for seatPos, seat := range ps.Seats {
				if seat.Kind != bracket.SeatBye {
					continue
				}
				for _, se := range seatsBySlot[slotRow.ID] {
					if int(se.Position) == seatPos+1 {
						out = append(out, byeSeat{slot: slotRow, seat: se})
					}
				}
			}
		}
	}
	return out, nil
}

// EnforceGrandFinalDeadline cancels every running tournament whose deadline
// passed without a completed grand final (lazy — reads and writes correct the
// stale status; no background sweeper, ADR-26). System actor: NULL.
func (s *TournamentService) EnforceGrandFinalDeadline(ctx context.Context) error {
	return runInTx(ctx, s.Pool, func(q *db.Queries) error {
		return s.enforceDeadlineTx(ctx, q)
	})
}

func (s *TournamentService) enforceDeadlineTx(ctx context.Context, q *db.Queries) error {
	stale, err := q.ListRunningTournamentsPastDeadline(ctx)
	if err != nil {
		return fmt.Errorf("list deadline tournaments: %w", err)
	}
	for _, t := range stale {
		if err := q.SetTournamentStatus(ctx, db.SetTournamentStatusParams{ID: t.ID, Status: TournamentCancelled}); err != nil {
			return fmt.Errorf("deadline cancel: %w", err)
		}
		if err := recordAuditEvent(ctx, q, "", audit.EntityTournament, audit.ActionUpdated, t.ID,
			audit.KindTournamentState, audit.NewTournamentStateDetails(TournamentRunning, TournamentCancelled, audit.StateReasonDeadline)); err != nil {
			return err
		}
	}
	return nil
}

// forgetTournamentMatches removes the tournament-membership rows of the given
// matches and schedules the tournament arena's full recalculation — the arena
// counts exactly the slot-linked matches, so a match that leaves its slot
// (detach or void) leaves the arena too (ADR-26). The recalculation itself
// runs at the end of the enclosing flow (the match-write drain, or
// refreshTournamentArena for the organizer endpoints). A no-op for an empty
// list or a tournament without its auto-created arena yet.
func (s *TournamentService) forgetTournamentMatches(ctx context.Context, q *db.Queries, tid id.ID, matchIDs []id.ID) error {
	for _, mid := range matchIDs {
		if err := q.DeleteTournamentMatch(ctx, mid); err != nil {
			return fmt.Errorf("unlink match from tournament: %w", err)
		}
	}
	if len(matchIDs) == 0 {
		return nil
	}
	return s.markTournamentArenaStale(ctx, q, tid)
}

// markTournamentArenaStale schedules a full recalculation of the tournament's
// auto-created arena (membership rows changed, so from-date marks would not
// cover removed matches' older settlements). A no-op while the arena does not
// exist (the tournament has not started).
func (s *TournamentService) markTournamentArenaStale(ctx context.Context, q *db.Queries, tid id.ID) error {
	arena, err := q.GetArenaByTournament(ctx, &tid)
	if db.IsNoRows(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("get tournament arena: %w", err)
	}
	return q.MarkArenasStaleFull(ctx, []id.ID{arena.ID})
}

// refreshTournamentArena recalculates the tournament's auto-created arena
// synchronously — the refresh for the organizer endpoints that change arena
// membership without writing a match (attach, detach, ruling cascades). A
// no-op while the arena does not exist.
func (s *TournamentService) refreshTournamentArena(ctx context.Context, q *db.Queries, tid id.ID) error {
	arena, err := q.GetArenaByTournament(ctx, &tid)
	if db.IsNoRows(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("get tournament arena: %w", err)
	}
	if err := q.MarkArenasStaleFull(ctx, []id.ID{arena.ID}); err != nil {
		return fmt.Errorf("mark tournament arena stale: %w", err)
	}
	return s.Arenas.MarkAndDrainAfterMatchWrite(ctx, q, []id.ID{arena.ID}, time.Now())
}

// slotOfTournament loads the slot row and verifies it belongs to the
// tournament the route addressed.
func (s *TournamentService) slotOfTournament(ctx context.Context, q *db.Queries, tid, slotID id.ID) (db.GetTournamentSlotRow, error) {
	slot, err := q.GetTournamentSlot(ctx, slotID)
	if err != nil {
		if db.IsNoRows(err) {
			return db.GetTournamentSlotRow{}, ErrTournamentSlotNotFound
		}
		return db.GetTournamentSlotRow{}, fmt.Errorf("get slot: %w", err)
	}
	if slot.TournamentID != tid {
		return db.GetTournamentSlotRow{}, ErrTournamentSlotNotFound
	}
	return slot, nil
}

// refillSeatCaches fills every downstream seat fed by the source slot from
// the source's full placing. Places 1..promote come from the recorded
// outcome; places beyond it (the drops the losers bracket and merges seat)
// come from the derived standings' total order — standings are never stored,
// so the refill re-derives them from the linked matches' scores.
func (s *TournamentService) refillSeatCaches(ctx context.Context, q *db.Queries, source db.GetTournamentSlotRow, promoted []id.ID) error {
	// The placing: the promoted prefix is fixed; the rest follows the
	// standings order (deterministic even on dropped-player ties).
	placing := append([]id.ID(nil), promoted...)
	results, err := q.ListSlotMatchResults(ctx, source.ID)
	if err != nil {
		return fmt.Errorf("list slot matches: %w", err)
	}
	if len(results) > 0 {
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
		if len(matchResults) > 0 && source.SeatCount >= 2 {
			sts := bracket.Standings(matchResults, int(source.SeatCount))
			if len(sts) > len(placing) {
				placing = make([]id.ID, 0, len(sts))
				for _, st := range sts {
					placing = append(placing, st.PlayerID)
				}
			}
		}
	}

	fedSeats, err := q.ListSeatsBySourceSlot(ctx, source.ID)
	if err != nil {
		return fmt.Errorf("list fed seats: %w", err)
	}
	for _, se := range fedSeats {
		place := 0
		if se.SourcePlace.Valid {
			place = int(se.SourcePlace.Int32)
		}
		if place < 1 || place > len(placing) {
			continue // beyond what the source has decided
		}
		p := placing[place-1]
		if err := q.UpdateSeatPlayer(ctx, db.UpdateSeatPlayerParams{ID: se.ID, PlayerID: &p}); err != nil {
			return fmt.Errorf("fill seat cache: %w", err)
		}
	}
	return nil
}
