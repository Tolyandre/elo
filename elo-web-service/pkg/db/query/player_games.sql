-- Player game collection ("коллекция игр" on the profile page).

-- name: GetPlayerGameCollection :many
-- The player's collected games, alphabetically by the generated display name
-- (alias → ru → en), id as the tiebreaker for a stable order.
SELECT g.id, g.name, g.image_thumb_url
FROM player_games pg
JOIN games g ON g.id = pg.game_id
WHERE pg.player_id = $1
ORDER BY g.name, g.id;

-- name: CountPlayerGames :one
SELECT COUNT(*)::int FROM player_games WHERE player_id = $1;

-- name: AddPlayerGame :exec
INSERT INTO player_games (player_id, game_id)
VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: RemovePlayerGame :exec
DELETE FROM player_games
WHERE player_id = $1 AND game_id = $2;
