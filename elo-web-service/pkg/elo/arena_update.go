package elo

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

const (
	// arenaUpdateDebounce ages stale marks before the background worker acts,
	// so bursts of marks (an admin toggling game tags) coalesce into one
	// recalculation. The synchronous drain after match writes ignores it.
	arenaUpdateDebounce = 10 * time.Second
	// arenaUpdatePollInterval is how often the worker looks for due marks.
	arenaUpdatePollInterval = 5 * time.Second
)

// PlayerStateChange reports how one player's latest settlement row moved as
// the result of a full recalculation replay.
type PlayerStateChange struct {
	PlayerID     id.ID
	PlayerName   string
	EloBefore    float64
	EloAfter     float64
	RatingBefore float64
	RatingAfter  float64
	LeagueBefore *string
	LeagueAfter  *string
}

// updateArenaWithinTx recalculates one arena inside the caller's transaction:
// lock the arena row (concurrent marks queue behind it), delete its
// settlements from the pending replay date, replay the filtered matches in
// event order, recompute the precalculated stats, and clear the stale mark.
// The clear is conditional: if the arena was re-marked while the
// recalculation ran, the mark survives and the arena is recalculated again —
// cancellation by staleness (ADR-24).
func (s *ArenaService) updateArenaWithinTx(ctx context.Context, q *db.Queries, arena Arena) error {
	locked, err := q.GetArenaForUpdate(ctx, arena.ID)
	if err != nil {
		return fmt.Errorf("lock arena: %w", err)
	}
	lockedArena, err := arenaFromParts(locked.ID, locked.Name, locked.Settings, locked.SettingsSchemaVersion,
		locked.GameID, locked.TournamentID, locked.RecalcFrom, locked.StaleAt,
		locked.DateFrom, locked.DateTo, locked.FilterGameIds, locked.FilterTagIds, locked.FilterTournamentID)
	if err != nil {
		return err
	}
	if lockedArena.StaleAt == nil {
		return nil // someone else recalculated it while we waited for the lock
	}

	from := time.Time{}
	if lockedArena.RecalcFrom != nil {
		from = *lockedArena.RecalcFrom
	}
	if err := q.DeleteArenaSettlementsFromDate(ctx, db.DeleteArenaSettlementsFromDateParams{
		ArenaID: arena.ID,
		Date:    pgtype.Timestamptz{Time: from, Valid: true},
	}); err != nil {
		return fmt.Errorf("delete settlements from %v: %w", from, err)
	}

	matches, err := q.ListMatchesForArenaReplay(ctx, db.ListMatchesForArenaReplayParams{
		ID:   arena.ID,
		Date: pgtype.Timestamptz{Time: from, Valid: true},
	})
	if err != nil {
		return fmt.Errorf("list matches from %v: %w", from, err)
	}

	for _, match := range matches {
		scores, err := q.GetMatchScoresForMatch(ctx, match.ID)
		if err != nil {
			return fmt.Errorf("get scores for match %s: %w", match.ID, err)
		}
		playerScores := make(map[id.ID]float64, len(scores))
		for _, ms := range scores {
			playerScores[ms.PlayerID] = ms.Score
		}

		prev, err := lockAndGetPrevArenaState(ctx, q, lockedArena, match, playerScores)
		if err != nil {
			return fmt.Errorf("prev state for match %s: %w", match.ID, err)
		}
		if err := storeArenaMatchSettlements(ctx, q, lockedArena, match, playerScores, prev); err != nil {
			return fmt.Errorf("settle match %s: %w", match.ID, err)
		}
	}

	// Stats are aggregates over the whole arena match set: always recompute.
	if err := q.DeleteArenaStats(ctx, arena.ID); err != nil {
		return fmt.Errorf("delete stats: %w", err)
	}
	if err := q.InsertArenaStats(ctx, arena.ID); err != nil {
		return fmt.Errorf("insert stats: %w", err)
	}

	return q.ClearArenaStale(ctx, db.ClearArenaStaleParams{
		ID:      arena.ID,
		StaleAt: pgtype.Timestamptz{Time: *lockedArena.StaleAt, Valid: true},
	})
}

// diffArenaState compares two latest-state snapshots with exact equality: a
// stable replay must reproduce every stored value bit-for-bit.
func diffArenaState(before, after []db.ListLatestArenaStatePerPlayerRow) []PlayerStateChange {
	type snapshot map[id.ID]db.ListLatestArenaStatePerPlayerRow
	beforeMap := make(snapshot, len(before))
	for _, r := range before {
		beforeMap[r.PlayerID] = r
	}
	afterMap := make(snapshot, len(after))
	for _, r := range after {
		afterMap[r.PlayerID] = r
	}

	changed := make([]PlayerStateChange, 0)
	for pid, prev := range beforeMap {
		next, ok := afterMap[pid]
		if ok &&
			prev.EloAfter == next.EloAfter &&
			prev.RatingAfter == next.RatingAfter &&
			prev.League == next.League {
			continue
		}
		change := PlayerStateChange{
			PlayerID:     pid,
			PlayerName:   prev.PlayerName,
			EloBefore:    prev.EloAfter,
			RatingBefore: prev.RatingAfter,
			LeagueBefore: textPtr(prev.League),
		}
		if ok {
			change.PlayerName = next.PlayerName
			change.EloAfter = next.EloAfter
			change.RatingAfter = next.RatingAfter
			change.LeagueAfter = textPtr(next.League)
		}
		changed = append(changed, change)
	}
	sort.Slice(changed, func(i, j int) bool {
		if changed[i].PlayerName != changed[j].PlayerName {
			return changed[i].PlayerName < changed[j].PlayerName
		}
		return changed[i].PlayerID.String() < changed[j].PlayerID.String()
	})
	return changed
}
