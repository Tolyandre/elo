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

-- name: ListMatchesForEloReset :many
SELECT
    m.id AS match_id,
    m.date,
    p.id AS player_id,
    p.name AS player_name,
    s.score,
    -- CASE forces sqlc to infer interface{} so pgx can scan NULL for a player's first match
    CASE WHEN prev_pr.rating IS NULL THEN NULL ELSE prev_pr.rating END AS prev_global_elo,
    COALESCE(es.elo_const_k, 32)    AS elo_const_k,
    COALESCE(es.elo_const_d, 400)   AS elo_const_d,
    COALESCE(es.starting_elo, 1000) AS starting_elo,
    COALESCE(es.win_reward, 1)      AS win_reward
FROM matches m
JOIN match_scores s ON s.match_id = m.id
JOIN players p ON p.id = s.player_id
LEFT JOIN LATERAL (
    SELECT pr2.rating
    FROM player_ratings pr2
    WHERE pr2.player_id = p.id
      AND (pr2.date < m.date OR (pr2.date = m.date AND pr2.match_id IS NOT NULL AND pr2.match_id < m.id))
    ORDER BY pr2.date DESC, pr2.id DESC
    LIMIT 1
) prev_pr ON true
LEFT JOIN LATERAL (
    SELECT elo_const_k, elo_const_d, starting_elo, win_reward
    FROM elo_settings
    WHERE effective_date <= m.date
    ORDER BY effective_date DESC
    LIMIT 1
) es ON true
WHERE m.date <= $1
ORDER BY m.date ASC, m.id ASC;
