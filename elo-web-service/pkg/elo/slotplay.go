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

// Slot play (ADR-26 §Slot play / §Acceptance / §Editing without paradoxes,
// scoring amended by ADR-30). A slot is a small series played by the same
// seated players until the advanced set is beyond doubt: every linked match
// scores slot points — a share of the leader's margin (ADR-30) — and the
// slot completes when the top-advance set of the cumulative standings is
// strictly separated and the leader holds at least the organizer's minimal
// score (when one is set). Scores of linked matches are freely editable and
// an advanced set may legitimately change — the invariant is kept by
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
		if err := q.AddTournamentArenaMatch(ctx, db.AddTournamentArenaMatchParams{
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

// recomputeSlot re-derives the slot's outcome — a standing organizer ruling
// first, else the linked matches' scores — records it when it changed, refills
// the downstream seat caches, and recursively voids downstream slots that
// already recorded results — the bracket never lies (ADR-26 §Editing without
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
	stored, err := q.ListSlotAdvances(ctx, slotID)
	if err != nil {
		return fmt.Errorf("list advances: %w", err)
	}
	if !outcomeChanged(desired, haveOutcome, stored) {
		return nil
	}

	// Rewrite the recorded outcome.
	if err := q.DeleteSlotAdvances(ctx, slotID); err != nil {
		return fmt.Errorf("clear advances: %w", err)
	}
	newStatus := TournamentSlotPlaying
	if haveOutcome {
		newStatus = TournamentSlotCompleted
		for place, playerID := range desired {
			if err := q.AddSlotAdvance(ctx, db.AddSlotAdvanceParams{
				SlotID: slotID, PlayerID: playerID, Place: int32(place + 1),
			}); err != nil {
				return fmt.Errorf("record advancement: %w", err)
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
	// drops (places beyond advance), which advancements do not record.
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
	// revert is audited and its settled tournament-winner markets reopen.
	if err := s.revertCompletedTournament(ctx, q, actor, slot.TournamentID); err != nil {
		return err
	}

	// The champion: a final-track slot advancing exactly one player that
	// feeds nobody completes the tournament.
	if haveOutcome && slot.Track == bracket.TrackFinal && slot.Advance == 1 && len(downstream) == 0 {
		if err := s.completeTournament(ctx, q, actor, slot, desired[0]); err != nil {
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
	// Markets settled on the invalidated champion reopen: their tournament is
	// running again and will re-settle (or cancel) with the re-decided final.
	if s.Markets != nil {
		if err := s.Markets.ReopenTournamentWinnerMarkets(ctx, q, tid); err != nil {
			return fmt.Errorf("reopen tournament winner markets: %w", err)
		}
	}
	return recordAuditEvent(ctx, q, actor, audit.EntityTournament, audit.ActionUpdated, tid,
		audit.KindTournamentState, audit.NewTournamentStateDetails(TournamentCompleted, TournamentRunning, audit.StateReasonCascade))
}

// desiredOutcome computes what the slot's advancement set should be: a
// standing organizer ruling — the organizer's explicit decision overrides the
// standings until canceled (empty ruling) or cascade-voided — else the strict
// top-advance cut of the cumulative standings (which covers abandoned tables:
// a ruling may exist without any matches).
func (s *TournamentService) desiredOutcome(ctx context.Context, q *db.Queries, slot db.GetTournamentSlotRow) (desired []id.ID, have bool, err error) {
	if slot.Ruling != nil {
		var ruling []id.ID
		if err := json.Unmarshal(slot.Ruling, &ruling); err != nil {
			return nil, false, fmt.Errorf("parse ruling: %w", err)
		}
		if len(ruling) == int(slot.Advance) {
			return ruling, true, nil
		}
	}
	return s.standingsOutcome(ctx, q, slot)
}

// standingsOutcome is desiredOutcome's scores-only half: the strict
// top-advance cut of the cumulative standings — with the organizer's minimal
// score as an extra gate (ADR-30) — or nothing while the cut is not strictly
// separated. Used directly by the ruling-cancel path, whose outcome must
// ignore the ruling being canceled.
func (s *TournamentService) standingsOutcome(ctx context.Context, q *db.Queries, slot db.GetTournamentSlotRow) (desired []id.ID, have bool, err error) {
	results, err := q.ListSlotMatchResults(ctx, slot.ID)
	if err != nil {
		return nil, false, fmt.Errorf("list slot matches: %w", err)
	}
	matchResults, err := slotMatchResults(ctx, q, results)
	if err != nil {
		return nil, false, err
	}
	if len(matchResults) > 0 {
		sts := bracket.Standings(matchResults, int(slot.SeatCount))
		if bracket.StrictCut(sts, int(slot.Advance), bracket.MinScoreTenths(slot.MinScore)) {
			desired = make([]id.ID, 0, slot.Advance)
			for i := 0; i < int(slot.Advance); i++ {
				desired = append(desired, sts[i].PlayerID)
			}
			return desired, true, nil
		}
	}
	return nil, false, nil
}

// slotMatchResults assembles the slot's linked-match rows (event order:
// date, then match id) into bracket.MatchResults for the standings math,
// resolving each match's win reward from the effective-dated elo_settings
// (the seed row starts at -infinity, so every date resolves; one lookup per
// distinct match keeps the read path cheap).
func slotMatchResults(ctx context.Context, q *db.Queries, results []db.ListSlotMatchResultsRow) ([]bracket.MatchResult, error) {
	rewards := make(map[id.ID]float64, len(results))
	var matchResults []bracket.MatchResult
	lastID := id.ID("")
	for _, r := range results {
		if r.MatchID != lastID {
			w, ok := rewards[r.MatchID]
			if !ok {
				set, err := q.GetEloSettingsForDate(ctx, r.Date)
				if err != nil {
					return nil, fmt.Errorf("get elo settings for the date of match %s: %w", r.MatchID, err)
				}
				w = set.WinReward
				rewards[r.MatchID] = w
			}
			matchResults = append(matchResults, bracket.MatchResult{
				MatchID:   r.MatchID,
				Scores:    make(map[id.ID]float64, 4),
				WinReward: w,
			})
			lastID = r.MatchID
		}
		mr := &matchResults[len(matchResults)-1]
		mr.Scores[r.PlayerID] = r.Score
	}
	return matchResults, nil
}

// outcomeChanged reports whether the desired ordered advancement set differs
// from the stored one (order matters — it drives downstream source places).
func outcomeChanged(desired []id.ID, have bool, stored []db.TournamentSlotAdvance) bool {
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
// recorded advancements (or a ruling): links and advancements are deleted, every
// removal audited with the origin chain, and the invalidation recurses.
func (s *TournamentService) voidSlotIfDirty(ctx context.Context, q *db.Queries, actor id.ID, slot db.ListSlotsBySourceRow, originKind, originID string) error {
	hasMatches, err := q.SlotHasMatches(ctx, slot.ID)
	if err != nil {
		return fmt.Errorf("check slot matches: %w", err)
	}
	hasAdvances, err := q.SlotHasAdvances(ctx, slot.ID)
	if err != nil {
		return fmt.Errorf("check slot advances: %w", err)
	}
	if !hasMatches && !hasAdvances {
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
	if err := q.DeleteSlotAdvances(ctx, slot.ID); err != nil {
		return fmt.Errorf("delete slot advances: %w", err)
	}
	if err := q.SetSlotRuling(ctx, db.SetSlotRulingParams{ID: slot.ID, Ruling: nil}); err != nil {
		return fmt.Errorf("clear ruling: %w", err)
	}
	// The void wiped everything the slot had recorded, so a `completed`
	// status is stale too: the slot re-plays once its seats resolve (they
	// may have been cleared just above, or refilled from the new outcome).
	unresolved, err := q.CountUnresolvedSeats(ctx, slot.ID)
	if err != nil {
		return fmt.Errorf("count unresolved seats: %w", err)
	}
	status := TournamentSlotPlaying
	if unresolved > 0 {
		status = TournamentSlotWaiting
	}
	if err := q.SetSlotStatus(ctx, db.SetSlotStatusParams{ID: slot.ID, Status: status}); err != nil {
		return fmt.Errorf("set slot status: %w", err)
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
func (s *TournamentService) completeTournament(ctx context.Context, q *db.Queries, actor id.ID, slot db.GetTournamentSlotRow, winner id.ID) error {
	tid := slot.TournamentID
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
	// The completed tournament resolves its tournament-winner markets here —
	// after the enclosing match-write's settlement replay, so the replay
	// cannot unsettle them again.
	if s.Markets != nil {
		if err := s.Markets.SettleTournamentWinnerMarketsOnComplete(ctx, q, tid, winner, slot); err != nil {
			return fmt.Errorf("settle tournament winner markets: %w", err)
		}
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
// recompute, the strict top-advance set is re-evaluated, and a changed
// outcome cascades (audit origin: the triggering match edit). A score edit
// that would change the outcome while downstream rounds already recorded
// results (played matches or rulings) is refused with
// ErrTournamentScoreEditUnsafe — the whole match write rolls back; those
// rounds are unwound explicitly from the last one backwards (unlink their
// matches, cancel their rulings), the same step-by-step rule as the link
// and ruling guards. Date/calculator-only edits never change the derived
// outcome and always pass.
func (s *TournamentService) OnMatchChanged(ctx context.Context, q *db.Queries, matchID, actor id.ID) error {
	if err := s.enforceDeadlineTx(ctx, q); err != nil {
		return err
	}
	ref, err := s.SlotOfMatch(ctx, q, matchID)
	if err != nil || ref == nil {
		return err
	}
	// The guard runs before the recompute mutates anything: the new scores
	// are already written in this tx, so the prospective outcome is exactly
	// what the recompute would derive.
	slot, err := q.GetTournamentSlot(ctx, ref.SlotID)
	if err != nil {
		return fmt.Errorf("get slot: %w", err)
	}
	if changed, err := s.outcomeWouldChange(ctx, q, slot); err != nil {
		return err
	} else if changed {
		if recorded, err := s.downstreamRecorded(ctx, q, ref.SlotID); err != nil {
			return err
		} else if recorded {
			return ErrTournamentScoreEditUnsafe
		}
	}
	return s.recomputeSlot(ctx, q, actor, ref.SlotID, audit.LinkOriginMatchEdit, string(matchID))
}

// outcomeWouldChange reports whether the slot's currently derivable outcome
// differs from the stored advancements — the trigger of every cascade. The
// edit-path guard reads it before anything is rewritten; a no-op edit (the
// derived outcome stands, e.g. a date-only change) never trips it.
func (s *TournamentService) outcomeWouldChange(ctx context.Context, q *db.Queries, slot db.GetTournamentSlotRow) (bool, error) {
	if slot.Status == TournamentSlotWaiting {
		return false, nil
	}
	desired, have, err := s.desiredOutcome(ctx, q, slot)
	if err != nil {
		return false, err
	}
	stored, err := q.ListSlotAdvances(ctx, slot.ID)
	if err != nil {
		return false, fmt.Errorf("list advances: %w", err)
	}
	return outcomeChanged(desired, have, stored), nil
}

// SetMatchLinkState applies the edit form's desired tournament-link state
// (ADR-26): ensureUnlinked detaches a stored slot link; ensureLinked attaches
// the match to its unique fitting playing slot — the same equality rule as
// acceptance, but "fits nothing" is an error instead of a silent skip (a
// playing slot has no recorded advancements, so attaching can never invalidate
// played history). A desired state that already holds is a no-op with no
// audit rows. Detaching is refused while any downstream slot still holds
// linked matches or a recorded ruling — voiding played rounds stays the
// organizer's explicit, step-by-step tool. Runs inside the match-write tx;
// audit origin: match edit.
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
		if recorded, err := s.downstreamRecorded(ctx, q, ref.SlotID); err != nil {
			return err
		} else if recorded {
			return ErrTournamentLinkChangeUnsafe
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
		if err := q.AddTournamentArenaMatch(ctx, db.AddTournamentArenaMatchParams{TournamentID: c.TournamentID, MatchID: matchID}); err != nil {
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

// downstreamRecorded reports whether any slot reachable through the
// advancements holds linked matches or recorded advancements (a standing ruling
// decided it): a link-state change or ruling change here would void rounds
// that were actually played or explicitly ruled, which the edit form and the
// ruling tool must not do silently (ErrTournamentLinkChangeUnsafe /
// ErrTournamentRulingUnsafe). The organizer unwinds those rounds explicitly,
// from the last one backwards.
func (s *TournamentService) downstreamRecorded(ctx context.Context, q *db.Queries, slotID id.ID) (bool, error) {
	downstream, err := q.ListSlotsBySource(ctx, slotID)
	if err != nil {
		return false, fmt.Errorf("list downstream slots: %w", err)
	}
	for _, d := range downstream {
		hasMatches, err := q.SlotHasMatches(ctx, d.ID)
		if err != nil {
			return false, fmt.Errorf("check slot matches: %w", err)
		}
		if hasMatches {
			return true, nil
		}
		hasAdvances, err := q.SlotHasAdvances(ctx, d.ID)
		if err != nil {
			return false, fmt.Errorf("check slot advances: %w", err)
		}
		if hasAdvances {
			return true, nil
		}
		if recorded, err := s.downstreamRecorded(ctx, q, d.ID); err != nil {
			return false, err
		} else if recorded {
			return true, nil
		}
	}
	return false, nil
}

// ---------------------------------------------------------------------------
// Organizer tooling + grand-final deadline (ADR-26 §Organizer ruling /
// §Explicit corrections / §Organizer adjustments / §Grand-final deadline)
// ---------------------------------------------------------------------------

// SetRuling records the organizer's ordered advancement set for a slot
// (abandoned tables, no-shows, disputes). The ruling replaces the current
// outcome — standings-based or a prior ruling — and stays in force until the
