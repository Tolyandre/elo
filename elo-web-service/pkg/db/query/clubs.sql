-- name: ListClubs :many
SELECT
    c.id AS club_id,
    c.name AS club_name,
    pcm.player_id AS player_id
FROM clubs c
LEFT JOIN player_club_membership pcm ON pcm.club_id = c.id;
