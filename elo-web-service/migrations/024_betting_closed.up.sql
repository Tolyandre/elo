-- Migration 024: Add betting_closed market status.
--
-- betting_closed is a USER EVENT (admin locks betting when a board game match starts).
-- betting_closed_at records WHEN the lock occurred; it is never cleared during
-- recalculation (UnsettleMarket preserves it) — only derived settlement fields
-- (resolved_at, resolution_match_id, resolution_outcome, status resolved/cancelled)
-- are reset.
--
-- State machine after this migration:
--   open → betting_closed       (user event: admin locks betting)
--   betting_closed → resolved   (derived: match condition met)
--   betting_closed → cancelled  (derived: time expired)
--   open → resolved             (unchanged)
--   open → cancelled            (unchanged)

-- Drop existing 3-value constraint (named 'markets_status_check' since migration 022).
ALTER TABLE markets DROP CONSTRAINT markets_status_check;

-- Add 4-value constraint.
ALTER TABLE markets
    ADD CONSTRAINT markets_status_check
    CHECK (status IN ('open', 'betting_closed', 'resolved', 'cancelled'));

-- Add betting_closed_at timestamp (NULL when never locked).
ALTER TABLE markets
    ADD COLUMN betting_closed_at TIMESTAMPTZ NULL;

-- Consistency: betting_closed_at must be set whenever status = 'betting_closed'.
ALTER TABLE markets
    ADD CONSTRAINT markets_betting_closed_at_check
    CHECK (status != 'betting_closed' OR betting_closed_at IS NOT NULL);
