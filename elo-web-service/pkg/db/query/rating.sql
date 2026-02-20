-- name: UpsertRating :exec
INSERT INTO player_ratings (match_id, player_id, rating)
VALUES ($1, $2, $3)
ON CONFLICT (match_id, player_id)
DO UPDATE SET rating = EXCLUDED.rating;

-- name: RatingHistory :many
SELECT pr.match_id, m.date, pr.rating
FROM player_ratings pr
JOIN matches m ON m.id = pr.match_id
WHERE pr.player_id = $1
ORDER BY m.date;

-- name: GetPlayerRatingAtMatch :one
SELECT rating
FROM player_ratings
WHERE player_id = $1 AND match_id = $2;

-- name: GetPlayerLatestRatingBeforeMatch :one
SELECT pr.rating
FROM player_ratings pr
JOIN matches m ON m.id = pr.match_id
WHERE pr.player_id = $1 AND pr.match_id < $2
ORDER BY pr.match_id DESC
LIMIT 1;
