package elo

import (
	"context"
	"fmt"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/audit"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// Camp arena links (ADR-27). A match belongs to a camp iff a camp_matches row
// links them; the links are written once on match creation and never altered
// afterwards — editing a match validates its date against the stored windows
// instead of rewriting them.

// resolveCampArenas validates the camp_arena_ids of a match creation: every id
// must reference an existing camp arena whose window contains the match date.
// Duplicates are collapsed preserving order.
func resolveCampArenas(ctx context.Context, q *db.Queries, ids []id.ID, date time.Time) ([]Arena, error) {
	out := make([]Arena, 0, len(ids))
	seen := make(map[id.ID]bool, len(ids))
	for _, aid := range ids {
		if seen[aid] {
			continue
		}
		seen[aid] = true
		row, err := q.GetArena(ctx, aid)
		if db.IsNoRows(err) {
			return nil, ErrCampArenaInvalid
		}
		if err != nil {
			return nil, fmt.Errorf("get camp arena %s: %w", aid, err)
		}
		arena, err := arenaFromGetArenaRow(row)
		if err != nil {
			return nil, err
		}
		if !arena.Camp || !campWindowContains(arena, date) {
			return nil, ErrCampArenaInvalid
		}
		out = append(out, arena)
	}
	return out, nil
}

// campArenasOfMatch returns the camp arenas currently linked to the match.
func campArenasOfMatch(ctx context.Context, q *db.Queries, matchID id.ID) ([]Arena, error) {
	rows, err := q.ListCampArenasByMatchIDs(ctx, []id.ID{matchID})
	if err != nil {
		return nil, fmt.Errorf("list match camps: %w", err)
	}
	out := make([]Arena, 0, len(rows))
	for _, r := range rows {
		row, err := q.GetArena(ctx, r.ArenaID)
		if err != nil {
			return nil, fmt.Errorf("get camp arena %s: %w", r.ArenaID, err)
		}
		arena, err := arenaFromGetArenaRow(row)
		if err != nil {
			return nil, err
		}
		out = append(out, arena)
	}
	return out, nil
}

// campWindowContains reports whether the camp window contains the date
// (inclusive bounds).
func campWindowContains(a Arena, date time.Time) bool {
	if a.StartsAt == nil || a.EndsAt == nil {
		return false
	}
	return !date.Before(*a.StartsAt) && !date.After(*a.EndsAt)
}

// applyCampLinkDiff attaches and detaches camp links to match the desired
// set (the edit-form desired set, ADR-27), writing a camp-link audit row per
// change. A no-op when the sets agree (an idempotent replay emits nothing).
// The caller stale-marks both the old and the new camps — the drain replays
// them from camp_matches, rewriting settlements and medal stats.
func applyCampLinkDiff(ctx context.Context, q *db.Queries, actor id.ID, matchID id.ID, current, desired []Arena) error {
	currentIDs := make(map[id.ID]bool, len(current))
	for _, c := range current {
		currentIDs[c.ID] = true
	}
	desiredIDs := make(map[id.ID]bool, len(desired))
	for _, c := range desired {
		desiredIDs[c.ID] = true
	}
	for _, c := range desired {
		if currentIDs[c.ID] {
			continue
		}
		if err := q.AddCampMatch(ctx, db.AddCampMatchParams{ArenaID: c.ID, MatchID: matchID}); err != nil {
			return fmt.Errorf("link match %s to camp %s: %w", matchID, c.ID, err)
		}
		if err := recordAuditEvent(ctx, q, actor, audit.EntityArena, audit.ActionCreated, c.ID,
			audit.KindCampLink, audit.NewCampLinkDetails(audit.CampLinkAttach, string(matchID))); err != nil {
			return err
		}
	}
	for _, c := range current {
		if desiredIDs[c.ID] {
			continue
		}
		if err := q.DeleteCampMatch(ctx, db.DeleteCampMatchParams{ArenaID: c.ID, MatchID: matchID}); err != nil {
			return fmt.Errorf("unlink match %s from camp %s: %w", matchID, c.ID, err)
		}
		if err := recordAuditEvent(ctx, q, actor, audit.EntityArena, audit.ActionDeleted, c.ID,
			audit.KindCampLink, audit.NewCampLinkDetails(audit.CampLinkDetach, string(matchID))); err != nil {
			return err
		}
	}
	return nil
}
