-- name: CreateMatch :one
INSERT INTO matches (date, game_id)
VALUES ($1, $2)
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
    s.score,
    gas.staked AS rating_pay,
    gas.earned AS rating_earn,
    CASE WHEN gas.new_rating IS NULL THEN NULL ELSE gas.new_rating END AS global_new_elo
FROM match_scores s
JOIN players p ON p.id = s.player_id
JOIN matches m ON m.id = s.match_id
JOIN games g ON g.id = m.game_id
LEFT JOIN global_arena_settlement gas ON gas.match_id = s.match_id AND gas.player_id = s.player_id AND gas.discriminator = 'match'
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
    gas.staked AS rating_pay,
    gas.earned AS rating_earn,
    -- CASE forces sqlc to infer a nullable type (interface{}) so pgx can scan NULL
    -- for players whose first match has no previous rating or no settlement row yet
    CASE WHEN gas.new_rating IS NULL THEN NULL ELSE gas.new_rating END AS global_new_elo,
    CASE WHEN prev_player_rating.new_rating IS NULL THEN NULL ELSE prev_player_rating.new_rating END AS prev_rating

FROM matches m
JOIN games g ON g.id = m.game_id
JOIN match_scores s ON s.match_id = m.id
JOIN players p ON p.id = s.player_id
LEFT JOIN global_arena_settlement gas ON gas.match_id = s.match_id AND gas.player_id = s.player_id AND gas.discriminator = 'match'
LEFT JOIN LATERAL (
    SELECT gas2.new_rating
    FROM global_arena_settlement gas2
    WHERE gas2.player_id = p.id AND gas2.date < m.date
    ORDER BY gas2.date DESC, gas2.id DESC
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
    gas.staked AS rating_pay,
    gas.earned AS rating_earn,
    -- CASE forces sqlc to infer a nullable type (interface{}) so pgx can scan NULL
    -- for players whose first match has no previous rating or no settlement row yet
    CASE WHEN gas.new_rating IS NULL THEN NULL ELSE gas.new_rating END AS global_new_elo,
    CASE WHEN prev_player_rating.new_rating IS NULL THEN NULL ELSE prev_player_rating.new_rating END AS prev_rating,
    elo_settings.elo_const_k,
    elo_settings.elo_const_d,
    elo_settings.starting_elo,
    elo_settings.win_reward

FROM matches m
JOIN games g ON g.id = m.game_id
JOIN match_scores s ON s.match_id = m.id
JOIN players p ON p.id = s.player_id
LEFT JOIN global_arena_settlement gas ON gas.match_id = s.match_id AND gas.player_id = s.player_id AND gas.discriminator = 'match'
LEFT JOIN LATERAL (
    SELECT gas2.new_rating
    FROM global_arena_settlement gas2
    WHERE gas2.player_id = p.id AND gas2.date < m.date
    ORDER BY gas2.date DESC, gas2.id DESC
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
    gas.staked AS rating_pay,
    gas.earned AS rating_earn,
    -- CASE forces sqlc to infer a nullable type (interface{}) so pgx can scan NULL
    -- for players whose first match has no previous rating or no settlement row yet
    CASE WHEN gas.new_rating IS NULL THEN NULL ELSE gas.new_rating END AS global_new_elo,
    CASE WHEN prev_player_rating.new_rating IS NULL THEN NULL ELSE prev_player_rating.new_rating END AS prev_rating,
    EXISTS(SELECT 1 FROM markets WHERE resolution_match_id = pm.id) AS has_markets
FROM paginated_matches pm
JOIN games g ON g.id = pm.game_id
JOIN match_scores s ON s.match_id = pm.id
JOIN players p ON p.id = s.player_id
LEFT JOIN global_arena_settlement gas ON gas.match_id = s.match_id AND gas.player_id = s.player_id AND gas.discriminator = 'match'
LEFT JOIN LATERAL (
    SELECT gas2.new_rating
    FROM global_arena_settlement gas2
    WHERE gas2.player_id = p.id AND gas2.date < pm.date
    ORDER BY gas2.date DESC, gas2.id DESC
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
    gas.staked AS rating_pay,
    gas.earned AS rating_earn,
    -- CASE forces sqlc to infer a nullable type (interface{}) so pgx can scan NULL
    -- for players whose first match has no previous rating or no settlement row yet
    CASE WHEN gas.new_rating IS NULL THEN NULL ELSE gas.new_rating END AS global_new_elo,
    CASE WHEN prev_player_rating.new_rating IS NULL THEN NULL ELSE prev_player_rating.new_rating END AS prev_rating
FROM matches m
JOIN games g ON g.id = m.game_id
JOIN match_scores s ON s.match_id = m.id
JOIN players p ON p.id = s.player_id
LEFT JOIN global_arena_settlement gas ON gas.match_id = s.match_id AND gas.player_id = s.player_id AND gas.discriminator = 'match'
LEFT JOIN LATERAL (
    SELECT gas2.new_rating
    FROM global_arena_settlement gas2
    WHERE gas2.player_id = p.id AND gas2.date < m.date
    ORDER BY gas2.date DESC, gas2.id DESC
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

-- name: GetCountMatchesByGame :one
SELECT COUNT(DISTINCT m.id) AS total_matches
FROM matches m
WHERE m.game_id = $1;
