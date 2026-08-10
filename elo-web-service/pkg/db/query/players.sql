-- name: CreatePlayer :one
INSERT INTO players (id, name, geologist_name)
VALUES ($1, $2, $3)
ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
RETURNING *;

-- name: GetPlayer :one
SELECT * FROM players
WHERE id = $1;

-- name: ListPlayers :many
SELECT * FROM players
ORDER BY name;

-- name: DeletePlayer :exec
DELETE FROM players WHERE id = $1;

-- name: AddPlayersIfNotExists :many
INSERT INTO players (id, name)
SELECT unnest($1::uuid[]) AS id, unnest($2::text[]) AS name
ON CONFLICT (name) DO NOTHING
RETURNING id, name;

-- name: GetPlayerByName :one
SELECT * FROM players
WHERE name = $1;

-- name: LockPlayerForEloCalculation :one
SELECT id FROM players WHERE id = $1 FOR UPDATE;

-- name: UpdatePlayer :one
UPDATE players
SET name = $2
WHERE id = $1
RETURNING *;

-- name: GetPlayerGameStats :many
-- Per-game stats for the player profile "Частые игры" table:
--   normalized_score = Σ (gas.elo_earned / K effective at the settlement's date)
--     (for matches, gas.elo_earned = K · NormalizedScore, so this sums the [0,1]
--      share-of-pool: a win contributes 1, a loss 0, ties/middle places a fraction)
--   gold/silver/bronze counts come from ranking players by score within each match.
--   NOTE: the rank must be computed over ALL players in a match, so the CTE ranks
--   every player in each of the target player's matches and the outer query then
--   filters down to the target player's own rows.
WITH ranked AS (
  SELECT
    ms.match_id,
    ms.player_id,
    RANK() OVER (PARTITION BY ms.match_id ORDER BY ms.score DESC) AS place
  FROM match_scores ms
  JOIN (
    SELECT DISTINCT match_id FROM match_scores WHERE player_id = $1
  ) pm ON pm.match_id = ms.match_id
)
SELECT
  g.id::text AS game_id,
  g.name AS game_name,
  COUNT(*)::int AS matches_count,
  COALESCE(SUM(
    gas.elo_earned / (
      SELECT es.elo_const_k
      FROM elo_settings es
      WHERE es.effective_date <= gas.date
      ORDER BY es.effective_date DESC
      LIMIT 1
    )
  ), 0)::float8 AS normalized_score,
  COUNT(*) FILTER (WHERE ranked.place = 1)::int AS gold_count,
  COUNT(*) FILTER (WHERE ranked.place = 2)::int AS silver_count,
  COUNT(*) FILTER (WHERE ranked.place = 3)::int AS bronze_count
FROM global_arena_settlement gas
JOIN ranked
  ON ranked.match_id = gas.match_id
  AND ranked.player_id = gas.player_id
JOIN matches m ON m.id = gas.match_id
JOIN games g ON g.id = m.game_id
WHERE gas.player_id = $1
  AND gas.discriminator = 'match'
GROUP BY g.id, g.name
ORDER BY matches_count DESC
LIMIT 10;

-- name: ListPlayerUserLinks :many
SELECT player_id, id AS user_id FROM users WHERE player_id IS NOT NULL;

-- name: GetPlayerGameEloStats :many
SELECT
  g.id::text AS game_id,
  g.name     AS game_name,
  SUM(gas.elo_earned + gas.elo_staked)::float8 AS elo_earned
FROM match_scores ms
JOIN matches m ON ms.match_id = m.id
JOIN games g ON m.game_id = g.id
JOIN global_arena_settlement gas ON gas.match_id = ms.match_id AND gas.player_id = ms.player_id AND gas.discriminator = 'match'
WHERE ms.player_id = $1
GROUP BY g.id, g.name
ORDER BY elo_earned DESC;
