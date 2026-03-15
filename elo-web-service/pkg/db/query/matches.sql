-- name: CreateMatch :one
INSERT INTO matches (date, game_id)
VALUES ($1, $2)
RETURNING *;

-- name: UpsertMatchScore :exec
INSERT INTO match_scores (match_id, player_id, score, elo_pay, elo_earn, new_elo)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (match_id, player_id)
DO UPDATE SET
    score = EXCLUDED.score,
    elo_pay = EXCLUDED.elo_pay,
    elo_earn = EXCLUDED.elo_earn,
    new_elo = EXCLUDED.new_elo;

-- name: ListMatchResults :many
SELECT
    m.id AS match_id,
    m.date,
    g.name AS game_name,
    p.id AS player_id,
    p.name AS player_name,
    s.score,
    s.elo_pay,
    s.elo_earn,
    s.new_elo
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
    s.elo_pay,
    s.elo_earn,
    s.new_elo,
    CASE WHEN prev_match_score.new_elo IS NULL THEN NULL
    ELSE prev_match_score.new_elo END AS prev_rating

FROM matches m
JOIN games g ON g.id = m.game_id
JOIN match_scores s ON s.match_id = m.id
JOIN players p ON p.id = s.player_id
LEFT JOIN LATERAL (
    SELECT ms.new_elo
    FROM match_scores ms
    JOIN matches prev_m ON prev_m.id = ms.match_id
    WHERE ms.player_id = p.id AND prev_m.date < m.date
    ORDER BY prev_m.date DESC, prev_m.id DESC
    LIMIT 1
) prev_match_score ON true
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
    s.elo_pay,
    s.elo_earn,
    s.new_elo,
    CASE WHEN prev_match_score.new_elo IS NULL THEN NULL
    ELSE prev_match_score.new_elo END AS prev_rating,
    elo_settings.elo_const_k,
    elo_settings.elo_const_d,
    elo_settings.starting_elo,
    elo_settings.win_reward

FROM matches m
JOIN games g ON g.id = m.game_id
JOIN match_scores s ON s.match_id = m.id
JOIN players p ON p.id = s.player_id
LEFT JOIN LATERAL (
    SELECT ms.new_elo
    FROM match_scores ms
    JOIN matches prev_m ON prev_m.id = ms.match_id
    WHERE ms.player_id = p.id AND prev_m.date < m.date
    ORDER BY prev_m.date DESC, prev_m.id DESC
    LIMIT 1
) prev_match_score ON true
LEFT JOIN LATERAL (
    SELECT elo_const_k, elo_const_d, starting_elo, win_reward
    FROM elo_settings
    WHERE effective_date <= m.date
    ORDER BY effective_date DESC
    LIMIT 1
) elo_settings ON true
WHERE g.id = $1
ORDER BY m.date ASC, m.id ASC, s.score DESC;

-- name: GetPlayerLatestElo :one
SELECT ms.new_elo
FROM match_scores ms
JOIN matches m ON m.id = ms.match_id
WHERE ms.player_id = $1
ORDER BY m.date DESC, m.id DESC
LIMIT 1;

-- name: GetMatch :one
SELECT * FROM matches
WHERE id = $1
FOR UPDATE;

-- name: UpdateMatch :exec
UPDATE matches
SET date = $2, game_id = $3
WHERE id = $1;

-- name: GetMatchesFromDate :many
SELECT m.*
FROM matches m
WHERE m.date >= $1
ORDER BY m.date ASC, m.id ASC;

-- name: GetMatchScoresForMatch :many
SELECT player_id, score
FROM match_scores
WHERE match_id = $1;

-- name: DeleteMatchScores :exec
DELETE FROM match_scores
WHERE match_id = $1;

-- name: UpdateMatchScoreElo :exec
UPDATE match_scores
SET elo_pay = $3, elo_earn = $4, new_elo = $5
WHERE match_id = $1 AND player_id = $2;

-- name: ListMatchesWithPlayersPaginated :many
WITH paginated_matches AS (
    SELECT DISTINCT m.id, m.date, m.game_id
    FROM matches m
    JOIN match_scores ms ON ms.match_id = m.id
    WHERE
        (sqlc.narg('game_id')::int4 IS NULL OR m.game_id = sqlc.narg('game_id')::int4)
        AND (sqlc.narg('player_id')::int4 IS NULL OR ms.player_id = sqlc.narg('player_id')::int4)
        AND (
            sqlc.narg('cursor_id')::int4 IS NULL
            OR m.date < sqlc.narg('cursor_date')::timestamptz
            OR (m.date = sqlc.narg('cursor_date')::timestamptz AND m.id < sqlc.narg('cursor_id')::int4)
        )
    ORDER BY m.date DESC, m.id DESC
    LIMIT sqlc.arg('limit')::int4
)
SELECT
    pm.id AS match_id,
    pm.date,
    g.id AS game_id,
    g.name AS game_name,
    p.id AS player_id,
    p.name AS player_name,
    s.score,
    s.elo_pay,
    s.elo_earn,
    s.new_elo,
    CASE WHEN prev_match_score.new_elo IS NULL THEN NULL
    ELSE prev_match_score.new_elo END AS prev_rating
FROM paginated_matches pm
JOIN games g ON g.id = pm.game_id
JOIN match_scores s ON s.match_id = pm.id
JOIN players p ON p.id = s.player_id
LEFT JOIN LATERAL (
    SELECT ms.new_elo
    FROM match_scores ms
    JOIN matches prev_m ON prev_m.id = ms.match_id
    WHERE ms.player_id = p.id AND prev_m.date < pm.date
    ORDER BY prev_m.date DESC, prev_m.id DESC
    LIMIT 1
) prev_match_score ON true
ORDER BY pm.date DESC, pm.id DESC, s.score DESC;

-- name: GetMatchWithPlayers :many
SELECT
    m.id AS match_id,
    m.date,
    g.id AS game_id,
    g.name AS game_name,
    p.id AS player_id,
    p.name AS player_name,
    s.score,
    s.elo_pay,
    s.elo_earn,
    s.new_elo,
    CASE WHEN prev_match_score.new_elo IS NULL THEN NULL
    ELSE prev_match_score.new_elo END AS prev_rating
FROM matches m
JOIN games g ON g.id = m.game_id
JOIN match_scores s ON s.match_id = m.id
JOIN players p ON p.id = s.player_id
LEFT JOIN LATERAL (
    SELECT ms.new_elo
    FROM match_scores ms
    JOIN matches prev_m ON prev_m.id = ms.match_id
    WHERE ms.player_id = p.id AND prev_m.date < m.date
    ORDER BY prev_m.date DESC, prev_m.id DESC
    LIMIT 1
) prev_match_score ON true
WHERE m.id = $1
ORDER BY s.score DESC;

-- name: GetPlayerLatestEloBeforeMatch :one
SELECT ms.new_elo
FROM match_scores ms
JOIN matches m ON m.id = ms.match_id
WHERE ms.player_id = $1
  AND (m.date < $2 OR (m.date = $2 AND m.id < $3))
ORDER BY m.date DESC, m.id DESC
LIMIT 1;
