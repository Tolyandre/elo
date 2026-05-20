-- name: ListPlayersWithStats :many
SELECT p.id, p.name,
  CASE WHEN latest_elo.new_rating IS NULL THEN NULL ELSE latest_elo.new_rating END AS rating,
  COALESCE(latest_elo.league, 'newbie') AS league,
  COALESCE(cnt_60.cnt, 0) AS cnt_60,
  COALESCE(cnt_180.cnt, 0) AS cnt_180
FROM players p
LEFT JOIN LATERAL (
  SELECT gas.new_rating, gas.league
  FROM global_arena_settlement gas
  WHERE gas.player_id = p.id AND gas.date <= $1
  ORDER BY gas.date DESC, gas.id DESC
  LIMIT 1
) latest_elo ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS cnt FROM matches m
  JOIN match_scores ms ON ms.match_id = m.id
  WHERE ms.player_id = p.id AND m.date >= ($1 - interval '60 days') AND m.date <= $1
) cnt_60 ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS cnt FROM matches m
  JOIN match_scores ms ON ms.match_id = m.id
  WHERE ms.player_id = p.id AND m.date >= ($1 - interval '180 days') AND m.date <= $1
) cnt_180 ON true
ORDER BY latest_elo.new_rating DESC NULLS LAST, p.name;
