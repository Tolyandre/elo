-- name: ListClubs :many
SELECT
    c.id AS club_id,
    c.name AS club_name,
    c.geologist_name AS club_geologist_name,
    c.icon_svg AS club_icon_svg,
    pcm.player_id AS player_id
FROM clubs c
LEFT JOIN player_club_membership pcm ON pcm.club_id = c.id;

-- name: GetClub :many
SELECT
    c.id AS club_id,
    c.name AS club_name,
    c.geologist_name AS club_geologist_name,
    c.icon_svg AS club_icon_svg,
    pcm.player_id AS player_id
FROM clubs c
LEFT JOIN player_club_membership pcm ON pcm.club_id = c.id
WHERE c.id = $1;

-- name: CreateClub :one
INSERT INTO clubs (id, name)
VALUES ($1, $2)
RETURNING id, name, geologist_name, icon_svg;

-- name: UpdateClubName :one
UPDATE clubs
SET name = $2
WHERE id = $1
RETURNING id, name, geologist_name, icon_svg;

-- name: UpdateClubIcon :one
UPDATE clubs
SET icon_svg = $2
WHERE id = $1
RETURNING id, name, geologist_name, icon_svg;

-- name: DeleteClub :one
DELETE FROM clubs
WHERE id = $1
RETURNING id, name, geologist_name, icon_svg;

-- name: AddClubMember :exec
INSERT INTO player_club_membership (club_id, player_id)
VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: RemoveClubMember :exec
DELETE FROM player_club_membership
WHERE club_id = $1 AND player_id = $2;
