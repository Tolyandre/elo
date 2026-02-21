-- NOTE: UpsertRating is deprecated - Elo ratings are now stored in match_scores table
-- Kept for backwards compatibility but not actively used
-- -- name: UpsertRating :exec
-- INSERT INTO player_ratings (date, player_id, rating)
-- VALUES ($1, $2, $3)
-- ON CONFLICT (date, player_id)
-- DO UPDATE SET rating = EXCLUDED.rating;

-- name: RatingHistory :many
SELECT m.date, ms.new_elo as rating
FROM match_scores ms
JOIN matches m ON m.id = ms.match_id
WHERE ms.player_id = $1
ORDER BY m.date;
