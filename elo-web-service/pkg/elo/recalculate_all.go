package elo

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// GlobalReplayReport is the outcome of reapplying the global arena's entire
// settlement history: how many user events were replayed and whose state moved.
type GlobalReplayReport struct {
	MatchesReplayed     int
	CorrectionsReplayed int
	ChangedPlayers      []PlayerStateChange
}

// RecalculateAllGlobalElo replays the global arena's full history (matches,
// corrections and market settlements) from the beginning of time inside one
// transaction — exactly the computation an edit+save of the chronologically
// first match triggers — and reports every player whose state changed.
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

	before, err := latestArenaStateByPlayer(ctx, q, GlobalArenaID)
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

	after, err := latestArenaStateByPlayer(ctx, q, GlobalArenaID)
	if err != nil {
		return GlobalReplayReport{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return GlobalReplayReport{}, fmt.Errorf("unable to commit tx: %w", err)
	}

	return GlobalReplayReport{
		MatchesReplayed:     int(matchesReplayed),
		CorrectionsReplayed: int(correctionsReplayed),
		ChangedPlayers:      diffArenaState(before, after),
	}, nil
}

// latestArenaStateByPlayer snapshots the current state of every player in the
// arena: their latest settlement row by (date, id) — the same ordering the
// "latest" rating queries use.
func latestArenaStateByPlayer(ctx context.Context, q *db.Queries, arenaID id.ID) ([]db.ListLatestArenaStatePerPlayerRow, error) {
	rows, err := q.ListLatestArenaStatePerPlayer(ctx, arenaID)
	if err != nil {
		return nil, fmt.Errorf("list latest arena state: %w", err)
	}
	return rows, nil
}
