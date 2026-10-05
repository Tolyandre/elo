package elo

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// Marks and drains
// ---------------------------------------------------------------------------

// MarkAndDrainAfterMatchWrite refreshes the global arena's precalculated
// stats (its settlements are already maintained transactionally by the match
// settlement path), marks the affected other arenas for an incremental
// recalculation from fromDate, and recalculates them synchronously in the
// caller's transaction (ADR-24: match writes update all arenas).
func (s *ArenaService) MarkAndDrainAfterMatchWrite(ctx context.Context, q *db.Queries, affected []id.ID, fromDate time.Time) error {
	// The stats are aggregates over the arena's match set; the global arena's
	// match set just changed even though its settlements were replayed
	// elsewhere, so recompute them here.
	if err := q.DeleteArenaStats(ctx, GlobalArenaID); err != nil {
		return fmt.Errorf("delete global arena stats: %w", err)
	}
	if err := q.InsertArenaStats(ctx, GlobalArenaID); err != nil {
		return fmt.Errorf("insert global arena stats: %w", err)
	}

	ids := make([]id.ID, 0, len(affected))
	for _, aid := range affected {
		if aid != GlobalArenaID {
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

// MarkAllStaleFull marks every non-global arena for a full recalculation.
func (s *ArenaService) MarkAllStaleFull(ctx context.Context, q *db.Queries) error {
	arenas, err := s.ListArenas(ctx)
	if err != nil {
		return err
	}
	ids := make([]id.ID, 0, len(arenas))
	for _, a := range arenas {
		if a.ID != GlobalArenaID {
			ids = append(ids, a.ID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	return q.MarkArenasStaleFull(ctx, ids)
}

// drainDueArenas recalculates every arena whose stale mark is due (mark older
// than the debounce, or drained synchronously by a match write). Runs in the
// caller's transaction.
func (s *ArenaService) drainDueArenas(ctx context.Context, q *db.Queries, now time.Time) error {
	rows, err := q.ListStaleArenas(ctx, now)
	if err != nil {
		return fmt.Errorf("list stale arenas: %w", err)
	}
	for _, r := range rows {
		if r.ID == GlobalArenaID {
			continue // maintained transactionally by the settlement path
		}
		arena, err := arenaFromStaleRow(r)
		if err != nil {
			return err
		}
		if err := s.updateArenaWithinTx(ctx, q, arena); err != nil {
			return fmt.Errorf("update arena %s: %w", r.ID, err)
		}
	}
	return nil
}

// RecalculateArenas recalculates every non-global arena from scratch and
// reports the changed players per arena. One transaction per arena.
func (s *ArenaService) RecalculateArenas(ctx context.Context) ([]ArenaUpdateReport, error) {
	arenas, err := s.ListArenas(ctx)
	if err != nil {
		return nil, err
	}
	reports := make([]ArenaUpdateReport, 0, len(arenas))
	for _, a := range arenas {
		if a.ID == GlobalArenaID {
			continue
		}
		report, err := s.recalculateArena(ctx, a)
		if err != nil {
			return nil, fmt.Errorf("recalculate arena %s: %w", a.ID, err)
		}
		reports = append(reports, report)
	}
	return reports, nil
}

// recalculateArena runs one full arena recalculation with a before/after
// player-state diff, in a single transaction.
func (s *ArenaService) recalculateArena(ctx context.Context, a ArenaWithCount) (ArenaUpdateReport, error) {
	report := ArenaUpdateReport{ArenaID: a.ID, ArenaName: a.Name, MatchesReplayed: a.MatchesCount}

	return runInTxResult(ctx, s.Pool, func(q *db.Queries) (ArenaUpdateReport, error) {
		before, err := q.ListLatestArenaStatePerPlayer(ctx, a.ID)
		if err != nil {
			return report, fmt.Errorf("snapshot before: %w", err)
		}

		if err := q.MarkArenasStaleFull(ctx, []id.ID{a.ID}); err != nil {
			return report, fmt.Errorf("mark stale: %w", err)
		}
		locked, err := s.GetArena(ctx, a.ID)
		if err != nil {
			return report, err
		}
		if err := s.updateArenaWithinTx(ctx, q, locked); err != nil {
			return report, err
		}

		after, err := q.ListLatestArenaStatePerPlayer(ctx, a.ID)
		if err != nil {
			return report, fmt.Errorf("snapshot after: %w", err)
		}
		report.ChangedPlayers = diffArenaState(before, after)
		return report, nil
	})
}

// ScheduleNextUpdate is the background worker loop: every poll interval it
// recalculates arenas whose stale mark has aged past the debounce window, so
// bursts of marks (admin toggling game tags) coalesce into one recalculation.
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
			}
		}
	}
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
		if r.ID == GlobalArenaID {
			continue
		}
		arena, err := arenaFromStaleRow(r)
		if err != nil {
			return changed, err
		}
		err = runInTx(ctx, s.Pool, func(q *db.Queries) error {
			return s.updateArenaWithinTx(ctx, q, arena)
		})
		if err != nil {
			return changed, fmt.Errorf("update arena %s: %w", r.ID, err)
		}
		changed = true
		log.Printf("arena update: recalculated %q (%s)", arena.Name, arena.ID)
	}
	return changed, nil
}
