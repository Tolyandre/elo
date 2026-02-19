-- name: CreatePlayer :one
INSERT INTO players (name, geologist_name, google_sheet_column)
VALUES ($1, $2, $3)
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
