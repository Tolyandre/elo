-- Arena match link queries (ADR-27, ADR-28 amendment): one arena_matches
-- table serves both link-only arena flavors — camp arenas (organizer-managed
-- checkboxes) and tournament arenas (written by the bracket slot mechanics).
-- Camp membership is written when a match is created with camp_arena_ids and
-- never altered afterwards except by the edit-form desired-set diff; the
-- tournament flavor attaches at slot-link time and detaches/voids with it.

-- name: AddArenaMatch :exec
INSERT INTO arena_matches (arena_id, match_id)
VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: DeleteArenaMatch :exec
-- Detach a match from a camp arena (the edit-form desired-set diff, ADR-27):
-- the camp is stale-marked by the caller and the replay rewrites its
-- settlements and medal stats.
DELETE FROM arena_matches
WHERE arena_id = $1 AND match_id = $2;

-- name: AddTournamentArenaMatch :exec
-- The tournament-membership row: the tournament's auto-created arena is
-- resolved in-SQL (every running tournament has one; acceptance and attach
-- only write membership for running tournaments).
INSERT INTO arena_matches (arena_id, match_id)
SELECT a.id, sqlc.arg('match_id')::uuid
FROM arenas a
WHERE a.tournament_id = sqlc.arg('tournament_id')::uuid
ON CONFLICT DO NOTHING;

-- name: DeleteTournamentArenaMatch :exec
-- The match left its slot (detach or void, ADR-26): it leaves the tournament
-- arena too.
DELETE FROM arena_matches am
USING arenas a
WHERE a.id = am.arena_id
  AND a.tournament_id = sqlc.arg('tournament_id')::uuid
  AND am.match_id = sqlc.arg('match_id')::uuid;

-- name: ListCampArenasByMatchIDs :many
-- The camps of a set of matches — the [{id, name}] payload of the match
-- response (the old match.tournaments shape).
SELECT
    am.match_id,
    a.id   AS arena_id,
    a.name AS arena_name
FROM arena_matches am
JOIN arenas a ON a.id = am.arena_id AND a.camp
WHERE am.match_id = ANY(sqlc.arg('match_ids')::uuid[])
ORDER BY a.name;

-- name: GetCampMatchDateRange :one
-- HAVING guards the aggregate: with no linked matches it returns zero rows
-- (ErrNoRows) instead of a (NULL, NULL) row that can't scan into the
-- non-nullable time.Time. The camp date-narrowing guard reads this.
SELECT
    MIN(m.date)::timestamptz AS min_date,
    MAX(m.date)::timestamptz AS max_date
FROM arena_matches am
JOIN matches m ON m.id = am.match_id
WHERE am.arena_id = $1
HAVING COUNT(*) > 0;
