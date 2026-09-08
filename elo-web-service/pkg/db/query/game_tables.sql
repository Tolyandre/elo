-- name: CreateGameTable :one
INSERT INTO game_tables (id, host_user_id, game_id, host_client_token, game_state)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetGameTable :one
SELECT * FROM game_tables WHERE id = $1;

-- name: GetGameTableForUpdate :one
SELECT * FROM game_tables WHERE id = $1 FOR UPDATE;

-- name: ListGameTables :many
SELECT * FROM game_tables WHERE expires_at > NOW() ORDER BY created_at DESC;

-- name: UpdateGameTableState :one
UPDATE game_tables
SET game_state = $3, version = version + 1
WHERE id = $1 AND version = $2
RETURNING *;

-- name: AddGameTablePlayer :one
UPDATE game_tables
SET connected_player_ids = array_append(connected_player_ids, $2)
WHERE id = $1 AND NOT ($2 = ANY(connected_player_ids))
RETURNING *;

-- name: DeleteGameTable :exec
DELETE FROM game_tables WHERE id = $1;

-- name: DeleteExpiredGameTables :exec
DELETE FROM game_tables WHERE expires_at < NOW();

-- name: GetNearestGameTableExpiry :one
SELECT expires_at FROM game_tables WHERE expires_at > NOW() ORDER BY expires_at ASC LIMIT 1;

-- name: SetGameTableHost :one
UPDATE game_tables
SET host_user_id = $2, host_client_token = $3
WHERE id = $1
RETURNING *;
