-- name: CreatePlayer :one
INSERT INTO players (id, name, geologist_name)
VALUES ($1, $2, $3)
ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
RETURNING *;

-- name: GetPlayer :one
SELECT * FROM players
WHERE id = $1;

-- name: ListPlayers :many
SELECT * FROM players
ORDER BY name;

-- name: DeletePlayer :one
-- Returns the deleted row so the audit trail can capture the player's name.
DELETE FROM players WHERE id = $1
RETURNING *;

-- name: AddPlayersIfNotExists :many
INSERT INTO players (id, name)
SELECT unnest($1::uuid[]) AS id, unnest($2::text[]) AS name
ON CONFLICT (name) DO NOTHING
RETURNING id, name;

-- name: GetPlayerByName :one
SELECT * FROM players
WHERE name = $1;

-- name: LockPlayerForEloCalculation :one
SELECT id FROM players WHERE id = $1 FOR UPDATE;

-- name: UpdatePlayer :one
UPDATE players
SET name = $2
WHERE id = $1
RETURNING *;

-- name: GetPlayerGameStats :many
-- Per-game stats for the player profile "Частые игры" table: match count plus
--   gold/silver/bronze counts from ranking players by score within each match.
--   NOTE: the rank must be computed over ALL players in a match, so the CTE ranks
--   every player in each of the target player's matches and the outer query then
--   filters down to the target player's own rows.
WITH ranked AS (
  SELECT
    ms.match_id,
    ms.player_id,
    RANK() OVER (PARTITION BY ms.match_id ORDER BY ms.score DESC) AS place
  FROM match_scores ms
  JOIN (
    SELECT DISTINCT match_id FROM match_scores WHERE player_id = $1
  ) pm ON pm.match_id = ms.match_id
)
SELECT
  g.id AS game_id,
  g.name AS game_name,
  COUNT(*)::int AS matches_count,
  COUNT(*) FILTER (WHERE ranked.place = 1)::int AS gold_count,
  COUNT(*) FILTER (WHERE ranked.place = 2)::int AS silver_count,
  COUNT(*) FILTER (WHERE ranked.place = 3)::int AS bronze_count
FROM arena_settlements gas
JOIN ranked
  ON ranked.match_id = gas.match_id
  AND ranked.player_id = gas.player_id
JOIN matches m ON m.id = gas.match_id
JOIN games g ON g.id = m.game_id
WHERE gas.arena_id = 'a2ea0000-0000-0000-0000-000000000001'
  AND gas.player_id = $1
  AND gas.discriminator = 'match'
GROUP BY g.id, g.name
ORDER BY matches_count DESC
LIMIT 10;

-- name: ListPlayerUserLinks :many
SELECT player_id, id AS user_id FROM users WHERE player_id IS NOT NULL;

-- name: GetPlayerGameEloStats :many
SELECT
  g.id AS game_id,
  g.name     AS game_name,
  SUM(gas.elo_earned + gas.elo_staked)::float8 AS elo_earned
FROM match_scores ms
JOIN matches m ON ms.match_id = m.id
JOIN games g ON m.game_id = g.id
JOIN arena_settlements gas ON gas.arena_id = 'a2ea0000-0000-0000-0000-000000000001'
  AND gas.match_id = ms.match_id AND gas.player_id = ms.player_id AND gas.discriminator = 'match'
WHERE ms.player_id = $1
GROUP BY g.id, g.name
ORDER BY elo_earned DESC;

-- ---------------------------------------------------------------------------
-- "Недавние" player-picker candidates (GET /players/recent)
-- ---------------------------------------------------------------------------

-- name: ListClubIDsByPlayerID :many
-- Active club memberships only (ADR-36 stint history): a former member's
-- club disappears from the picker tabs.
SELECT club_id FROM player_club_membership WHERE player_id = $1 AND left_at IS NULL;

-- name: ListClubMemberUserIDs :many
-- Users whose linked player is an active member of any of the given clubs —
-- the "users associated with the current user's club" for the recent list.
SELECT DISTINCT u.id
FROM users u
JOIN player_club_membership pcm ON pcm.player_id = u.player_id
WHERE pcm.left_at IS NULL
  AND pcm.club_id = ANY(sqlc.arg('club_ids')::uuid[]);

-- name: ListRecentCoPlayers :many
-- Players who shared a match with the current user's player or with a member
-- of any of the user's clubs, with the date of their most recent such match.
-- my_player_id is NULL when the user has no linked player.
SELECT p.id AS player_id, p.name AS player_name, MAX(m.date)::timestamptz AS last_match_at
FROM match_scores ms
JOIN matches m ON m.id = ms.match_id
JOIN players p ON p.id = ms.player_id
WHERE EXISTS (
        SELECT 1 FROM match_scores mine
        WHERE mine.match_id = ms.match_id
          AND mine.player_id = sqlc.narg('my_player_id')
      )
   OR EXISTS (
        SELECT 1
        FROM match_scores partner
        JOIN player_club_membership pcm ON pcm.player_id = partner.player_id
        WHERE partner.match_id = ms.match_id
          AND pcm.left_at IS NULL
          AND pcm.club_id = ANY(sqlc.arg('club_ids')::uuid[])
      )
GROUP BY p.id, p.name
ORDER BY last_match_at DESC, p.name ASC
LIMIT sqlc.arg('limit')::int4;

-- name: ListPlayersCreatedByUsers :many
-- Players created by any of the given users, per the audit log (ADR-14 — the
-- creator lives only in audit_log.actor_user_id), with the creation date.
-- Joined to players so deleted ones drop out.
SELECT a.entity_id AS player_id, p.name AS player_name, MAX(a.created_at)::timestamptz AS created_at
FROM audit_log a
JOIN players p ON p.id = a.entity_id
WHERE a.entity_type = 'player'
  AND a.action = 'created'
  AND a.actor_user_id = ANY(sqlc.arg('actor_ids')::uuid[])
GROUP BY a.entity_id, p.name
ORDER BY created_at DESC, p.name ASC
LIMIT sqlc.arg('limit')::int4;
