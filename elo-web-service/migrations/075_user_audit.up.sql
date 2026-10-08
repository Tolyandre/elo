-- Audit for user administration: the /admin/users page's only write is
-- granting/revoking the edit permission (PATCH /users/{id}). Extends the
-- CHECKs the baseline (061) introduced; keep in sync with pkg/audit/registry.go.
ALTER TABLE audit_log DROP CONSTRAINT audit_log_entity_type_check;

ALTER TABLE audit_log ADD CONSTRAINT audit_log_entity_type_check
    CHECK (entity_type IN ('match', 'game', 'player', 'club', 'tag', 'arena', 'tournament', 'tenant', 'user'));

ALTER TABLE audit_log DROP CONSTRAINT audit_log_details_kind_check;

ALTER TABLE audit_log ADD CONSTRAINT audit_log_details_kind_check
    CHECK (details_kind IN ('entity', 'rename', 'match-update', 'arena-camp-config', 'camp-link',
                            'tournament-config', 'tournament-start', 'tournament-state',
                            'slot-ruling', 'slot-link', 'slot-adjust', 'tenant-update', 'user-update'));
