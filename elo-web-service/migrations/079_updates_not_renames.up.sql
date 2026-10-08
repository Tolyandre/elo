-- The rename action retires: a rename is just a field change, so every
-- entity reports it as `updated` with a field-level diff (game-update /
-- player-update / tag-update, or the name field of club-update /
-- tenant-update). Historical renamed rows are dropped outright — the diff
-- kinds carry strictly more information going forward, and keeping the
-- legacy action around would mean supporting two shapes forever.
DELETE FROM audit_log WHERE action = 'renamed';

ALTER TABLE audit_log DROP CONSTRAINT audit_log_action_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_action_check
    CHECK (action IN ('created', 'updated', 'deleted'));

ALTER TABLE audit_log DROP CONSTRAINT audit_log_details_kind_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_details_kind_check
    CHECK (details_kind IN ('entity', 'match-update', 'arena-camp-config', 'camp-link',
                            'tournament-config', 'tournament-start', 'tournament-state',
                            'slot-ruling', 'slot-link', 'slot-adjust', 'tenant-update', 'user-update',
                            'club-update', 'game-update', 'player-update', 'tag-update'));
