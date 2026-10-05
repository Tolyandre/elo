-- Tournament slots (ADR-26, amended by ADR-27): the advancement terminology
-- replaces "promote", and slots gain an organizer-set minimal score a player
-- must reach before the slot may complete.
--
-- "promote" reads as HR-speak; the tournament word is "advance" — the column
-- holds how many players advance from the slot to the next round. The recorded
-- outcome table follows (it stores which players advanced, in place order).
ALTER TABLE tournament_slots RENAME COLUMN promote TO advance;
ALTER TABLE tournament_slot_promotions RENAME TO tournament_slot_advances;

-- The minimal score gate (ADR-27): with the default 0 the slot completes on
-- the strict standings cut alone (the previous behavior); with a value m > 0
-- the leader must additionally hold at least m slot points before the cut
-- counts. Slot points are the Elo earn part rounded to one decimal, so m
-- speaks whole matches for 2-seat tables (a win earns 1.0). The organizer sets
-- it per slot while the slot has no linked matches; the range matches the
-- score scale's useful ceiling.
ALTER TABLE tournament_slots
    ADD COLUMN min_score FLOAT NOT NULL DEFAULT 0
    CHECK (min_score >= 0 AND min_score <= 10);
