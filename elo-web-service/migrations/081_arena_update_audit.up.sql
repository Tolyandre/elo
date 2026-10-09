-- Audit for user-managed arena updates (ADR-24): a name, filter or settings
-- change re-derives the arena's whole history, so it belongs in the log next
-- to the tenant settings changes that feed the same recalculation. Extends
-- the CHECK migration 079 introduced; keep in sync with
-- pkg/audit/registry.go.
ALTER TABLE audit_log DROP CONSTRAINT audit_log_details_kind_check;

ALTER TABLE audit_log ADD CONSTRAINT audit_log_details_kind_check
    CHECK (details_kind IN ('entity', 'match-update', 'arena-camp-config', 'camp-link',
                            'tournament-config', 'tournament-start', 'tournament-state',
                            'slot-ruling', 'slot-link', 'slot-adjust', 'tenant-update', 'user-update',
                            'club-update', 'game-update', 'player-update', 'tag-update',
                            'arena-update'));
