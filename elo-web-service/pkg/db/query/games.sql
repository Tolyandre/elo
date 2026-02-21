-- name: AddGamesIfNotExists :many
INSERT INTO games (name)
SELECT unnest($1::text[]) AS name
ON CONFLICT (name) DO NOTHING
RETURNING id, name;

-- name: ListGamesOrderedByLastPlayed :many
SELECT
	g.id AS id,
	g.name AS name,
	COUNT(m.id) AS total_matches
FROM games g
LEFT JOIN matches m ON m.game_id = g.id
GROUP BY g.id, g.name
ORDER BY MAX(m.date) DESC;

-- name: DeleteGame :one
DELETE FROM games
WHERE id = $1
RETURNING id, name;

-- name: UpdateGameName :one
UPDATE games
SET name = $2
WHERE id = $1
RETURNING id, name;

-- name: AddGame :one
INSERT INTO games (name)
VALUES ($1)
RETURNING id, name;

-- name: GetGameByName :one
SELECT id, name FROM games
WHERE name = $1;