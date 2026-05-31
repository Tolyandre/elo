-- name: GetEloSettingsForDate :one
SELECT elo_const_k, elo_const_d, starting_elo, win_reward,
       newbie_league_earned_min, newbie_league_earned_max, newbie_league_earned_tau,
       newbie_league_goal_gap,
       starting_rating_global_arena, starting_rating_game_arena,
       elite_league_matches_6months, elite_league_matches_2months
FROM elo_settings
WHERE effective_date <= $1
ORDER BY effective_date DESC
LIMIT 1;

-- name: GetLatestEloSettings :one
SELECT elo_const_k, elo_const_d, starting_elo, win_reward, effective_date,
       newbie_league_earned_min, newbie_league_earned_max, newbie_league_earned_tau,
       newbie_league_goal_gap,
       starting_rating_global_arena, starting_rating_game_arena,
       elite_league_matches_6months, elite_league_matches_2months
FROM elo_settings
ORDER BY effective_date DESC
LIMIT 1;

-- name: CreateEloSettings :exec
INSERT INTO elo_settings (effective_date, elo_const_k, elo_const_d, starting_elo, win_reward,
    newbie_league_earned_min, newbie_league_earned_max, newbie_league_earned_tau,
    newbie_league_goal_gap,
    starting_rating_global_arena, starting_rating_game_arena,
    elite_league_matches_6months, elite_league_matches_2months)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13);

-- name: ListEloSettings :many
SELECT effective_date, elo_const_k, elo_const_d, starting_elo, win_reward,
       newbie_league_earned_min, newbie_league_earned_max, newbie_league_earned_tau,
       newbie_league_goal_gap,
       starting_rating_global_arena, starting_rating_game_arena,
       elite_league_matches_6months, elite_league_matches_2months
FROM elo_settings
ORDER BY effective_date DESC;

-- name: DeleteEloSettings :exec
DELETE FROM elo_settings WHERE effective_date = $1;
