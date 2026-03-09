-- name: GetEloSettingsForDate :one
SELECT elo_const_k, elo_const_d, starting_elo, win_reward
FROM elo_settings
WHERE effective_date <= $1
ORDER BY effective_date DESC
LIMIT 1;

-- name: GetLatestEloSettings :one
SELECT elo_const_k, elo_const_d, starting_elo, win_reward, effective_date
FROM elo_settings
ORDER BY effective_date DESC
LIMIT 1;

-- name: CreateEloSettings :exec
INSERT INTO elo_settings (effective_date, elo_const_k, elo_const_d, starting_elo, win_reward)
VALUES ($1, $2, $3, $4, $5);

-- name: ListEloSettings :many
SELECT effective_date, elo_const_k, elo_const_d, starting_elo, win_reward
FROM elo_settings
ORDER BY effective_date DESC;

-- name: DeleteEloSettings :exec
DELETE FROM elo_settings WHERE effective_date = $1;
