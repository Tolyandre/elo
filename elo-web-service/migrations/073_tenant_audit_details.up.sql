-- The tenant-update audit details kind (ADR-36 phase 6): structured
-- settings-change diffs in the match-update style. Extends the CHECK the
-- baseline (061) introduced; keep in sync with pkg/audit/registry.go.
ALTER TABLE audit_log DROP CONSTRAINT audit_log_details_kind_check;

ALTER TABLE audit_log ADD CONSTRAINT audit_log_details_kind_check
    CHECK (details_kind IN ('entity', 'rename', 'match-update', 'arena-camp-config', 'camp-link',
                            'tournament-config', 'tournament-start', 'tournament-state',
                            'slot-ruling', 'slot-link', 'slot-adjust', 'tenant-update'));
