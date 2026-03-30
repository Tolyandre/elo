-- Migration 022: Decouple market resolution outcome from status; generalize bets.outcome to free-text.
--
-- Before: markets.status encodes the outcome ('resolved_yes', 'resolved_no')
--         bets.outcome is constrained to CHECK ('yes', 'no')
-- After:  markets.status is ('open', 'resolved', 'cancelled')
--         markets.resolution_outcome stores the winning outcome label (free-text, nullable)
--         bets.outcome is plain TEXT — allows any outcome label (e.g. 'player_42')
--
-- Note: the status CHECK constraint was created in migration 017 when the table was named
-- 'outcome_markets', so Postgres auto-named it 'outcome_markets_status_check'.
-- The table was renamed to 'markets' in migration 021 but constraint names were not updated.
-- Similarly, bets.outcome CHECK is named 'outcome_bets_outcome_check'.

-- Step 1: Add resolution_outcome column (nullable — null while open or cancelled)
ALTER TABLE markets ADD COLUMN resolution_outcome TEXT NULL;

-- Step 2: Backfill resolution_outcome from the current status
UPDATE markets
SET resolution_outcome = CASE
    WHEN status = 'resolved_yes' THEN 'yes'
    WHEN status = 'resolved_no'  THEN 'no'
    ELSE NULL
END;

-- Step 3: Drop the old 4-value constraint BEFORE updating rows, so the UPDATE is not blocked
ALTER TABLE markets DROP CONSTRAINT outcome_markets_status_check;

-- Step 4: Collapse existing resolved_yes / resolved_no rows into 'resolved'
UPDATE markets SET status = 'resolved'
WHERE status IN ('resolved_yes', 'resolved_no');

-- Step 5: Add the new 3-value constraint
ALTER TABLE markets
    ADD CONSTRAINT markets_status_check CHECK (status IN ('open', 'resolved', 'cancelled'));

-- Step 6: Widen bets.outcome — drop the binary CHECK, keep as plain TEXT
ALTER TABLE bets DROP CONSTRAINT IF EXISTS outcome_bets_outcome_check;
