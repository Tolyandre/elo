-- Audit for club icon and membership changes (ADR-36): they decide who sees
-- community feeds and feeds' membership, so they belong in the log next to
-- the tenant composition changes they feed. Extends the CHECK the baseline
-- (061) introduced; keep in sync with pkg/audit/registry.go.
ALTER TABLE audit_log DROP CONSTRAINT audit_log_details_kind_check;

ALTER TABLE audit_log ADD CONSTRAINT audit_log_details_kind_check
    CHECK (details_kind IN ('entity', 'rename', 'match-update', 'arena-camp-config', 'camp-link',
                            'tournament-config', 'tournament-start', 'tournament-state',
                            'slot-ruling', 'slot-link', 'slot-adjust', 'tenant-update', 'user-update',
                            'club-update'));
