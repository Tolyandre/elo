-- The tournament trophy (ADR-26 §UI): a piece of static art from the source
-- pool (nextjs/public/trophies/<trophy>.png, registered in
-- nextjs/lib/trophies.ts and pkg/elo/trophies.go). The organizer picks one
-- while the tournament is still in registration; it is shown next to the
-- winner once the tournament completes and as the tournament's list mark.
--
-- The pool is deliberately small and source-defined (new art = a new file,
-- a registry entry and a redeploy), so the value is a plain token validated
-- in the service, and the UNIQUE constraint makes the assignment exclusive —
-- a trophy assigned to one tournament disappears from every other
-- tournament's picker (the NULL rows stay mutually compatible).
ALTER TABLE tournaments
    ADD COLUMN trophy TEXT;

ALTER TABLE tournaments
    ADD CONSTRAINT tournaments_trophy_unique UNIQUE (trophy);
