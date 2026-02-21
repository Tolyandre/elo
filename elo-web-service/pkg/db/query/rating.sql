-- name: UpsertRating :exec
INSERT INTO player_ratings (date, player_id, rating)
VALUES ($1, $2, $3)
ON CONFLICT (date, player_id)
DO UPDATE SET rating = EXCLUDED.rating;

-- name: RatingHistory :many
SELECT date, rating
FROM player_ratings
WHERE player_id = $1
ORDER BY date;
