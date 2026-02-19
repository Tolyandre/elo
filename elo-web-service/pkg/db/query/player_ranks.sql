-- name: ListPlayersWithStats :many
SELECT p.id, p.name,
  CASE
    WHEN pr.rating IS NULL THEN NULL
    ELSE pr.rating
  END AS rating,
  COALESCE(cnt_30.cnt, 0) AS cnt_30,
  COALESCE(cnt_90.cnt, 0) AS cnt_90,
  COALESCE(cnt_180.cnt, 0) AS cnt_180
FROM players p
LEFT JOIN LATERAL (
  SELECT rating FROM player_ratings WHERE player_id = p.id AND player_ratings.date <= $1 ORDER BY player_ratings.date DESC LIMIT 1
) pr ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS cnt FROM matches m
  JOIN match_scores ms ON ms.match_id = m.id
  WHERE ms.player_id = p.id AND m.date >= ($1 - interval '30 days') AND m.date <= $1
) cnt_30 ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS cnt FROM matches m
  JOIN match_scores ms ON ms.match_id = m.id
  WHERE ms.player_id = p.id AND m.date >= ($1 - interval '90 days') AND m.date <= $1
) cnt_90 ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS cnt FROM matches m
  JOIN match_scores ms ON ms.match_id = m.id
  WHERE ms.player_id = p.id AND m.date >= ($1 - interval '180 days') AND m.date <= $1
) cnt_180 ON true
ORDER BY pr.rating DESC NULLS LAST, p.name;
