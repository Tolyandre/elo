-- name: ListUsers :many
SELECT
    id,
    allow_editing,
    google_oauth_user_id,
    google_oauth_user_name
FROM users;

-- name: GetUserByGoogleOAuthUserID :one
SELECT
    id,
    allow_editing,
    google_oauth_user_id,
    google_oauth_user_name
FROM users
WHERE google_oauth_user_id = $1;

-- name: GetUser :one
SELECT
    id,
    allow_editing,
    google_oauth_user_id,
    google_oauth_user_name
FROM users
WHERE id = $1;

-- name: CreateUser :one
INSERT INTO users (allow_editing, google_oauth_user_id, google_oauth_user_name)
VALUES ($1, $2, $3)
RETURNING id;

-- name: UpdateUserName :exec
UPDATE users
SET google_oauth_user_name = $2
WHERE id = $1;

-- name: UpdateUserAllowEditing :exec
UPDATE users
SET allow_editing = $2
WHERE id = $1;

-- name: DeleteUser :exec
DELETE FROM users
WHERE id = $1;