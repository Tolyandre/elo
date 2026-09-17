-- Camp arenas (ADR-27): camps leave the tournaments entity and become an
-- arena flavor. A camp arena is a named rating space bounded by a date window;
-- membership is the explicit camp_matches link (never a match filter), and its
-- participants are derived from arena_settlements. The tournaments tables lose
-- their camp semantics: tournament_player_membership and match_tournament are
-- dropped, tournaments keeps only (id, name) until ADR-26 rebuilds it for
-- brackets.

-- Camp columns. match_filter_id becomes nullable: camps have no filter
-- (CHECK below); every other arena kind keeps its filter.
ALTER TABLE arenas
    ADD COLUMN camp      BOOLEAN     NOT NULL DEFAULT false,
    ADD COLUMN starts_at TIMESTAMPTZ NULL,
    ADD COLUMN ends_at   TIMESTAMPTZ NULL;

ALTER TABLE arenas ALTER COLUMN match_filter_id DROP NOT NULL;

-- Explicit match ↔ camp arena link. Both sides cascade: deleting the camp
-- arena (or, hypothetically, a match) removes the links; the matches
-- themselves survive as ordinary matches.
CREATE TABLE camp_matches (
    arena_id UUID NOT NULL REFERENCES arenas(id) ON DELETE CASCADE,
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    PRIMARY KEY (arena_id, match_id)
);

CREATE INDEX camp_matches_match_idx ON camp_matches (match_id);

-- 1. Copy the old match_tournament links while the arenas' tournament anchor
--    is still in place (the anchor FK is ON DELETE CASCADE — arenas must be
--    detached before any tournament deletion could take them along).
INSERT INTO camp_matches (arena_id, match_id)
SELECT a.id, mt.match_id
FROM match_tournament mt
JOIN arenas a ON a.tournament_id = mt.tournament_id
ON CONFLICT DO NOTHING;

-- 2. Convert every tournament's auto-created arena (051) into a camp arena:
--    the tournament's date window moves onto the arena, the anchor and the
--    filter row are dropped. The settings are already the camp shape —
--    051 seeded tournament arenas with leagues: [] (rating ≡ elo).
UPDATE arenas a
SET camp            = true,
    starts_at       = t.start_date,
    ends_at         = t.end_date,
    tournament_id   = NULL,
    match_filter_id = NULL
FROM tournaments t
WHERE a.tournament_id = t.id;

-- 3. Delete the now-orphan filter rows. Only tournament-arena filters carry a
--    tournament_id (051), so this deletes exactly the converted arenas' filters.
DELETE FROM match_filters WHERE tournament_id IS NOT NULL;

-- 4. Camp invariants: camps have no filter and both window bounds; every other
--    arena kind has a filter and no window.
ALTER TABLE arenas ADD CONSTRAINT arenas_camp_filter_agree
    CHECK (camp = (match_filter_id IS NULL));
ALTER TABLE arenas ADD CONSTRAINT arenas_camp_dates_required
    CHECK (NOT camp OR (starts_at IS NOT NULL AND ends_at IS NOT NULL));
ALTER TABLE arenas ADD CONSTRAINT arenas_noncamp_no_dates
    CHECK (camp OR (starts_at IS NULL AND ends_at IS NULL));

-- 5. Camp-domain mutations join the audit log (ADR-14, ADR-27): entity_type
--    gains 'arena' ('tag' was already a Go constant but missed the CHECK —
--    drift fixed here), details_kind gains the two camp documents.
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_entity_type_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_entity_type_check
    CHECK (entity_type IN ('match', 'game', 'player', 'club', 'tag', 'arena'));
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_details_kind_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_details_kind_check
    CHECK (details_kind IN ('entity', 'rename', 'match-update', 'arena-camp-config', 'camp-link'));

-- 6. Drop the camp semantics from the tournaments entity.
DROP TABLE tournament_player_membership;
DROP TABLE match_tournament;
ALTER TABLE tournaments DROP COLUMN start_date;
ALTER TABLE tournaments DROP COLUMN end_date;
ALTER TABLE match_filters DROP COLUMN tournament_id;
