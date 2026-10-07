-- name: ListGamesOrderedByLastPlayed :many
SELECT
	g.id AS id,
	g.name AS name,
	g.name_en AS name_en,
	g.name_ru AS name_ru,
	g.alias AS alias,
	g.bgg_id AS bgg_id,
	g.tesera_id AS tesera_id,
	g.image_url AS image_url,
	g.image_thumb_url AS image_thumb_url,
	g.game_mode AS game_mode,
	COUNT(m.id) AS total_matches
FROM games g
LEFT JOIN matches m ON m.game_id = g.id
GROUP BY g.id, g.name, g.name_en, g.name_ru, g.alias, g.bgg_id, g.tesera_id, g.image_url, g.image_thumb_url, g.game_mode
ORDER BY MAX(m.date) DESC;

-- name: ListRecentGames :many
-- Games played recently by the current user's player or by a member of any of
-- their clubs, with the date of the most recent such match — the recency key
-- of the game picker's «Недавние» section. my_player_id is NULL when the user
-- has no linked player.
SELECT g.id AS game_id, MAX(m.date)::timestamptz AS last_match_at
FROM matches m
JOIN games g ON g.id = m.game_id
WHERE EXISTS (
        SELECT 1 FROM match_scores mine
        WHERE mine.match_id = m.id
          AND mine.player_id = sqlc.narg('my_player_id')
      )
   OR EXISTS (
        SELECT 1
        FROM match_scores partner
        JOIN player_club_membership pcm ON pcm.player_id = partner.player_id
        WHERE partner.match_id = m.id
          AND pcm.club_id = ANY(sqlc.arg('club_ids')::uuid[])
      )
GROUP BY g.id
ORDER BY last_match_at DESC
LIMIT sqlc.arg('limit')::int4;

-- name: ListPopularClubGames :many
-- Games most played by members of the given clubs — the recency/popularity
-- pair of the game picker's «Популярные» section. A match counts once when at
-- least one club member took part in it; last_match_at breaks count ties.
SELECT m.game_id AS game_id, COUNT(*) AS match_count, MAX(m.date)::timestamptz AS last_match_at
FROM matches m
WHERE EXISTS (
        SELECT 1
        FROM match_scores ms
        JOIN player_club_membership pcm ON pcm.player_id = ms.player_id
        WHERE ms.match_id = m.id
          AND pcm.club_id = ANY(sqlc.arg('club_ids')::uuid[])
      )
GROUP BY m.game_id
ORDER BY match_count DESC, last_match_at DESC
LIMIT sqlc.arg('limit')::int4;

-- name: ListPopularGamesGlobal :many
-- Globally most played games — the «Популярные» fallback for users whose
-- player belongs to no club.
SELECT m.game_id AS game_id, COUNT(*) AS match_count, MAX(m.date)::timestamptz AS last_match_at
FROM matches m
GROUP BY m.game_id
ORDER BY match_count DESC, last_match_at DESC
LIMIT sqlc.arg('limit')::int4;

-- name: DeleteGame :one
DELETE FROM games
WHERE id = $1
RETURNING *;

-- name: UpdateGame :one
-- `name` is generated (migration 063) and follows the three source names.
UPDATE games
SET	name_en = $2,
	name_ru = $3,
	alias = $4,
	bgg_id = $5,
	tesera_id = $6,
	game_mode = $7
WHERE id = $1
RETURNING *;

-- name: AddGame :one
INSERT INTO games (id, name_en, name_ru, alias, bgg_id, tesera_id, game_mode)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
RETURNING *;

-- name: GetGameByName :one
SELECT * FROM games
WHERE name = $1;

-- name: GetGameByID :one
SELECT * FROM games
WHERE id = $1;

-- name: ListGamesWithoutTeseraRef :many
SELECT * FROM games
WHERE tesera_id IS NULL
ORDER BY name;

-- name: ListGamesForBggEnrich :many
-- Games carrying a BGG reference whose box art has not been fetched yet.
-- The both-NULL predicate means a row enriched with only one URL (BGG has a
-- thumbnail but no full image) leaves the enrichment set for good.
SELECT * FROM games
WHERE bgg_id IS NOT NULL AND image_url IS NULL AND image_thumb_url IS NULL
ORDER BY id;

-- name: UpdateGameBggImages :one
UPDATE games
SET	image_url = $2,
	image_thumb_url = $3
WHERE id = $1
RETURNING *;
