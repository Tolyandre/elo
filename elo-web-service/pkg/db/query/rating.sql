-- name: RatingHistory :many
-- Returns rating_after and elo_after ordered by date for the player graph.
SELECT gas.date, gas.rating_after AS rating, gas.elo_after AS elo
FROM global_arena_settlement gas
WHERE gas.player_id = $1
ORDER BY gas.date;

-- name: UpsertGlobalArenaSettlementByMatch :exec
INSERT INTO global_arena_settlement
    (id, player_id, date, rating_after, elo_after, discriminator, match_id,
     elo_staked, elo_earned, rating_staked, rating_earned, league)
SELECT $2, $3, m.date, $4, $5, 'match', $1, $6, $7, $8, $9, $10
FROM matches m WHERE m.id = $1
ON CONFLICT (match_id, player_id) WHERE match_id IS NOT NULL
DO UPDATE SET rating_after  = EXCLUDED.rating_after,
              elo_after     = EXCLUDED.elo_after,
              date          = EXCLUDED.date,
              elo_staked    = EXCLUDED.elo_staked,
              elo_earned    = EXCLUDED.elo_earned,
              rating_staked = EXCLUDED.rating_staked,
              rating_earned = EXCLUDED.rating_earned,
              league        = EXCLUDED.league;

-- name: UpsertGameArenaSettlementByMatch :exec
INSERT INTO game_arena_settlement
    (id, game_id, player_id, date, rating_after, elo_after, discriminator, match_id,
     elo_staked, elo_earned, rating_staked, rating_earned, league)
SELECT $2, $3, $4, m.date, $5, $6, 'match', $1, $7, $8, $9, $10, $11
FROM matches m WHERE m.id = $1
ON CONFLICT (match_id, player_id) WHERE match_id IS NOT NULL
DO UPDATE SET rating_after  = EXCLUDED.rating_after,
              elo_after     = EXCLUDED.elo_after,
              date          = EXCLUDED.date,
              elo_staked    = EXCLUDED.elo_staked,
              elo_earned    = EXCLUDED.elo_earned,
              rating_staked = EXCLUDED.rating_staked,
              rating_earned = EXCLUDED.rating_earned,
              league        = EXCLUDED.league;

-- name: DeleteGlobalArenaSettlementByMatch :exec
DELETE FROM global_arena_settlement WHERE match_id = $1 AND discriminator = 'match';

-- name: DeleteGameArenaSettlementByMatch :exec
DELETE FROM game_arena_settlement WHERE match_id = $1;

-- name: ListMatchesForEloReset :many
SELECT
    m.id AS match_id,
    m.date,
    p.id AS player_id,
    p.name AS player_name,
    s.score,
    -- CASE forces sqlc to infer interface{} so pgx can scan NULL for a player's first match
    CASE WHEN prev_gas.elo_after IS NULL THEN NULL ELSE prev_gas.elo_after END AS prev_global_elo,
    COALESCE(es.elo_const_k, 32)    AS elo_const_k,
    COALESCE(es.elo_const_d, 400)   AS elo_const_d,
    COALESCE(es.starting_elo, 1000) AS starting_elo,
    COALESCE(es.win_reward, 1)      AS win_reward
FROM matches m
JOIN match_scores s ON s.match_id = m.id
JOIN players p ON p.id = s.player_id
LEFT JOIN LATERAL (
    SELECT gas2.elo_after
    FROM global_arena_settlement gas2
    WHERE gas2.player_id = p.id
      AND (gas2.date < m.date OR (gas2.date = m.date AND gas2.match_id IS NOT NULL AND gas2.match_id < m.id))
    ORDER BY gas2.date DESC, gas2.id DESC
    LIMIT 1
) prev_gas ON true
LEFT JOIN LATERAL (
    SELECT elo_const_k, elo_const_d, starting_elo, win_reward
    FROM elo_settings
    WHERE effective_date <= m.date
    ORDER BY effective_date DESC
    LIMIT 1
) es ON true
WHERE m.date <= $1
ORDER BY m.date ASC, m.id ASC;

-- name: GetPlayerLatestGlobalElo :one
-- Returns the true Elo value (elo_after) for Elo calculations.
SELECT gas.elo_after AS rating
FROM global_arena_settlement gas
WHERE gas.player_id = $1
ORDER BY gas.date DESC, gas.id DESC
LIMIT 1;

-- name: GetPlayerLatestGlobalEloAtDate :one
SELECT gas.elo_after AS rating
FROM global_arena_settlement gas
WHERE gas.player_id = $1
  AND gas.date <= $2
ORDER BY gas.date DESC, gas.id DESC
LIMIT 1;

-- name: GetPlayerLatestGlobalEloBeforeMatch :one
SELECT gas.elo_after AS rating
FROM global_arena_settlement gas
WHERE gas.player_id = $1
  AND (gas.date < $2 OR (gas.date = $2 AND gas.match_id IS NOT NULL AND gas.match_id < $3))
ORDER BY gas.date DESC, gas.id DESC
LIMIT 1;

-- name: GetPlayerLatestGlobalRating :one
-- Returns the display rating (rating_after) and current league for rating-track calculations.
SELECT gas.rating_after AS rating, gas.league
FROM global_arena_settlement gas
WHERE gas.player_id = $1
ORDER BY gas.date DESC, gas.id DESC
LIMIT 1;

-- name: GetPlayerLatestGlobalRatingAtDate :one
SELECT gas.rating_after AS rating, gas.league
FROM global_arena_settlement gas
WHERE gas.player_id = $1
  AND gas.date <= $2
ORDER BY gas.date DESC, gas.id DESC
LIMIT 1;

-- name: GetPlayerLatestGlobalRatingBeforeMatch :one
SELECT gas.rating_after AS rating, gas.league
FROM global_arena_settlement gas
WHERE gas.player_id = $1
  AND (gas.date < $2 OR (gas.date = $2 AND gas.match_id IS NOT NULL AND gas.match_id < $3))
ORDER BY gas.date DESC, gas.id DESC
LIMIT 1;

-- name: GetPlayerLatestGameElo :one
SELECT gas.elo_after AS game_elo_after
FROM game_arena_settlement gas
WHERE gas.player_id = $1
  AND gas.game_id = $2
ORDER BY gas.date DESC, gas.match_id DESC
LIMIT 1;

-- name: GetPlayerLatestGameEloBeforeMatch :one
SELECT gas.elo_after AS game_elo_after
FROM game_arena_settlement gas
WHERE gas.player_id = $1
  AND gas.game_id = $2
  AND (gas.date < $3 OR (gas.date = $3 AND gas.match_id < $4))
ORDER BY gas.date DESC, gas.match_id DESC
LIMIT 1;

-- name: GetPlayerLatestGameRating :one
-- Returns the display game rating and current game league.
SELECT gas.rating_after AS game_rating_after, gas.league
FROM game_arena_settlement gas
WHERE gas.player_id = $1
  AND gas.game_id = $2
ORDER BY gas.date DESC, gas.match_id DESC
LIMIT 1;

-- name: GetPlayerLatestGameRatingBeforeMatch :one
SELECT gas.rating_after AS game_rating_after, gas.league
FROM game_arena_settlement gas
WHERE gas.player_id = $1
  AND gas.game_id = $2
  AND (gas.date < $3 OR (gas.date = $3 AND gas.match_id < $4))
ORDER BY gas.date DESC, gas.match_id DESC
LIMIT 1;

-- name: ListLatestGameEloPerPlayer :many
SELECT DISTINCT ON (gas.player_id) gas.player_id, gas.elo_after AS game_elo_after
FROM game_arena_settlement gas
WHERE gas.game_id = $1
ORDER BY gas.player_id, gas.date DESC, gas.match_id DESC;

-- name: ListLatestGameRatingPerPlayer :many
SELECT DISTINCT ON (gas.player_id)
  gas.player_id,
  gas.rating_after AS game_rating_after,
  gas.elo_after    AS game_elo_after,
  gas.league
FROM game_arena_settlement gas
WHERE gas.game_id = $1
ORDER BY gas.player_id, gas.date DESC, gas.match_id DESC;

-- name: ListMatchesWithPlayersByGameFromDB :many
SELECT
    m.id AS match_id,
    m.date,
    p.id AS player_id,
    p.name AS player_name,
    s.score,
    gas.rating_staked AS game_rating_staked,
    gas.rating_earned AS game_rating_earned,
    gas.rating_after  AS game_rating_after
FROM matches m
JOIN match_scores s ON s.match_id = m.id
JOIN players p ON p.id = s.player_id
LEFT JOIN game_arena_settlement gas ON gas.match_id = s.match_id AND gas.player_id = s.player_id
WHERE m.game_id = $1
ORDER BY m.date ASC, m.id ASC, s.score DESC;

-- name: GetPlayerGlobalMatchCountInPeriod :one
-- Counts matches a player participated in within [from_date, to_date].
SELECT COUNT(*)::int AS count
FROM matches m
JOIN match_scores ms ON ms.match_id = m.id
WHERE ms.player_id = $1 AND m.date >= $2 AND m.date <= $3;

-- name: GetPlayerGameMatchCountInPeriod :one
-- Counts game-specific matches a player participated in within [from_date, to_date].
SELECT COUNT(*)::int AS count
FROM matches m
JOIN match_scores ms ON ms.match_id = m.id
WHERE ms.player_id = $1 AND m.game_id = $2 AND m.date >= $3 AND m.date <= $4;
