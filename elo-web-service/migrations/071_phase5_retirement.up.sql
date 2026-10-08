-- ADR-36 phase 5: the global-arena retirement. Corrections are removed
-- entirely (a one-off proof of concept; the same insight is recoverable from a
-- rating replay), and bet limits stop being a stored column — they are derived
-- at read time from the market's tenant main arena.

-- Correction settlements existed only in the global arena («Синие люди»'s main
-- arena since 068). Deleting them rewrites that arena's rating chains, so the
-- row is marked stale below; the startup step replays it in full (the
-- background worker never drains the global arena).
DELETE FROM arena_settlements WHERE discriminator = 'correction';

ALTER TABLE arena_settlements DROP CONSTRAINT arena_settlements_correction_id_fkey;
DROP INDEX arena_settlements_correction_unique;
ALTER TABLE arena_settlements DROP COLUMN correction_id;

ALTER TABLE arena_settlements DROP CONSTRAINT arena_settlements_discriminator_check;
ALTER TABLE arena_settlements ADD CONSTRAINT arena_settlements_discriminator_check
    CHECK (discriminator IN ('match', 'market', 'market_guarantor'));

DROP TABLE corrections;

ALTER TABLE players DROP COLUMN bet_limit;

UPDATE arenas SET stale_at = NOW()
WHERE id = 'a2ea0000-0000-0000-0000-000000000001';
