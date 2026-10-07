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
