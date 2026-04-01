-- name: ListClubs :many
SELECT
    c.id AS club_id,
    c.name AS club_name,
    c.geologist_name AS club_geologist_name,
    pcm.player_id AS player_id
FROM clubs c
LEFT JOIN player_club_membership pcm ON pcm.club_id = c.id;

-- name: GetClub :many
SELECT
    c.id AS club_id,
    c.name AS club_name,
    c.geologist_name AS club_geologist_name,
    pcm.player_id AS player_id
FROM clubs c
LEFT JOIN player_club_membership pcm ON pcm.club_id = c.id
WHERE c.id = $1;

-- name: CreateClub :one
INSERT INTO clubs (name)
VALUES ($1)
RETURNING id, name, geologist_name;

-- name: UpdateClubName :one
UPDATE clubs
SET name = $2
WHERE id = $1
RETURNING id, name, geologist_name;

-- name: DeleteClub :one
DELETE FROM clubs
WHERE id = $1
RETURNING id, name, geologist_name;

-- name: AddClubMember :exec
INSERT INTO player_club_membership (club_id, player_id)
VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: RemoveClubMember :exec
DELETE FROM player_club_membership
WHERE club_id = $1 AND player_id = $2;
