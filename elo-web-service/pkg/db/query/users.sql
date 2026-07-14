-- name: ListUsers :many
SELECT
    id,
    allow_editing,
    google_oauth_user_id,
    google_oauth_user_name,
    player_id,
    legacy_int_id
FROM users;

-- name: GetUserByGoogleOAuthUserID :one
SELECT
    id,
    allow_editing,
    google_oauth_user_id,
    google_oauth_user_name,
    player_id,
    legacy_int_id
FROM users
WHERE google_oauth_user_id = $1;

-- name: GetUser :one
SELECT
    id,
    allow_editing,
    google_oauth_user_id,
    google_oauth_user_name,
    player_id,
    legacy_int_id
FROM users
WHERE id = $1;

-- name: GetUserByLegacyIntID :one
-- JWT fallback: resolves a user by the old SERIAL int id (ADR-08). Used when the
-- JWT "sub" claim is a bare int (pre-migration token) that isn't a valid UUID.
SELECT
    id,
    allow_editing,
    google_oauth_user_id,
    google_oauth_user_name,
    player_id,
    legacy_int_id
FROM users
WHERE legacy_int_id = $1;

-- name: CreateUser :one
INSERT INTO users (id, allow_editing, google_oauth_user_id, google_oauth_user_name)
VALUES ($1, $2, $3, $4)
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

-- name: UpdateUserPlayerID :exec
UPDATE users SET player_id = $2 WHERE id = $1;
