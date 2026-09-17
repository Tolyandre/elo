-- Camp arena link queries (ADR-27). Camp membership is the explicit
-- camp_matches link, written when a match is created with camp_arena_ids and
-- never altered afterwards (editing a match cannot change its camps).

-- name: AddCampMatch :exec
INSERT INTO camp_matches (arena_id, match_id)
VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: DeleteCampMatch :exec
-- Detach a match from a camp arena (the edit-form desired-set diff, ADR-27):
-- the camp is stale-marked by the caller and the replay rewrites its
-- settlements and medal stats.
DELETE FROM camp_matches
WHERE arena_id = $1 AND match_id = $2;

-- name: ListCampArenasByMatchIDs :many
-- The camps of a set of matches — the [{id, name}] payload of the match
-- response (the old match.tournaments shape).
SELECT
    cm.match_id,
    a.id   AS arena_id,
    a.name AS arena_name
FROM camp_matches cm
JOIN arenas a ON a.id = cm.arena_id
WHERE cm.match_id = ANY(sqlc.arg('match_ids')::uuid[])
ORDER BY a.name;

-- name: GetCampMatchDateRange :one
-- HAVING guards the aggregate: with no linked matches it returns zero rows
-- (ErrNoRows) instead of a (NULL, NULL) row that can't scan into the
-- non-nullable time.Time. The camp date-narrowing guard reads this.
SELECT
    MIN(m.date)::timestamptz AS min_date,
    MAX(m.date)::timestamptz AS max_date
FROM camp_matches cm
JOIN matches m ON m.id = cm.match_id
WHERE cm.arena_id = $1
HAVING COUNT(*) > 0;
