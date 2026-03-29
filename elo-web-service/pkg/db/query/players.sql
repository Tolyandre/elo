-- name: CreatePlayer :one
INSERT INTO players (name, geologist_name)
VALUES ($1, $2)
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
INSERT INTO players (name)
SELECT unnest($1::text[]) AS name
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
SELECT
  g.id::text AS game_id,
  g.name     AS game_name,
  COUNT(ms.match_id)::int AS matches_count,
  COUNT(CASE WHEN ms.score = max_scores.max_score THEN 1 END)::int AS wins
FROM match_scores ms
JOIN matches m ON ms.match_id = m.id
JOIN games g ON m.game_id = g.id
JOIN (
  SELECT match_id, MAX(score) AS max_score
  FROM match_scores
  GROUP BY match_id
) max_scores ON max_scores.match_id = ms.match_id
WHERE ms.player_id = $1
GROUP BY g.id, g.name
ORDER BY matches_count DESC
LIMIT 10;

-- name: ListPlayerUserLinks :many
SELECT player_id, id AS user_id FROM users WHERE player_id IS NOT NULL;

-- name: GetPlayerGameEloStats :many
SELECT
  g.id::text AS game_id,
  g.name     AS game_name,
  SUM(ms.rating_earn + ms.rating_pay)::float8 AS elo_earned
FROM match_scores ms
JOIN matches m ON ms.match_id = m.id
JOIN games g ON m.game_id = g.id
WHERE ms.player_id = $1
GROUP BY g.id, g.name
ORDER BY elo_earned DESC;
