-- name: ListTags :many
SELECT
    t.id,
    t.name,
    COUNT(gt.game_id) AS game_count
FROM tags t
LEFT JOIN game_tag gt ON gt.tag_id = t.id
GROUP BY t.id, t.name
ORDER BY t.name;

-- name: GetTagByID :one
SELECT * FROM tags WHERE id = $1;

-- name: CreateTag :one
INSERT INTO tags (id, name)
VALUES ($1, $2)
ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
RETURNING *;

-- name: UpdateTagName :one
UPDATE tags
SET name = $2
WHERE id = $1
RETURNING *;

-- name: GetTagGameCount :one
SELECT COUNT(*) FROM game_tag WHERE tag_id = $1;

-- name: DeleteTag :one
DELETE FROM tags
WHERE id = $1
RETURNING *;

-- name: AddGameTag :exec
INSERT INTO game_tag (game_id, tag_id)
VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: RemoveGameTag :exec
DELETE FROM game_tag
WHERE game_id = $1 AND tag_id = $2;

-- name: ListGameTags :many
SELECT
    gt.game_id,
    t.id AS tag_id,
    t.name AS tag_name
FROM game_tag gt
JOIN tags t ON t.id = gt.tag_id
ORDER BY t.name;
