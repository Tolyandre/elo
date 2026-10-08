-- Club queries (ADR-05 grouping + ADR-36 membership stints).
-- player_club_membership is stint history: joined_at / left_at, left_at NULL
-- = active stint. Reads of "the members" always filter to active stints.
-- Tenant fields (openness, main arena) live on the tenants table (tenants.sql).

-- name: ListClubs :many
SELECT
    c.id AS club_id,
    c.name AS club_name,
    c.geologist_name AS club_geologist_name,
    c.icon AS club_icon,
    c.tenant_id AS club_tenant_id,
    pcm.player_id AS player_id
FROM clubs c
LEFT JOIN player_club_membership pcm ON pcm.club_id = c.id AND pcm.left_at IS NULL;

-- name: GetClub :many
SELECT
    c.id AS club_id,
    c.name AS club_name,
    c.geologist_name AS club_geologist_name,
    c.icon AS club_icon,
    c.tenant_id AS club_tenant_id,
    pcm.player_id AS player_id
FROM clubs c
LEFT JOIN player_club_membership pcm ON pcm.club_id = c.id AND pcm.left_at IS NULL
WHERE c.id = $1;

-- name: CreateClub :one
-- A new club is a plain group (ADR-36): no tenant.
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

-- name: ListClubMembershipHistory :many
-- The club's membership stint history (ADR-36), latest stint first: the raw
-- material of tenant membership, shown as audit-style items on the admin club
-- page. A NULL left_at is the current active stint.
SELECT pcm.club_id, pcm.player_id, p.name AS player_name,
       pcm.joined_at, pcm.left_at
FROM player_club_membership pcm
JOIN players p ON p.id = pcm.player_id
WHERE pcm.club_id = $1
ORDER BY pcm.joined_at DESC, pcm.player_id;
