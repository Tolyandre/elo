-- Tenant queries (ADR-36). A tenant is a separate community entity: name,
-- openness settings, one main arena (arenas.tenant_id), and one or many
-- clubs (clubs.tenant_id). Tenant membership is derived from club membership
-- stints: an active stint in any club of the tenant.

-- name: ListTenants :many
SELECT
    t.id AS tenant_id,
    t.name AS tenant_name,
    t.icon AS tenant_icon,
    t.arena_membership_mode AS tenant_arena_membership_mode,
    t.tournaments_openness AS tenant_tournaments_openness,
    ma.id AS main_arena_id,
    c.id AS club_id
FROM tenants t
LEFT JOIN arenas ma ON ma.tenant_id = t.id
LEFT JOIN clubs c ON c.tenant_id = t.id
ORDER BY t.name;

-- name: GetTenant :many
SELECT
    t.id AS tenant_id,
    t.name AS tenant_name,
    t.icon AS tenant_icon,
    t.arena_membership_mode AS tenant_arena_membership_mode,
    t.tournaments_openness AS tenant_tournaments_openness,
    ma.id AS main_arena_id,
    c.id AS club_id
FROM tenants t
LEFT JOIN arenas ma ON ma.tenant_id = t.id
LEFT JOIN clubs c ON c.tenant_id = t.id
WHERE t.id = $1;

-- name: GetTenantByID :one
-- Bare row for existence checks and settings recalculation.
SELECT * FROM tenants WHERE id = $1;

-- name: TenantNameExists :one
-- Uniqueness guard for tenant create/rename (case-insensitive, mirroring
-- clubs). @exclude_id skips the tenant being updated; NULL on create.
SELECT EXISTS(
    SELECT 1 FROM tenants
    WHERE lower(name) = lower(sqlc.arg('name')::text)
      AND (sqlc.narg('exclude_id')::uuid IS NULL OR id <> sqlc.narg('exclude_id')::uuid)
) AS exists;

-- name: CreateTenant :one
INSERT INTO tenants (id, name, arena_membership_mode, tournaments_openness)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: UpdateTenantName :one
UPDATE tenants
SET name = $2
WHERE id = $1
RETURNING *;

-- name: UpdateTenantIcon :one
-- Icon update: an empty string clears the icon (the same convention as club
-- icons). Validation (lowercase kebab-case, a known frontend key) happens in
-- the handler.
UPDATE tenants
SET icon = NULLIF(sqlc.arg('icon')::text, '')
WHERE id = $1
RETURNING *;

-- name: UpdateTenantSettings :one
-- Openness settings of an existing tenant (ADR-36); no rows when the tenant
-- is missing.
UPDATE tenants
SET arena_membership_mode = $2, tournaments_openness = $3
WHERE id = $1
RETURNING *;

-- name: SetTenantClubs :exec
-- Wholesale composition replacement (ADR-36): attach the given clubs to the
-- tenant and detach every other club currently attached to it. Callers
-- validate existence and "no other tenant" first.
UPDATE clubs
SET tenant_id = CASE WHEN id = ANY(sqlc.arg('club_ids')::uuid[])
                     THEN sqlc.arg('tenant_id')::uuid
                     ELSE NULL END
WHERE tenant_id = sqlc.arg('tenant_id')::uuid
   OR id = ANY(sqlc.arg('club_ids')::uuid[]);

-- name: TenantContainsPlayers :one
-- Whether the participants count into the tenant's main arena under its
-- CURRENT openness mode, evaluated at @date against stint history (ADR-36):
-- any_member — at least one participant was a member of any club of the
-- tenant at @date; members_only — all were. The Go settlement gate consults
-- this before settling a match into the tenant's arena (the SQL-side twin,
-- tenant_arena_contains_match, probes match_scores itself and lives in
-- migration 069).
SELECT CASE t.arena_membership_mode
           WHEN 'any_member' THEN EXISTS (
               SELECT 1
               FROM clubs c
               JOIN player_club_membership pcm ON pcm.club_id = c.id
               WHERE c.tenant_id = t.id
                 AND pcm.player_id = ANY(sqlc.arg('player_ids')::uuid[])
                 AND pcm.joined_at <= sqlc.arg('date')::timestamptz
                 AND (pcm.left_at IS NULL OR pcm.left_at > sqlc.arg('date')::timestamptz)
           )
           WHEN 'members_only' THEN NOT EXISTS (
               SELECT 1
               FROM unnest(sqlc.arg('player_ids')::uuid[]) AS pid
               WHERE NOT EXISTS (
                   SELECT 1
                   FROM clubs c2
                   JOIN player_club_membership pcm2 ON pcm2.club_id = c2.id
                   WHERE c2.tenant_id = t.id
                     AND pcm2.player_id = pid
                     AND pcm2.joined_at <= sqlc.arg('date')::timestamptz
                     AND (pcm2.left_at IS NULL OR pcm2.left_at > sqlc.arg('date')::timestamptz)
               )
           )
           ELSE false
       END AS contains
FROM tenants t
WHERE t.id = sqlc.arg('tenant_id');

-- name: PlayerIsTenantMember :one
-- Current-member check (active stint in any club of the tenant, ADR-36) —
-- the members_only gates: tournament registration and bets/guarantees on a
-- members_only tenant's market.
SELECT EXISTS (
    SELECT 1
    FROM clubs c
    JOIN player_club_membership pcm ON pcm.club_id = c.id
    WHERE c.tenant_id = sqlc.arg('tenant_id')
      AND pcm.player_id = sqlc.arg('player_id')
      AND pcm.left_at IS NULL
) AS is_member;

-- name: TenantHasActiveMemberAmong :one
-- Whether ANY of the players currently has an active stint in any club of
-- the tenant (ADR-36) — the tenant-feed membership predicate: a match lands
-- in the tenant's feed iff at least one participant is a current member.
-- The match update path rejects edits that would drop the last one. A row
-- comes from tenants, so an unknown tenant is no rows (ErrTenantNotFound).
SELECT EXISTS (
    SELECT 1
    FROM clubs c
    JOIN player_club_membership pcm ON pcm.club_id = c.id
    WHERE c.tenant_id = t.id
      AND pcm.player_id = ANY(sqlc.arg('player_ids')::uuid[])
      AND pcm.left_at IS NULL
) AS has_member
FROM tenants t
WHERE t.id = sqlc.arg('tenant_id');

-- name: ListTenantFeedEvents :many
-- One page of the tenant feed (GET /tenants/{id}/feed, ADR-36): the
-- community's activity, membership-scoped — deliberately NOT
-- arena-attribution-scoped, so a tournament match appears even when it does
-- not count into the tenant's main arena rating. Match events go to any
-- current member's matches — of any club of the tenant (coop included:
-- community life, not just rating); market events to the markets the tenant
-- OWNS (a member's bet on another tenant's market is that tenant's news).
-- The player/club/game filters apply to both branches (the arena feed's
-- matching rule). Parameters and cursor are the arena
-- feed's minus the arena and the include flags; the tenant itself is the
-- feed's identity.
WITH events AS (
    SELECT DISTINCT m.id, m.date AS sort_date, 'match'::text AS event_type
    FROM matches m
    JOIN match_scores ms ON ms.match_id = m.id
    WHERE EXISTS (
              SELECT 1
              FROM clubs c
              JOIN player_club_membership pcm ON pcm.club_id = c.id
              WHERE c.tenant_id = sqlc.arg('tenant_id')::uuid
                AND pcm.left_at IS NULL
                AND pcm.player_id = ms.player_id
          )
      AND (
          sqlc.narg('player_id')::uuid IS NULL OR ms.player_id = sqlc.narg('player_id')::uuid
      )
      AND (
          sqlc.narg('club_id')::uuid IS NULL
          OR EXISTS (
              SELECT 1 FROM player_club_membership pcm
              WHERE pcm.club_id = sqlc.narg('club_id')::uuid
                AND pcm.left_at IS NULL
                AND pcm.player_id = ms.player_id
          )
      )
      AND (
          sqlc.narg('game_id')::uuid IS NULL OR m.game_id = sqlc.narg('game_id')::uuid
      )
    UNION ALL
    -- The tenant's markets: an active market (open or betting-locked) sorts
    -- at its creation moment, a settled one (resolved or cancelled) at its
    -- resolution moment — the arena feed's ordering, with the owning tenant
    -- as the membership condition.
    SELECT om.id,
           CASE WHEN om.status IN ('open', 'betting_closed') THEN om.created_at
                ELSE om.resolved_at
           END AS sort_date,
           'market'::text
    FROM markets om
    WHERE om.tenant_id = sqlc.arg('tenant_id')::uuid
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
          sqlc.narg('club_id')::uuid IS NULL
          OR EXISTS (
              SELECT 1 FROM player_club_membership pcm
              WHERE pcm.club_id = sqlc.narg('club_id')::uuid
                AND pcm.left_at IS NULL
                AND (
                    EXISTS (SELECT 1 FROM market_match_winner_params mwp
                            WHERE mwp.market_id = om.id
                              AND pcm.player_id = ANY(mwp.target_player_ids))
                    OR EXISTS (SELECT 1 FROM market_win_streak_params wsp
                               WHERE wsp.market_id = om.id
                                 AND wsp.target_player_id = pcm.player_id)
                    OR EXISTS (SELECT 1 FROM market_outcomes mo
                               WHERE mo.market_id = om.id
                                 AND mo.player_id = pcm.player_id)
                    OR EXISTS (SELECT 1 FROM market_guarantees mg
                               WHERE mg.market_id = om.id
                                 AND mg.player_id = pcm.player_id)
                    OR EXISTS (SELECT 1 FROM arena_settlements ars
                               WHERE ars.market_id = om.id
                                 AND ars.player_id = pcm.player_id)
                )
          )
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
