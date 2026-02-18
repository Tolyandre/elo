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