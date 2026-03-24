-- name: RatingHistory :many
SELECT pr.date, pr.rating
FROM player_ratings pr
WHERE pr.player_id = $1
ORDER BY pr.date;

-- name: UpsertPlayerRatingByMatch :exec
INSERT INTO player_ratings (date, player_id, rating, source_type, match_id)
SELECT m.date, $2, $3, 'match', $1
FROM matches m WHERE m.id = $1
ON CONFLICT (match_id, player_id) WHERE match_id IS NOT NULL
DO UPDATE SET rating = EXCLUDED.rating, date = EXCLUDED.date;
