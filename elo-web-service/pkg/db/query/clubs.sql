-- Club queries. player_club_membership is stint history (ADR-36): joined_at
-- / left_at, left_at NULL = active stint. Reads of "the members" always
-- filter to active stints; the /club tenancy fields (kind, openness, main
-- arena) are part of every club read.

-- name: ListClubs :many
SELECT
    c.id AS club_id,
    c.name AS club_name,
    c.geologist_name AS club_geologist_name,
    c.icon AS club_icon,
    c.kind AS club_kind,
    c.arena_membership_mode AS club_arena_membership_mode,
    c.tournaments_openness AS club_tournaments_openness,
    ma.id AS main_arena_id,
    pcm.player_id AS player_id
FROM clubs c
LEFT JOIN arenas ma ON ma.club_id = c.id
LEFT JOIN player_club_membership pcm ON pcm.club_id = c.id AND pcm.left_at IS NULL;

-- name: GetClub :many
SELECT
    c.id AS club_id,
    c.name AS club_name,
    c.geologist_name AS club_geologist_name,
    c.icon AS club_icon,
    c.kind AS club_kind,
    c.arena_membership_mode AS club_arena_membership_mode,
    c.tournaments_openness AS club_tournaments_openness,
    ma.id AS main_arena_id,
    pcm.player_id AS player_id
FROM clubs c
LEFT JOIN arenas ma ON ma.club_id = c.id
LEFT JOIN player_club_membership pcm ON pcm.club_id = c.id AND pcm.left_at IS NULL
WHERE c.id = $1;

-- name: CreateClub :one
-- A new club is a plain group (ADR-36): kind defaults, tenant columns NULL.
INSERT INTO clubs (id, name)
VALUES ($1, $2)
RETURNING *;

-- name: UpdateClubName :one
UPDATE clubs
SET name = $2
WHERE id = $1
RETURNING *;

-- name: UpdateClubIcon :one
UPDATE clubs
SET icon = $2
WHERE id = $1
RETURNING *;

-- name: ConvertClubToTenant :one
-- One-way group → tenant conversion (ADR-36); returns no rows when the club
-- is missing or already a tenant. The caller creates the main arena in the
-- same transaction.
UPDATE clubs
SET kind = 'tenant', arena_membership_mode = $2, tournaments_openness = $3
WHERE id = $1 AND kind = 'group'
RETURNING *;

-- name: UpdateClubTenantSettings :one
-- Openness settings of an existing tenant (ADR-36); no rows when the club is
-- missing or still a group.
UPDATE clubs
SET arena_membership_mode = $2, tournaments_openness = $3
WHERE id = $1 AND kind = 'tenant'
RETURNING *;

-- name: DeleteClub :one
DELETE FROM clubs
WHERE id = $1
RETURNING *;

-- name: AddClubMember :exec
-- Opens a membership stint at now() (ADR-36). A still-active stint for the
-- same (club, player) makes this a no-op via the partial unique index
-- player_club_membership_active_uniq.
INSERT INTO player_club_membership (club_id, player_id, joined_at)
VALUES ($1, $2, NOW())
ON CONFLICT DO NOTHING;

-- name: RemoveClubMember :exec
-- Closes the active stint; closed stints stay as history (ADR-36).
UPDATE player_club_membership
SET left_at = NOW()
WHERE club_id = $1 AND player_id = $2 AND left_at IS NULL;

-- name: GetClubByID :one
-- Old-name read for the rename audit trail (ADR-14).
SELECT * FROM clubs WHERE id = $1;

-- name: ClubContainsPlayers :one
-- Whether the participants count into the club's main arena under its CURRENT
-- openness mode, evaluated at @date against stint history (ADR-36): any_member
-- — at least one participant was a member at @date; members_only — all were.
-- The Go settlement gate consults this before settling a match into the
-- club's arena (the SQL-side twin, club_arena_contains_match, probes
-- match_scores itself and lives in migration 069).
SELECT CASE c.arena_membership_mode
           WHEN 'any_member' THEN EXISTS (
               SELECT 1
               FROM player_club_membership pcm
               WHERE pcm.club_id = c.id
                 AND pcm.player_id = ANY(sqlc.arg('player_ids')::uuid[])
                 AND pcm.joined_at <= sqlc.arg('date')::timestamptz
                 AND (pcm.left_at IS NULL OR pcm.left_at > sqlc.arg('date')::timestamptz)
           )
           WHEN 'members_only' THEN NOT EXISTS (
               SELECT 1
               FROM unnest(sqlc.arg('player_ids')::uuid[]) AS pid
               WHERE NOT EXISTS (
                   SELECT 1
                   FROM player_club_membership pcm2
                   WHERE pcm2.club_id = c.id
                     AND pcm2.player_id = pid
                     AND pcm2.joined_at <= sqlc.arg('date')::timestamptz
                     AND (pcm2.left_at IS NULL OR pcm2.left_at > sqlc.arg('date')::timestamptz)
               )
           )
           ELSE false
       END AS contains
FROM clubs c
WHERE c.id = sqlc.arg('club_id');

-- name: PlayerIsClubMember :one
-- Current-member check (active stint, ADR-36) — the members_only gates:
-- tournament registration and bets/guarantees on a members_only club's market.
SELECT EXISTS (
    SELECT 1 FROM player_club_membership
    WHERE club_id = sqlc.arg('club_id')
      AND player_id = sqlc.arg('player_id')
      AND left_at IS NULL
) AS is_member;

-- name: ListClubFeedEvents :many
-- One page of the club feed (GET /clubs/{id}/feed, ADR-36): the community's
-- activity, membership-scoped — deliberately NOT arena-attribution-scoped, so
-- a tournament match appears even when it does not count into the club's main
-- arena rating. Match events go to any current member's matches (coop
-- included: community life, not just rating); correction events to
-- corrections of current members; market events to the markets the club
-- OWNS (a member's bet on another club's market is that club's news).
-- Parameters and cursor are the arena feed's minus the arena and the
-- include flags; the club itself is the feed's identity.
WITH events AS (
    SELECT DISTINCT m.id, m.date AS sort_date, 'match'::text AS event_type
    FROM matches m
    JOIN match_scores ms ON ms.match_id = m.id
    WHERE EXISTS (
              SELECT 1 FROM player_club_membership pcm
              WHERE pcm.club_id = sqlc.arg('club_id')::uuid
                AND pcm.left_at IS NULL
                AND pcm.player_id = ms.player_id
          )
      AND (
          sqlc.narg('player_id')::uuid IS NULL OR ms.player_id = sqlc.narg('player_id')::uuid
      )
      AND (
          sqlc.narg('game_id')::uuid IS NULL OR m.game_id = sqlc.narg('game_id')::uuid
      )
    UNION ALL
    SELECT c.id, c.date, 'correction'::text
    FROM corrections c
    WHERE EXISTS (
              SELECT 1 FROM player_club_membership pcm
              WHERE pcm.club_id = sqlc.arg('club_id')::uuid
                AND pcm.left_at IS NULL
                AND pcm.player_id = c.player_id
          )
    UNION ALL
    -- The club's markets: an active market (open or betting-locked) sorts at
    -- its creation moment, a settled one (resolved or cancelled) at its
    -- resolution moment — the arena feed's ordering, with the owning club as
    -- the membership condition.
    SELECT om.id,
           CASE WHEN om.status IN ('open', 'betting_closed') THEN om.created_at
                ELSE om.resolved_at
           END AS sort_date,
           'market'::text
    FROM markets om
    WHERE om.club_id = sqlc.arg('club_id')::uuid
      AND (
          (om.status IN ('open', 'betting_closed') AND om.created_at IS NOT NULL)
          OR (om.status IN ('resolved', 'cancelled') AND om.resolved_at IS NOT NULL)
      )
      AND (
          sqlc.narg('player_id')::uuid IS NULL
          OR EXISTS (SELECT 1 FROM market_match_winner_params mwp
                     WHERE mwp.market_id = om.id
                       AND sqlc.narg('player_id')::uuid = ANY(mwp.target_player_ids))
          OR EXISTS (SELECT 1 FROM market_win_streak_params wsp
                     WHERE wsp.market_id = om.id
                       AND wsp.target_player_id = sqlc.narg('player_id')::uuid)
          OR EXISTS (SELECT 1 FROM market_outcomes mo
                     WHERE mo.market_id = om.id
                       AND mo.player_id = sqlc.narg('player_id')::uuid)
          OR EXISTS (SELECT 1 FROM market_guarantees mg
                     WHERE mg.market_id = om.id
                       AND mg.player_id = sqlc.narg('player_id')::uuid)
          OR EXISTS (SELECT 1 FROM arena_settlements ars
                     WHERE ars.market_id = om.id
                       AND ars.player_id = sqlc.narg('player_id')::uuid)
      )
      AND (
          sqlc.narg('game_id')::uuid IS NULL
          OR EXISTS (SELECT 1 FROM market_match_winner_params mwp
                     WHERE mwp.market_id = om.id
                       AND sqlc.narg('game_id')::uuid = ANY(mwp.game_ids))
          OR EXISTS (SELECT 1 FROM market_win_streak_params wsp
                     WHERE wsp.market_id = om.id
                       AND sqlc.narg('game_id')::uuid = ANY(wsp.game_ids))
          OR EXISTS (SELECT 1 FROM matches rm
                     WHERE rm.id = om.resolution_match_id
                       AND rm.game_id = sqlc.narg('game_id')::uuid)
      )
)
SELECT id, sort_date, event_type
FROM events
WHERE
    sqlc.narg('cursor_date')::timestamptz IS NULL
    OR sort_date < sqlc.narg('cursor_date')::timestamptz
    OR (
        sort_date = sqlc.narg('cursor_date')::timestamptz
        AND (
            event_type < sqlc.narg('cursor_type')::text
            OR (event_type = sqlc.narg('cursor_type')::text AND id < sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY sort_date DESC, event_type DESC, id DESC
LIMIT sqlc.arg('limit')::int4;
