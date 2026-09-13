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

// PlayerGlobalStateChange reports how one player's global arena state
// (latest settlement row) moved as the result of a full recalculation replay.
type PlayerGlobalStateChange struct {
	PlayerID     id.ID
	PlayerName   string
	EloBefore    float64
	EloAfter     float64
	RatingBefore float64
	RatingAfter  float64
	LeagueBefore string
	LeagueAfter  string
}

// GlobalReplayReport is the outcome of reapplying the entire settlement
// history: how many user events were replayed and whose state moved.
type GlobalReplayReport struct {
	MatchesReplayed     int
	CorrectionsReplayed int
	ChangedPlayers      []PlayerGlobalStateChange
}

// RecalculateAllGlobalElo replays the full history (matches, corrections and
// market settlements) from the beginning of time inside one transaction —
// exactly the computation an edit+save of the chronologically first match
// triggers — and reports every player whose global arena state changed.
//
// Reapplying unchanged history must be a no-op: a non-empty ChangedPlayers
// means recalculation is not stable (order- or state-dependent settlement).
func (s *MatchService) RecalculateAllGlobalElo(ctx context.Context) (GlobalReplayReport, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return GlobalReplayReport{}, fmt.Errorf("unable to begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := s.Queries.WithTx(tx)

	fromStart := pgtype.Timestamptz{Time: time.Time{}, Valid: true}

	before, err := latestGlobalStateByPlayer(ctx, q)
	if err != nil {
		return GlobalReplayReport{}, err
	}

	matchesReplayed, err := q.CountMatchesFromDate(ctx, fromStart)
	if err != nil {
		return GlobalReplayReport{}, fmt.Errorf("count matches: %w", err)
	}
	correctionsReplayed, err := q.CountCorrectionsFromDate(ctx, fromStart)
	if err != nil {
		return GlobalReplayReport{}, fmt.Errorf("count corrections: %w", err)
	}

	if err := s.recalculateEloFromDate(ctx, q, time.Time{}); err != nil {
		return GlobalReplayReport{}, err
	}

	after, err := latestGlobalStateByPlayer(ctx, q)
	if err != nil {
		return GlobalReplayReport{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return GlobalReplayReport{}, fmt.Errorf("unable to commit tx: %w", err)
	}

	return GlobalReplayReport{
		MatchesReplayed:     int(matchesReplayed),
		CorrectionsReplayed: int(correctionsReplayed),
		ChangedPlayers:      diffGlobalState(before, after),
	}, nil
}

// latestGlobalStateByPlayer snapshots the current global arena state of every
// player: their latest settlement row by (date, id) — the same ordering the
// "latest" rating queries use.
func latestGlobalStateByPlayer(ctx context.Context, q *db.Queries) (map[id.ID]db.ListLatestGlobalStatePerPlayerRow, error) {
	rows, err := q.ListLatestGlobalStatePerPlayer(ctx)
	if err != nil {
		return nil, fmt.Errorf("list latest global state: %w", err)
	}
	byPlayer := make(map[id.ID]db.ListLatestGlobalStatePerPlayerRow, len(rows))
	for _, r := range rows {
		byPlayer[r.PlayerID] = r
	}
	return byPlayer, nil
}

// diffGlobalState compares the two snapshots with exact equality: a stable
// replay must reproduce every stored value bit-for-bit, not approximately.
func diffGlobalState(before, after map[id.ID]db.ListLatestGlobalStatePerPlayerRow) []PlayerGlobalStateChange {
	changed := make([]PlayerGlobalStateChange, 0)
	for pid, prev := range before {
		next, ok := after[pid]
		if ok &&
			prev.EloAfter == next.EloAfter &&
			prev.RatingAfter == next.RatingAfter &&
			prev.League == next.League {
			continue
		}
		change := PlayerGlobalStateChange{
			PlayerID:     pid,
			PlayerName:   prev.PlayerName,
			EloBefore:    prev.EloAfter,
			RatingBefore: prev.RatingAfter,
			LeagueBefore: prev.League,
		}
		if ok {
			change.PlayerName = next.PlayerName
			change.EloAfter = next.EloAfter
			change.RatingAfter = next.RatingAfter
			change.LeagueAfter = next.League
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
