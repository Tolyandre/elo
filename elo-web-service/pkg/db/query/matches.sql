-- name: CreateMatch :one
INSERT INTO matches (date, game_id)
VALUES ($1, $2)
RETURNING *;

-- name: UpsertMatchScore :exec
INSERT INTO match_scores (match_id, player_id, score, rating_pay, rating_earn, game_elo_pay, game_elo_earn, game_new_elo)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (match_id, player_id)
DO UPDATE SET
    score = EXCLUDED.score,
    rating_pay = EXCLUDED.rating_pay,
    rating_earn = EXCLUDED.rating_earn,
    game_elo_pay = EXCLUDED.game_elo_pay,
    game_elo_earn = EXCLUDED.game_elo_earn,
    game_new_elo = EXCLUDED.game_new_elo;

-- name: ListMatchResults :many
SELECT
    m.id AS match_id,
    m.date,
    g.name AS game_name,
    p.id AS player_id,
    p.name AS player_name,
    s.score,
    s.rating_pay,
    s.rating_earn,
    CASE WHEN pr.rating IS NULL THEN NULL ELSE pr.rating END AS global_new_elo
FROM match_scores s
JOIN players p ON p.id = s.player_id
JOIN matches m ON m.id = s.match_id
JOIN games g ON g.id = m.game_id
LEFT JOIN player_ratings pr ON pr.match_id = s.match_id AND pr.player_id = s.player_id
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
    s.rating_pay,
    s.rating_earn,
    -- CASE forces sqlc to infer a nullable type (interface{}) so pgx can scan NULL
    -- for players whose first match has no previous rating or no player_ratings row yet
    CASE WHEN pr.rating IS NULL THEN NULL ELSE pr.rating END AS global_new_elo,
    CASE WHEN prev_player_rating.rating IS NULL THEN NULL ELSE prev_player_rating.rating END AS prev_rating

FROM matches m
JOIN games g ON g.id = m.game_id
JOIN match_scores s ON s.match_id = m.id
JOIN players p ON p.id = s.player_id
LEFT JOIN player_ratings pr ON pr.match_id = s.match_id AND pr.player_id = s.player_id
LEFT JOIN LATERAL (
    SELECT pr2.rating
    FROM player_ratings pr2
    WHERE pr2.player_id = p.id AND pr2.date < m.date
    ORDER BY pr2.date DESC, pr2.id DESC
    LIMIT 1
) prev_player_rating ON true
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
    s.rating_pay,
    s.rating_earn,
    -- CASE forces sqlc to infer a nullable type (interface{}) so pgx can scan NULL
    -- for players whose first match has no previous rating or no player_ratings row yet
    CASE WHEN pr.rating IS NULL THEN NULL ELSE pr.rating END AS global_new_elo,
    CASE WHEN prev_player_rating.rating IS NULL THEN NULL ELSE prev_player_rating.rating END AS prev_rating,
    elo_settings.elo_const_k,
    elo_settings.elo_const_d,
    elo_settings.starting_elo,
    elo_settings.win_reward

FROM matches m
JOIN games g ON g.id = m.game_id
JOIN match_scores s ON s.match_id = m.id
JOIN players p ON p.id = s.player_id
LEFT JOIN player_ratings pr ON pr.match_id = s.match_id AND pr.player_id = s.player_id
LEFT JOIN LATERAL (
    SELECT pr2.rating
    FROM player_ratings pr2
    WHERE pr2.player_id = p.id AND pr2.date < m.date
    ORDER BY pr2.date DESC, pr2.id DESC
    LIMIT 1
) prev_player_rating ON true
LEFT JOIN LATERAL (
    SELECT elo_const_k, elo_const_d, starting_elo, win_reward
    FROM elo_settings
    WHERE effective_date <= m.date
    ORDER BY effective_date DESC
    LIMIT 1
) elo_settings ON true
WHERE g.id = $1
ORDER BY m.date ASC, m.id ASC, s.score DESC;

-- name: GetPlayerLatestGlobalElo :one
SELECT pr.rating
FROM player_ratings pr
WHERE pr.player_id = $1
ORDER BY pr.date DESC, pr.id DESC
LIMIT 1;

-- name: GetPlayerLatestGlobalEloAtDate :one
SELECT pr.rating
FROM player_ratings pr
WHERE pr.player_id = $1
  AND pr.date <= $2
ORDER BY pr.date DESC, pr.id DESC
LIMIT 1;

-- name: GetPlayerLatestGlobalEloBeforeMatch :one
SELECT pr.rating
FROM player_ratings pr
WHERE pr.player_id = $1
  AND (pr.date < $2 OR (pr.date = $2 AND pr.match_id IS NOT NULL AND pr.match_id < $3))
ORDER BY pr.date DESC, pr.id DESC
LIMIT 1;

-- name: GetPlayerLatestGameElo :one
SELECT ms.game_new_elo
FROM match_scores ms
JOIN matches m ON m.id = ms.match_id
WHERE ms.player_id = $1
  AND m.game_id = $2
ORDER BY m.date DESC, m.id DESC
LIMIT 1;

-- name: GetPlayerLatestGameEloBeforeMatch :one
SELECT ms.game_new_elo
FROM match_scores ms
JOIN matches m ON m.id = ms.match_id
WHERE ms.player_id = $1
  AND m.game_id = $2
  AND (m.date < $3 OR (m.date = $3 AND m.id < $4))
ORDER BY m.date DESC, m.id DESC
LIMIT 1;

-- name: UpdateMatchScoreRating :exec
UPDATE match_scores
SET rating_pay = $3, rating_earn = $4
WHERE match_id = $1 AND player_id = $2;

-- name: UpdateMatchScoreGameElo :exec
UPDATE match_scores
SET game_elo_pay = $3, game_elo_earn = $4, game_new_elo = $5
WHERE match_id = $1 AND player_id = $2;

-- name: ListLatestGameEloPerPlayer :many
SELECT DISTINCT ON (ms.player_id) ms.player_id, ms.game_new_elo
FROM match_scores ms
JOIN matches m ON m.id = ms.match_id
WHERE m.game_id = $1
ORDER BY ms.player_id, m.date DESC, m.id DESC;

-- name: ListMatchesWithPlayersByGameFromDB :many
SELECT
    m.id AS match_id,
    m.date,
    p.id AS player_id,
    p.name AS player_name,
    s.score,
    s.game_elo_pay,
    s.game_elo_earn,
    s.game_new_elo
FROM matches m
JOIN match_scores s ON s.match_id = m.id
JOIN players p ON p.id = s.player_id
WHERE m.game_id = $1
ORDER BY m.date ASC, m.id ASC, s.score DESC;

-- name: GetCountMatchesByGame :one
SELECT COUNT(DISTINCT m.id) AS total_matches
FROM matches m
WHERE m.game_id = $1;

-- name: ListMatchesWithPlayersPaginated :many
WITH paginated_matches AS (
    SELECT DISTINCT m.id, m.date, m.game_id
    FROM matches m
    JOIN match_scores ms ON ms.match_id = m.id
    WHERE
        (sqlc.narg('game_id')::int4 IS NULL OR m.game_id = sqlc.narg('game_id')::int4)
        AND (sqlc.narg('player_id')::int4 IS NULL OR ms.player_id = sqlc.narg('player_id')::int4)
        AND (
            sqlc.narg('cursor_date')::timestamptz IS NULL
            OR m.date < sqlc.narg('cursor_date')::timestamptz
        )
        AND (
            sqlc.narg('club_id')::int4 IS NULL
            OR EXISTS (
                SELECT 1 FROM player_club_membership pcm
                WHERE pcm.club_id = sqlc.narg('club_id')::int4
                AND pcm.player_id = ms.player_id
            )
        )
        AND (
            sqlc.narg('no_club')::bool IS NOT TRUE
            OR NOT EXISTS (
                SELECT 1 FROM player_club_membership pcm2
                WHERE pcm2.player_id = ms.player_id
            )
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
    s.rating_pay,
    s.rating_earn,
    -- CASE forces sqlc to infer a nullable type (interface{}) so pgx can scan NULL
    -- for players whose first match has no previous rating or no player_ratings row yet
    CASE WHEN pr.rating IS NULL THEN NULL ELSE pr.rating END AS global_new_elo,
    CASE WHEN prev_player_rating.rating IS NULL THEN NULL ELSE prev_player_rating.rating END AS prev_rating
FROM paginated_matches pm
JOIN games g ON g.id = pm.game_id
JOIN match_scores s ON s.match_id = pm.id
JOIN players p ON p.id = s.player_id
LEFT JOIN player_ratings pr ON pr.match_id = s.match_id AND pr.player_id = s.player_id
LEFT JOIN LATERAL (
    SELECT pr2.rating
    FROM player_ratings pr2
    WHERE pr2.player_id = p.id AND pr2.date < pm.date
    ORDER BY pr2.date DESC, pr2.id DESC
    LIMIT 1
) prev_player_rating ON true
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
    s.rating_pay,
    s.rating_earn,
    -- CASE forces sqlc to infer a nullable type (interface{}) so pgx can scan NULL
    -- for players whose first match has no previous rating or no player_ratings row yet
    CASE WHEN pr.rating IS NULL THEN NULL ELSE pr.rating END AS global_new_elo,
    CASE WHEN prev_player_rating.rating IS NULL THEN NULL ELSE prev_player_rating.rating END AS prev_rating
FROM matches m
JOIN games g ON g.id = m.game_id
JOIN match_scores s ON s.match_id = m.id
JOIN players p ON p.id = s.player_id
LEFT JOIN player_ratings pr ON pr.match_id = s.match_id AND pr.player_id = s.player_id
LEFT JOIN LATERAL (
    SELECT pr2.rating
    FROM player_ratings pr2
    WHERE pr2.player_id = p.id AND pr2.date < m.date
    ORDER BY pr2.date DESC, pr2.id DESC
    LIMIT 1
) prev_player_rating ON true
WHERE m.id = $1
ORDER BY s.score DESC;

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
