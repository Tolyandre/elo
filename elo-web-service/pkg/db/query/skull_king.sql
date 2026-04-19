-- name: CreateSkullKingTable :one
INSERT INTO skull_king_tables (host_user_id, game_state)
VALUES ($1, $2)
RETURNING *;

-- name: GetSkullKingTable :one
SELECT * FROM skull_king_tables WHERE id = $1;

-- name: GetSkullKingTableForUpdate :one
SELECT * FROM skull_king_tables WHERE id = $1 FOR UPDATE;

-- name: ListSkullKingTables :many
SELECT * FROM skull_king_tables WHERE expires_at > NOW() ORDER BY created_at DESC;

-- name: UpdateSkullKingTableState :one
UPDATE skull_king_tables SET game_state = $2 WHERE id = $1 RETURNING *;

-- name: AddSkullKingTablePlayer :one
UPDATE skull_king_tables
SET connected_player_ids = array_append(connected_player_ids, $2)
WHERE id = $1 AND NOT ($2 = ANY(connected_player_ids))
RETURNING *;

-- name: DeleteSkullKingTable :exec
DELETE FROM skull_king_tables WHERE id = $1;

-- name: DeleteExpiredSkullKingTables :exec
DELETE FROM skull_king_tables WHERE expires_at < NOW();

-- name: GetNearestSkullKingTableExpiry :one
SELECT expires_at FROM skull_king_tables WHERE expires_at > NOW() ORDER BY expires_at ASC LIMIT 1;
