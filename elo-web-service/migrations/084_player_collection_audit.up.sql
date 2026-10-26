-- Audit for the player game collection ("Коллекция игр", migration 083): one
-- player-collection details row per game added to or removed from a shelf.
-- Extends the CHECK migration 081 introduced; keep in sync with
-- pkg/audit/registry.go.
ALTER TABLE audit_log DROP CONSTRAINT audit_log_details_kind_check;

ALTER TABLE audit_log ADD CONSTRAINT audit_log_details_kind_check
    CHECK (details_kind IN ('entity', 'match-update', 'arena-camp-config', 'camp-link',
                            'tournament-config', 'tournament-start', 'tournament-state',
                            'slot-ruling', 'slot-link', 'slot-adjust', 'tenant-update', 'user-update',
                            'club-update', 'game-update', 'player-update', 'tag-update',
                            'arena-update', 'player-collection'));
