-- Re-applies the statements that were added to 056 after some databases had
-- already run its original version (golang-migrate records only the version
-- number, so editing an applied migration never reaches those databases —
-- they report "no change" forever). Stage ran the original 056 and then
-- failed every tournament start with
--   new row for relation "arenas" violates check constraint
--   "arenas_camp_filter_agree" (SQLSTATE 23514)
-- because none of the three edits below existed there. Fresh databases are
-- unaffected: they run the current 056, and these statements then just swap
-- identical definitions.

-- 1. 056 §5b (added in 4ec3c23): tournament arenas are the third arena kind —
--    non-camp, no filter, with the anchor. 053's rule (camp = no filter)
--    rejects exactly those rows.
ALTER TABLE arenas DROP CONSTRAINT IF EXISTS arenas_camp_filter_agree;
ALTER TABLE arenas ADD CONSTRAINT arenas_camp_filter_agree
    CHECK (
        (camp AND match_filter_id IS NULL AND tournament_id IS NULL)
        OR (NOT camp AND match_filter_id IS NOT NULL AND tournament_id IS NULL)
        OR (NOT camp AND match_filter_id IS NULL AND tournament_id IS NOT NULL)
    );

-- 2. 056 §4 (relaxed in d5395c4): a seat carries at least one of player/source
--    (player_id doubles as the cache filled when the source completes), not
--    exactly one. The inline CHECK is auto-named; the original and current
--    056 both produce the same name, so the drop hits either shape.
ALTER TABLE tournament_seats DROP CONSTRAINT IF EXISTS tournament_seats_check;
ALTER TABLE tournament_seats ADD CONSTRAINT tournament_seats_check
    CHECK (player_id IS NOT NULL OR source_slot_id IS NOT NULL);

-- 3. 056 §6 (extended in ae300ef): details_kind gains 'slot-adjust'.
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_details_kind_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_details_kind_check
    CHECK (details_kind IN ('entity', 'rename', 'match-update', 'arena-camp-config', 'camp-link',
                            'tournament-config', 'tournament-start', 'tournament-state',
                            'slot-ruling', 'slot-link', 'slot-adjust'));
