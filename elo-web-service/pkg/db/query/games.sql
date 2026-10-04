-- name: AddGamesIfNotExists :many
INSERT INTO games (id, name)
SELECT unnest($1::uuid[]) AS id, unnest($2::text[]) AS name
ON CONFLICT (name) DO NOTHING
RETURNING id, name;

-- name: ListGamesOrderedByLastPlayed :many
SELECT
	g.id AS id,
	g.name AS name,
	g.name_original AS name_original,
	g.name_ru AS name_ru,
	g.alias AS alias,
	g.bgg_id AS bgg_id,
	g.tesera_id AS tesera_id,
	COUNT(m.id) AS total_matches
FROM games g
LEFT JOIN matches m ON m.game_id = g.id
GROUP BY g.id, g.name, g.name_original, g.name_ru, g.alias, g.bgg_id, g.tesera_id
ORDER BY MAX(m.date) DESC;

-- name: DeleteGame :one
DELETE FROM games
WHERE id = $1
RETURNING *;

-- name: UpdateGame :one
UPDATE games
SET name = $2,
	name_original = $3,
	name_ru = $4,
	alias = $5,
	bgg_id = $6,
	tesera_id = $7
WHERE id = $1
RETURNING *;

-- name: AddGame :one
INSERT INTO games (id, name, name_original, name_ru, alias, bgg_id, tesera_id)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
RETURNING *;

-- name: GetGameByName :one
SELECT * FROM games
WHERE name = $1;

-- name: GetGameByID :one
SELECT * FROM games
WHERE id = $1;

-- name: ListGamesWithoutTeseraRef :many
SELECT * FROM games
WHERE tesera_id IS NULL
ORDER BY name;
