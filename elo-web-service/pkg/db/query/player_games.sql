-- Player game collection ("коллекция игр" on the profile page).

-- name: GetPlayerGameCollection :many
-- The player's collected games, most-played by this player first (every match
-- type counts — competitive and coop alike), ties alphabetically by the
-- generated display name (alias → ru → en), id as the final tiebreaker.
SELECT
  g.id,
  g.name,
  g.image_thumb_url,
  (SELECT COUNT(*)::int
     FROM match_scores ms
     JOIN matches m ON m.id = ms.match_id
    WHERE ms.player_id = pg.player_id
      AND m.game_id = pg.game_id) AS matches_count
FROM player_games pg
JOIN games g ON g.id = pg.game_id
WHERE pg.player_id = $1
ORDER BY matches_count DESC, g.name, g.id;

-- name: CountPlayerGames :one
SELECT COUNT(*)::int FROM player_games WHERE player_id = $1;

-- name: AddPlayerGame :exec
INSERT INTO player_games (player_id, game_id)
VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: RemovePlayerGame :exec
DELETE FROM player_games
WHERE player_id = $1 AND game_id = $2;
