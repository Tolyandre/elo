-- name: GetEloSettingsForDate :one
SELECT elo_const_k, elo_const_d
FROM elo_settings
WHERE effective_date <= $1
ORDER BY effective_date DESC
LIMIT 1;

-- name: GetLatestEloSettings :one
SELECT elo_const_k, elo_const_d, effective_date
FROM elo_settings
ORDER BY effective_date DESC
LIMIT 1;

-- name: CreateEloSettings :exec
INSERT INTO elo_settings (effective_date, elo_const_k, elo_const_d)
VALUES ($1, $2, $3);

-- name: ListEloSettings :many
SELECT effective_date, elo_const_k, elo_const_d
FROM elo_settings
ORDER BY effective_date DESC;
