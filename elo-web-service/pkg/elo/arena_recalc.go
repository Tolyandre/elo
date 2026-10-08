package elo

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// Marks and drains
// ---------------------------------------------------------------------------

// MarkAndDrainAfterMatchWrite refreshes the arena whose settlements the match
// write just maintained transactionally (the sweep anchor, or — since ADR-36
// phase 7 — nothing, when the creating tenant's main arena is a replay
// arena), marks the affected other arenas for an incremental recalculation
// from fromDate, and recalculates them synchronously in the caller's
// transaction (ADR-24: match writes update all arenas). settledArena zero
// means nothing was settled transactionally: every affected arena replays.
func (s *ArenaService) MarkAndDrainAfterMatchWrite(ctx context.Context, q *db.Queries, affected []id.ID, fromDate time.Time, settledArena id.ID) error {
	// The stats are aggregates over the arena's match set; the arena's match
	// set just changed even though its settlements were replayed elsewhere, so
	// recompute them here.
	if !settledArena.IsZero() {
		if err := q.DeleteArenaStats(ctx, settledArena); err != nil {
			return fmt.Errorf("delete settled arena stats: %w", err)
		}
		if err := q.InsertArenaStats(ctx, settledArena); err != nil {
			return fmt.Errorf("insert settled arena stats: %w", err)
		}
	}

	ids := make([]id.ID, 0, len(affected))
	for _, aid := range affected {
		if aid != settledArena {
			ids = append(ids, aid)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	if err := q.MarkArenasStaleFromDate(ctx, db.MarkArenasStaleFromDateParams{
		FromDate: fromDate,
		ArenaIds: ids,
	}); err != nil {
		return fmt.Errorf("mark arenas stale: %w", err)
	}
	return s.drainDueArenas(ctx, q, time.Now())
}

// MarkTagFilteredArenasStale marks every arena with a tag condition for a full
// recalculation — the conservative response to any game's tag set changing.
func (s *ArenaService) MarkTagFilteredArenasStale(ctx context.Context, q *db.Queries) error {
	ids, err := q.ListTagFilteredArenaIds(ctx)
	if err != nil {
		return fmt.Errorf("list tag-filtered arenas: %w", err)
	}
	if len(ids) == 0 {
		return nil
	}
	return q.MarkArenasStaleFull(ctx, ids)
}

// MarkAllStaleFull marks every arena for a full recalculation.
func (s *ArenaService) MarkAllStaleFull(ctx context.Context, q *db.Queries) error {
	arenas, err := s.ListArenas(ctx)
	if err != nil {
		return err
	}
	ids := make([]id.ID, 0, len(arenas))
	for _, a := range arenas {
		ids = append(ids, a.ID)
	}
	if len(ids) == 0 {
		return nil
	}
	return q.MarkArenasStaleFull(ctx, ids)
}

// drainDueArenas recalculates every arena whose stale mark is due (mark older
// than the debounce, or drained synchronously by a match write). Runs in the
// caller's transaction. A plain arena replays its match rows only — the
// settlement path just handled the markets inline. The sweep-anchor arena
// (the converted global arena, ADR-36 phase 7) joins the drain only with an
// incremental mark — that is how a match created under another tenant reaches
// it (nothing settled it transactionally); a FULL mark on it is left to the
// worker/boot, whose drain re-settles it sweep-only. A queued FULL mark on
// another main arena (a settings or composition change, ADR-36 phase 6)
// drains with the market re-chaining sweep — replaying it without the sweep
// would clear the mark and leave its market settlements on the old chains.
func (s *ArenaService) drainDueArenas(ctx context.Context, q *db.Queries, now time.Time) error {
	rows, err := q.ListStaleArenas(ctx, now)
	if err != nil {
		return fmt.Errorf("list stale arenas: %w", err)
	}
	for _, r := range rows {
		if r.ID == BlueMenArenaID && !r.RecalcFrom.Valid {
			continue // full marks drain sweep-only via the worker/boot path
		}
		arena, err := arenaFromStaleRow(r)
		if err != nil {
			return err
		}
		if arena.TenantID != nil && !r.RecalcFrom.Valid {
			err = s.drainArenaWithinTx(ctx, q, arena)
		} else {
			err = s.updateArenaWithinTx(ctx, q, arena)
		}
		if err != nil {
			return fmt.Errorf("update arena %s: %w", r.ID, err)
		}
	}
	return nil
}

// drainArenaWithinTx recalculates one stale arena inside the caller's
// transaction (the background worker's and boot's drain). A plain arena
// replays its match rows. A tenant main arena (ADR-36) re-chains the market
// ledger afterwards — the epoch sweep — because a replay deletes match
// settlement rows only, and the arena's market rows were computed against the
// old chains. «Синие люди»'s arena skips the separate replay: the sweep
// re-settles its match settlements (per the tenant gate) alongside every
// market. The stale mark clears only after the whole recalculation succeeded,
// so a failure leaves the arena queued for the next tick.
func (s *ArenaService) drainArenaWithinTx(ctx context.Context, q *db.Queries, arena Arena) error {
	if arena.TenantID == nil {
		return s.updateArenaWithinTx(ctx, q, arena)
	}
	var mark *time.Time
	if arena.ID == BlueMenArenaID {
		m, err := s.lockedStaleMark(ctx, q, arena.ID)
		if err != nil || m == nil {
			return err // nil mark: someone else drained it while we waited for the lock
		}
		mark = m
	} else {
		m, err := s.replayArenaMatchesWithinTx(ctx, q, arena.ID)
		if err != nil || m == nil {
			return err
		}
		mark = m
	}
	if s.Sweep == nil {
		return fmt.Errorf("settlement sweep handle is not wired")
	}
	if err := s.Sweep.RecalculateSettlementsWithinTx(ctx, q, time.Time{}); err != nil {
		return fmt.Errorf("settlement sweep: %w", err)
	}
	return q.ClearArenaStale(ctx, db.ClearArenaStaleParams{
		ID:      arena.ID,
		StaleAt: pgtype.Timestamptz{Time: *mark, Valid: true},
	})
}

// RecalculateAllArenas replays every arena from scratch and reports each
// arena's before/after player-state diff across the whole recalculation:
// match settlements per arena (one transaction per arena), then one epoch
// sweep re-settling the market ledger. A stable recalculation reports no
// changed players.
func (s *ArenaService) RecalculateAllArenas(ctx context.Context) ([]ArenaUpdateReport, error) {
	arenas, err := s.ListArenas(ctx)
	if err != nil {
		return nil, err
	}
	before := make(map[id.ID][]db.ListLatestArenaStatePerPlayerRow, len(arenas))
	for _, a := range arenas {
		rows, err := s.Queries.ListLatestArenaStatePerPlayer(ctx, a.ID)
		if err != nil {
			return nil, fmt.Errorf("snapshot arena %s: %w", a.ID, err)
		}
		before[a.ID] = rows
	}

	for _, a := range arenas {
		err := runInTx(ctx, s.Pool, func(q *db.Queries) error {
			if err := q.MarkArenasStaleFull(ctx, []id.ID{a.ID}); err != nil {
				return fmt.Errorf("mark stale: %w", err)
			}
			_, err := s.replayArenaMatchesWithinTx(ctx, q, a.ID)
			return err
		})
		if err != nil {
			return nil, fmt.Errorf("recalculate arena %s: %w", a.ID, err)
		}
	}

	if s.Sweep != nil {
		err := runInTx(ctx, s.Pool, func(q *db.Queries) error {
			return s.Sweep.RecalculateSettlementsWithinTx(ctx, q, time.Time{})
		})
		if err != nil {
			return nil, err
		}
	}

	reports := make([]ArenaUpdateReport, 0, len(arenas))
	for _, a := range arenas {
		after, err := s.Queries.ListLatestArenaStatePerPlayer(ctx, a.ID)
		if err != nil {
			return nil, fmt.Errorf("snapshot arena %s: %w", a.ID, err)
		}
		reports = append(reports, ArenaUpdateReport{
			ArenaID:         a.ID,
			ArenaName:       a.Name,
			MatchesReplayed: a.MatchesCount,
			ChangedPlayers:  diffArenaState(before[a.ID], after),
		})
	}
	return reports, nil
}

// ScheduleNextUpdate is the background worker loop: every poll interval it
// recalculates arenas whose stale mark has aged past the debounce window, so
// bursts of marks (admin toggling game tags, tenant settings changes)
// coalesce into one recalculation.
func (s *ArenaService) ScheduleNextUpdate(ctx context.Context) {
	poll := time.NewTicker(arenaUpdatePollInterval)
	defer poll.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-poll.C:
			due := time.Now().Add(-arenaUpdateDebounce)
			changed, err := s.updateDueArenasOwnTxs(ctx, due)
			if err != nil {
				log.Printf("arena update: %v", err)
				continue
			}
			if changed && s.Hub != nil {
				s.Hub.PublishSignal(TopicData, "matches-changed")
				s.Hub.PublishSignal(TopicData, "players-changed")
				s.Hub.PublishSignal(TopicData, "arenas-changed")
			}
		}
	}
}

// ReplayStaleArenas drains every stale arena at boot, before the API starts
// serving — no debounce. Migrations mark arenas stale (the phase-5 retirement
// marked «Синие люди»'s), fresh arenas start stale, and waiting out the
// worker's debounce for each would leave empty standings visible.
func (s *ArenaService) ReplayStaleArenas(ctx context.Context) error {
	_, err := s.updateDueArenasOwnTxs(ctx, time.Now())
	return err
}

// updateDueArenasOwnTxs recalculates due stale arenas, each in its own
// transaction, so one failing arena does not block the others. Reports whether
// anything changed.
func (s *ArenaService) updateDueArenasOwnTxs(ctx context.Context, due time.Time) (bool, error) {
	rows, err := s.Queries.ListStaleArenas(ctx, due)
	if err != nil {
		return false, fmt.Errorf("list stale arenas: %w", err)
	}
	changed := false
	for _, r := range rows {
		arena, err := arenaFromStaleRow(r)
		if err != nil {
			return changed, err
		}
		err = runInTx(ctx, s.Pool, func(q *db.Queries) error {
			return s.drainArenaWithinTx(ctx, q, arena)
		})
		if err != nil {
			return changed, fmt.Errorf("update arena %s: %w", r.ID, err)
		}
		changed = true
		log.Printf("arena update: recalculated %q (%s)", arena.Name, arena.ID)
	}
	return changed, nil
}
