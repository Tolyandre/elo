-- The membership function is a PURE expression (revises 054). Two measured
-- facts drove this shape (228 arenas × 1431 matches, 2026-09 prod copy):
--
-- 1. A function body containing any sub-SELECT is never inlined, and an
--    opaque call re-executes its subplans per (arena, match) pair: the
--    arenas list measured 24s (id args) then 3.3s (column args) against
--    350ms for the inline predicate.
-- 2. A body that is a pure expression inlines completely — even when an
--    ARGUMENT contains an EXISTS — and the planner then optimizes the whole
--    membership condition as if it were written inline (hashed subplans,
--    once per query).
--
-- So the function owns the STRUCTURE of the rule, and callers pass the two
-- probes it cannot express without sub-SELECTs — each a one-line EXISTS in
-- the caller, where the planner hashes it optimally:
--
--   p_camp_link         EXISTS (SELECT 1 FROM camp_matches cm
--                               WHERE cm.arena_id = a.id AND cm.match_id = m.id)
--   p_has_filtered_tag  EXISTS (SELECT 1 FROM game_tag gt
--                               WHERE gt.game_id = m.game_id
--                                 AND gt.tag_id = ANY(f.tag_ids))
--
-- The p_camp flag keeps the two kinds mutually exclusive (a camp arena is
-- linked-match-only even though its filter columns are NULL — NULL filters
-- would otherwise match everything).
--
-- Call sites: pkg/db/query/arenas.sql; see
-- adr/28-arena-membership-function.md. Never inline the rule back, and never
-- bury a sub-SELECT in this body — inlining is the whole point.
DROP FUNCTION arena_contains_match(p_arena_id uuid, p_match_id uuid);

CREATE OR REPLACE FUNCTION arena_contains_match(
    p_camp             boolean,
    p_camp_link        boolean,
    p_has_filtered_tag boolean,
    p_match_date       timestamptz,
    p_match_game_id    uuid,
    p_filter_date_from timestamptz,
    p_filter_date_to   timestamptz,
    p_filter_game_ids  uuid[],
    p_filter_tag_ids   uuid[]
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_camp THEN p_camp_link
        ELSE
            (p_filter_date_from IS NULL OR p_match_date >= p_filter_date_from)
            AND (p_filter_date_to IS NULL OR p_match_date <= p_filter_date_to)
            AND (
                (coalesce(cardinality(p_filter_game_ids), 0) = 0 AND coalesce(cardinality(p_filter_tag_ids), 0) = 0)
                OR p_filter_game_ids @> ARRAY[p_match_game_id]
                OR p_has_filtered_tag
            )
    END
$$;
