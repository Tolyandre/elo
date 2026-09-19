-- Tournament arena membership now follows the slot link (ADR-26, revised):
-- a match that leaves its slot (organizer detach, edit-form unlink, cascade
-- void) also leaves the tournament arena. Until now the membership rows were
-- insert-only by design ("the arena counts matches that were played at the
-- event"), so detachments left orphans behind. Drop them and schedule the
-- affected arenas for a full recalculation.

CREATE TEMP TABLE orphan_tournament_memberships ON COMMIT DROP AS
SELECT DISTINCT tm.tournament_id
FROM tournament_matches tm
WHERE NOT EXISTS (
    SELECT 1 FROM tournament_slot_matches tsm WHERE tsm.match_id = tm.match_id
);

DELETE FROM tournament_matches tm
WHERE NOT EXISTS (
    SELECT 1 FROM tournament_slot_matches tsm WHERE tsm.match_id = tm.match_id
);

UPDATE arenas SET stale_at = NOW(), recalc_from = NULL
WHERE tournament_id IN (SELECT tournament_id FROM orphan_tournament_memberships);
