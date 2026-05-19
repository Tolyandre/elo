-- name: RatingHistory :many
SELECT gas.date, gas.new_rating AS rating
FROM global_arena_settlement gas
WHERE gas.player_id = $1
ORDER BY gas.date;

-- name: UpsertGlobalArenaSettlementByMatch :exec
INSERT INTO global_arena_settlement (player_id, date, new_rating, discriminator, match_id, staked, earned)
SELECT $2, m.date, $3, 'match', $1, $4, $5
FROM matches m WHERE m.id = $1
ON CONFLICT (match_id, player_id) WHERE match_id IS NOT NULL
DO UPDATE SET new_rating = EXCLUDED.new_rating, date = EXCLUDED.date,
              staked = EXCLUDED.staked, earned = EXCLUDED.earned;

-- name: UpsertGameArenaSettlementByMatch :exec
INSERT INTO game_arena_settlement (game_id, player_id, date, new_rating, discriminator, match_id, staked, earned)
SELECT $2, $3, m.date, $4, 'match', $1, $5, $6
FROM matches m WHERE m.id = $1
ON CONFLICT (match_id, player_id) WHERE match_id IS NOT NULL
DO UPDATE SET new_rating = EXCLUDED.new_rating, date = EXCLUDED.date,
              staked = EXCLUDED.staked, earned = EXCLUDED.earned;

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
    CASE WHEN prev_gas.new_rating IS NULL THEN NULL ELSE prev_gas.new_rating END AS prev_global_elo,
    COALESCE(es.elo_const_k, 32)    AS elo_const_k,
    COALESCE(es.elo_const_d, 400)   AS elo_const_d,
    COALESCE(es.starting_elo, 1000) AS starting_elo,
    COALESCE(es.win_reward, 1)      AS win_reward
FROM matches m
JOIN match_scores s ON s.match_id = m.id
JOIN players p ON p.id = s.player_id
LEFT JOIN LATERAL (
    SELECT gas2.new_rating
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
SELECT gas.new_rating AS rating
FROM global_arena_settlement gas
WHERE gas.player_id = $1
ORDER BY gas.date DESC, gas.id DESC
LIMIT 1;

-- name: GetPlayerLatestGlobalEloAtDate :one
SELECT gas.new_rating AS rating
FROM global_arena_settlement gas
WHERE gas.player_id = $1
  AND gas.date <= $2
ORDER BY gas.date DESC, gas.id DESC
LIMIT 1;

-- name: GetPlayerLatestGlobalEloBeforeMatch :one
SELECT gas.new_rating AS rating
FROM global_arena_settlement gas
WHERE gas.player_id = $1
  AND (gas.date < $2 OR (gas.date = $2 AND gas.match_id IS NOT NULL AND gas.match_id < $3))
ORDER BY gas.date DESC, gas.id DESC
LIMIT 1;

-- name: GetPlayerLatestGameElo :one
SELECT gas.new_rating AS game_new_elo
FROM game_arena_settlement gas
WHERE gas.player_id = $1
  AND gas.game_id = $2
ORDER BY gas.date DESC, gas.match_id DESC
LIMIT 1;

-- name: GetPlayerLatestGameEloBeforeMatch :one
SELECT gas.new_rating AS game_new_elo
FROM game_arena_settlement gas
WHERE gas.player_id = $1
  AND gas.game_id = $2
  AND (gas.date < $3 OR (gas.date = $3 AND gas.match_id < $4))
ORDER BY gas.date DESC, gas.match_id DESC
LIMIT 1;

-- name: ListLatestGameEloPerPlayer :many
SELECT DISTINCT ON (gas.player_id) gas.player_id, gas.new_rating AS game_new_elo
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
    gas.staked AS game_elo_pay,
    gas.earned AS game_elo_earn,
    gas.new_rating AS game_new_elo
FROM matches m
JOIN match_scores s ON s.match_id = m.id
JOIN players p ON p.id = s.player_id
LEFT JOIN game_arena_settlement gas ON gas.match_id = s.match_id AND gas.player_id = s.player_id
WHERE m.game_id = $1
ORDER BY m.date ASC, m.id ASC, s.score DESC;
