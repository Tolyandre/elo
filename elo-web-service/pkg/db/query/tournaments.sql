-- name: ListTournaments :many
SELECT
    t.id AS tournament_id,
    t.name AS tournament_name,
    t.start_date,
    t.end_date,
    tpm.player_id AS player_id
FROM tournaments t
LEFT JOIN tournament_player_membership tpm ON tpm.tournament_id = t.id
ORDER BY t.start_date DESC, t.id DESC;

-- name: GetTournament :many
SELECT
    t.id AS tournament_id,
    t.name AS tournament_name,
    t.start_date,
    t.end_date,
    tpm.player_id AS player_id
FROM tournaments t
LEFT JOIN tournament_player_membership tpm ON tpm.tournament_id = t.id
WHERE t.id = $1;

-- name: CreateTournament :one
INSERT INTO tournaments (name, start_date, end_date)
VALUES ($1, $2, $3)
RETURNING id, name, start_date, end_date;

-- name: UpdateTournament :one
UPDATE tournaments
SET name = $2, start_date = $3, end_date = $4
WHERE id = $1
RETURNING id, name, start_date, end_date;

-- name: DeleteTournament :one
DELETE FROM tournaments
WHERE id = $1
RETURNING id, name, start_date, end_date;

-- name: AddTournamentMember :exec
INSERT INTO tournament_player_membership (tournament_id, player_id)
VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: RemoveTournamentMember :exec
DELETE FROM tournament_player_membership
WHERE tournament_id = $1 AND player_id = $2;

-- name: CountTournamentMembers :one
SELECT COUNT(*)::int AS member_count
FROM tournament_player_membership
WHERE tournament_id = $1;

-- name: AddMatchTournament :exec
INSERT INTO match_tournament (match_id, tournament_id)
VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: DeleteMatchTournamentsByMatch :exec
DELETE FROM match_tournament
WHERE match_id = $1;

-- name: ListTournamentsByMatchIDs :many
SELECT
    mt.match_id,
    t.id AS tournament_id,
    t.name AS tournament_name
FROM match_tournament mt
JOIN tournaments t ON t.id = mt.tournament_id
WHERE mt.match_id = ANY(sqlc.arg('match_ids')::int4[])
ORDER BY t.name;

-- name: GetTournamentMatchDateRange :one
-- HAVING guards the aggregate: with no matches it returns zero rows (ErrNoRows)
-- instead of a (NULL, NULL) row that can't scan into the non-nullable time.Time.
SELECT
    MIN(m.date)::timestamptz AS min_date,
    MAX(m.date)::timestamptz AS max_date
FROM match_tournament mt
JOIN matches m ON m.id = mt.match_id
WHERE mt.tournament_id = $1
HAVING COUNT(*) > 0;

-- name: PlayerHasMatchInTournament :one
SELECT EXISTS (
    SELECT 1
    FROM match_tournament mt
    JOIN match_scores ms ON ms.match_id = mt.match_id
    WHERE mt.tournament_id = $1 AND ms.player_id = $2
) AS has_match;

-- name: GetTournamentStats :many
WITH ranked AS (
    SELECT
        ms.player_id,
        ms.match_id,
        RANK() OVER (PARTITION BY ms.match_id ORDER BY ms.score DESC) AS place
    FROM match_tournament mt
    JOIN match_scores ms ON ms.match_id = mt.match_id
    WHERE mt.tournament_id = $1
), agg AS (
    SELECT
        player_id,
        COUNT(DISTINCT match_id)::int                   AS matches_count,
        COUNT(*) FILTER (WHERE place = 1)::int          AS first_count,
        COUNT(*) FILTER (WHERE place = 2)::int          AS second_count,
        COUNT(*) FILTER (WHERE place = 3)::int          AS third_count,
        COUNT(*) FILTER (WHERE place = 4)::int          AS fourth_count
    FROM ranked
    GROUP BY player_id
)
SELECT
    tpm.player_id,
    p.name AS player_name,
    COALESCE(agg.matches_count, 0)::int AS matches_count,
    COALESCE(agg.first_count, 0)::int   AS first_count,
    COALESCE(agg.second_count, 0)::int  AS second_count,
    COALESCE(agg.third_count, 0)::int   AS third_count,
    COALESCE(agg.fourth_count, 0)::int  AS fourth_count
FROM tournament_player_membership tpm
JOIN players p ON p.id = tpm.player_id
LEFT JOIN agg ON agg.player_id = tpm.player_id
WHERE tpm.tournament_id = $1
ORDER BY first_count DESC, second_count DESC, third_count DESC, fourth_count DESC,
         matches_count DESC, p.name ASC;
