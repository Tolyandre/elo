-- name: CreateMatch :one
INSERT INTO matches (date, game_id, google_sheet_row)
VALUES ($1, $2, $3)
RETURNING *;

-- name: UpsertMatchScore :exec
INSERT INTO match_scores (match_id, player_id, score)
VALUES ($1, $2, $3)
ON CONFLICT (match_id, player_id)
DO UPDATE SET score = EXCLUDED.score;

-- name: ListMatchResults :many
SELECT
    m.id AS match_id,
    m.date,
    g.name AS game_name,
    p.id AS player_id,
    p.name AS player_name,
    s.score
FROM match_scores s
JOIN players p ON p.id = s.player_id
JOIN matches m ON m.id = s.match_id
JOIN games g ON g.id = m.game_id
WHERE m.id = $1
ORDER BY s.score DESC;

-- name: ListMatchesWithPlayers :many
SELECT
    m.id AS match_id,
    m.date,
    g.id AS game_id,
    g.name AS game_name,
    p.id AS player_id,
    p.name AS player_name,
    s.score,
    CASE WHEN prev_rating.rating IS NULL THEN NULL
    ELSE prev_rating.rating END AS prev_rating

FROM matches m
JOIN games g ON g.id = m.game_id
JOIN match_scores s ON s.match_id = m.id
JOIN players p ON p.id = s.player_id
LEFT JOIN LATERAL (
    SELECT rating
    FROM player_ratings pr
    WHERE pr.player_id = p.id AND pr.date < m.date
    ORDER BY pr.date DESC
    LIMIT 1
) prev_rating ON true
ORDER BY m.date DESC, s.score DESC;

-- name: DeleteAllMatchScores :exec
DELETE FROM match_scores;

-- name: DeleteAllMatches :exec
DELETE FROM matches;

-- name: ListMatchesWithPlayersByGame :many
SELECT
    m.id AS match_id,
    m.date,
    g.id AS game_id,
    g.name AS game_name,
    p.id AS player_id,
    p.name AS player_name,
    s.score,
    CASE WHEN prev_rating.rating IS NULL THEN NULL
    ELSE prev_rating.rating END AS prev_rating

FROM matches m
JOIN games g ON g.id = m.game_id
JOIN match_scores s ON s.match_id = m.id
JOIN players p ON p.id = s.player_id
LEFT JOIN LATERAL (
    SELECT rating
    FROM player_ratings pr
    WHERE pr.player_id = p.id AND pr.date < m.date
    ORDER BY pr.date DESC
    LIMIT 1
) prev_rating ON true
WHERE g.id = $1
ORDER BY m.date ASC, m.id ASC, s.score DESC;
