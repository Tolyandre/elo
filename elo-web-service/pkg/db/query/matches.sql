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
