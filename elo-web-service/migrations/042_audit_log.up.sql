-- Audit log of user actions (ADR-14). Append-only: rows are never updated or
-- deleted. entity_id has no foreign key on purpose — the referenced entity may
-- be deleted while its audit history must survive; the entity name at the time
-- of the event is captured in the details document.
--
-- details_* columns follow the versioned-JSON convention of ADR-09: every
-- details document carries its kind, schema version, and a payload validated
-- against the schema registered in pkg/audit for that kind. All three columns
-- are NULL together (e.g. match "created" events carry no details).
CREATE TABLE audit_log (
    id UUID PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_user_id UUID NOT NULL REFERENCES users(id),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('match', 'game', 'player', 'club')),
    entity_id UUID NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'renamed', 'deleted')),
    details_kind TEXT NULL CHECK (details_kind IN ('entity', 'rename', 'match-update')),
    details_schema_version INT NULL,
    details JSONB NULL,
    CHECK (
        (
            details_kind IS NULL
            AND details_schema_version IS NULL
            AND details IS NULL
        )
        OR (
            details_kind IS NOT NULL
            AND details_schema_version IS NOT NULL
            AND details IS NOT NULL
        )
    )
);

-- Per-entity history (match view page): events for one entity, latest first.
CREATE INDEX audit_log_entity_idx
    ON audit_log (entity_type, entity_id, created_at DESC, id DESC);

-- Per-type feed (admin page audit tabs): all events of one entity type.
CREATE INDEX audit_log_type_idx
    ON audit_log (entity_type, created_at DESC, id DESC);
