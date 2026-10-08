package elo

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/audit"
	"github.com/tolyandre/elo-web-service/pkg/bracket"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// organizer cancels it (an empty player list) or a cascade voids it; the
// standings never silently override an explicit decision. Any change that
// would rewrite an outcome feeding played or ruled downstream rounds is
// refused (ErrTournamentRulingUnsafe): voiding played history stays the
// organizer's explicit, step-by-step tool — unwind the later rounds first.
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

		cancel := len(playerIDs) == 0
		if !cancel {
			if len(playerIDs) != int(slot.Advance) {
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
		} else if slot.Ruling == nil {
			return nil // no ruling in force — a cancel is a no-op, nothing audited
		}

		// The guard (ADR-26, parity with the link guards): a changed outcome
		// cascades into the downstream rounds — refuse while any of them
		// already recorded something (played matches or a ruling).
		stored, err := q.ListSlotAdvances(ctx, slotID)
		if err != nil {
			return fmt.Errorf("list advances: %w", err)
		}
		desired, have := playerIDs, true
		if cancel {
			if desired, have, err = s.standingsOutcome(ctx, q, slot); err != nil {
				return err
			}
		}
		if outcomeChanged(desired, have, stored) {
			recorded, err := s.downstreamRecorded(ctx, q, slotID)
			if err != nil {
				return err
			}
			if recorded {
				return ErrTournamentRulingUnsafe
			}
		}

		// Audit the decision (before = the prior recorded outcome, if any).
		before := make([]string, 0, len(stored))
		byPlace := make(map[int32]id.ID, len(stored))
		for _, p := range stored {
			byPlace[p.Place] = p.PlayerID
		}
		for i := 0; i < len(stored); i++ {
			before = append(before, string(byPlace[int32(i+1)]))
		}
		op, after := audit.RulingSet, idStrings(playerIDs)
		if cancel {
			op, after = audit.RulingRevert, nil
		} else if len(stored) > 0 {
			op = audit.RulingReplace
		}
		if err := recordAuditEvent(ctx, q, actorUserID, audit.EntityTournament, audit.ActionUpdated, tid,
			audit.KindSlotRuling, audit.NewSlotRulingDetails(op, string(slotID), before, after)); err != nil {
			return err
		}

		var rulingRaw []byte // nil clears the stored ruling
		if !cancel {
			if rulingRaw, err = json.Marshal(playerIDs); err != nil {
				return fmt.Errorf("marshal ruling: %w", err)
			}
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
		if err := q.AddTournamentArenaMatch(ctx, db.AddTournamentArenaMatchParams{TournamentID: tid, MatchID: matchID}); err != nil {
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
// re-evaluates the slot and refreshes the arena synchronously. Guarded like
// the edit-form unlink: while any downstream slot holds linked matches or a
// recorded ruling the detach is refused (ErrTournamentLinkChangeUnsafe) —
// voiding played history stays the organizer's explicit, step-by-step tool
// (detach from the last round backwards).
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
		if recorded, err := s.downstreamRecorded(ctx, q, slotID); err != nil {
			return err
		} else if recorded {
			return ErrTournamentLinkChangeUnsafe
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

// AdjustSlot applies an organizer adjustment to a slot — the game
// reassignment and/or the minimal advance score (ADR-30) — only while no
// match is linked. A nil argument leaves the current value in place. The
// recompute after the write is a no-op in practice (with zero linked matches
// only a ruling can decide an outcome, and rulings survive adjustments); it
// keeps every organizer mutation re-deriving the bracket in one place.
func (s *TournamentService) AdjustSlot(ctx context.Context, tid, slotID, actorUserID id.ID, gameID *id.ID, minScore *float64) error {
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
		if minScore != nil && (*minScore < 0 || *minScore > 10) {
			return ErrTournamentSlotMinScoreInvalid
		}
		var ms pgtype.Float8
		if minScore != nil {
			ms = pgtype.Float8{Float64: *minScore, Valid: true}
		}
		// Coop-only games never produce rating matches (ADR-33) — no slot can
		// be reassigned to one.
		if gameID != nil {
			if err := RejectCoopGames(ctx, q, []id.ID{*gameID}); err != nil {
				return err
			}
		}
		if err := q.SetSlotAdjustment(ctx, db.SetSlotAdjustmentParams{SlotID: slotID, GameID: gameID, MinScore: ms}); err != nil {
			return fmt.Errorf("adjust slot: %w", err)
		}
		if err := s.recomputeSlot(ctx, q, actorUserID, slotID, audit.LinkOriginOrganizer, ""); err != nil {
			return err
		}
		if gameID != nil {
			if err := recordAuditEvent(ctx, q, actorUserID, audit.EntityTournament, audit.ActionUpdated, tid,
				audit.KindSlotAdjust, audit.NewSlotGameAdjust(string(slotID), string(*gameID))); err != nil {
				return err
			}
		}
		if minScore != nil {
			if err := recordAuditEvent(ctx, q, actorUserID, audit.EntityTournament, audit.ActionUpdated, tid,
				audit.KindSlotAdjust, audit.NewSlotMinScoreAdjust(string(slotID), *minScore)); err != nil {
				return err
			}
		}
		return nil
	})
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
		// A deadline-cancelled tournament refunds its tournament-winner
		// markets, same as an organizer cancel.
		if s.Markets != nil {
			if err := s.Markets.CancelTournamentWinnerMarkets(ctx, q, t.ID); err != nil {
				return fmt.Errorf("cancel tournament winner markets: %w", err)
			}
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
		if err := q.DeleteTournamentArenaMatch(ctx, db.DeleteTournamentArenaMatchParams{TournamentID: tid, MatchID: mid}); err != nil {
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
	// Nothing was settled transactionally here (a membership refresh, not a
	// match write): the whole affected list replays.
	return s.Arenas.MarkAndDrainAfterMatchWrite(ctx, q, []id.ID{arena.ID}, time.Now(), "")
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
// the source's full placing. Places 1..advance come from the recorded
// outcome; places beyond it (the drops the losers bracket and merges seat)
// come from the derived standings' total order — standings are never stored,
// so the refill re-derives them from the linked matches' scores.
func (s *TournamentService) refillSeatCaches(ctx context.Context, q *db.Queries, source db.GetTournamentSlotRow, advanced []id.ID) error {
	// The placing: the advanced prefix is fixed (a ruling may order it
	// against the points); the rest follows the standings order
	// (deterministic even on dropped-player ties).
	placing := append([]id.ID(nil), advanced...)
	placed := make(map[id.ID]bool, len(placing))
	for _, p := range placing {
		placed[p] = true
	}
	results, err := q.ListSlotMatchResults(ctx, source.ID)
	if err != nil {
		return fmt.Errorf("list slot matches: %w", err)
	}
	if len(results) > 0 {
		matchResults, err := slotMatchResults(ctx, q, results)
		if err != nil {
			return err
		}
		if len(matchResults) > 0 && source.SeatCount >= 2 {
			sts := bracket.Standings(matchResults, int(source.SeatCount))
			for _, st := range sts {
				if len(placing) >= int(source.SeatCount) {
					break
				}
				if !placed[st.PlayerID] {
					placing = append(placing, st.PlayerID)
					placed[st.PlayerID] = true
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
