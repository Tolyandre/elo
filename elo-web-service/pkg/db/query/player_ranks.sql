-- name: ListPlayersWithStats :many
SELECT p.id, p.name,
  CASE WHEN latest_elo.new_rating IS NULL THEN NULL ELSE latest_elo.new_rating END AS rating,
  COALESCE(cnt_30.cnt, 0) AS cnt_30,
  COALESCE(cnt_90.cnt, 0) AS cnt_90,
  COALESCE(cnt_180.cnt, 0) AS cnt_180
FROM players p
LEFT JOIN LATERAL (
  SELECT gas.new_rating
  FROM global_arena_settlement gas
  WHERE gas.player_id = p.id AND gas.date <= $1
  ORDER BY gas.date DESC, gas.id DESC
  LIMIT 1
) latest_elo ON true
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
ORDER BY latest_elo.new_rating DESC NULLS LAST, p.name;

