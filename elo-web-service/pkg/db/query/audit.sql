-- name: InsertAuditEvent :exec
-- Appends one audit_log row. Called inside the same transaction as the write
-- it describes (ADR-14). details_* are all NULL together for events without
-- details (e.g. match "created").
INSERT INTO audit_log (id, actor_user_id, entity_type, entity_id, action, details_kind, details_schema_version, details)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8);

-- name: ListAuditEvents :many
-- Latest-first audit feed. Optional entity_type / entity_id filters serve both
-- the per-entity history (match view) and the per-type feed (admin tabs). The
-- cursor is the (created_at, id) row of the last returned event.
SELECT
    a.id,
    a.created_at,
    a.actor_user_id,
    u.google_oauth_user_name AS actor_name,
    a.entity_type,
    a.entity_id,
    a.action,
    a.details_kind,
    a.details
FROM audit_log a
JOIN users u ON u.id = a.actor_user_id
WHERE (sqlc.narg('entity_type')::text IS NULL OR a.entity_type = sqlc.narg('entity_type')::text)
  AND (sqlc.narg('entity_id')::uuid IS NULL OR a.entity_id = sqlc.narg('entity_id')::uuid)
  AND (
      sqlc.narg('cursor_created_at')::timestamptz IS NULL
      OR sqlc.narg('cursor_id')::uuid IS NULL
      OR (a.created_at, a.id) < (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
  )
ORDER BY a.created_at DESC, a.id DESC
LIMIT sqlc.arg('limit')::int4;
