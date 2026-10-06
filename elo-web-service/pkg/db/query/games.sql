-- name: ListGamesOrderedByLastPlayed :many
SELECT
	g.id AS id,
	g.name AS name,
	g.name_en AS name_en,
	g.name_ru AS name_ru,
	g.alias AS alias,
	g.bgg_id AS bgg_id,
	g.tesera_id AS tesera_id,
	g.image_url AS image_url,
	g.image_thumb_url AS image_thumb_url,
	COUNT(m.id) AS total_matches
FROM games g
LEFT JOIN matches m ON m.game_id = g.id
GROUP BY g.id, g.name, g.name_en, g.name_ru, g.alias, g.bgg_id, g.tesera_id, g.image_url, g.image_thumb_url
ORDER BY MAX(m.date) DESC;

-- name: DeleteGame :one
DELETE FROM games
WHERE id = $1
RETURNING *;

-- name: UpdateGame :one
-- `name` is generated (migration 063) and follows the three source names.
UPDATE games
SET	name_en = $2,
	name_ru = $3,
	alias = $4,
	bgg_id = $5,
	tesera_id = $6
WHERE id = $1
RETURNING *;

-- name: AddGame :one
INSERT INTO games (id, name_en, name_ru, alias, bgg_id, tesera_id)
VALUES ($1, $2, $3, $4, $5, $6)
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

-- name: ListGamesForBggEnrich :many
-- Games carrying a BGG reference whose box art has not been fetched yet.
-- The both-NULL predicate means a row enriched with only one URL (BGG has a
-- thumbnail but no full image) leaves the enrichment set for good.
SELECT * FROM games
WHERE bgg_id IS NOT NULL AND image_url IS NULL AND image_thumb_url IS NULL
ORDER BY id;

-- name: UpdateGameBggImages :one
UPDATE games
SET	image_url = $2,
	image_thumb_url = $3
WHERE id = $1
RETURNING *;
