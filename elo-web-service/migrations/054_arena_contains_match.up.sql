-- The arena membership rule (ADR-24, ADR-27) as one SQL definition. Until now
-- the "does this match belong to this arena" condition was copy-pasted across
-- eight queries in pkg/db/query/arenas.sql — adding a flavor (camps) meant
-- editing every copy. From here on the queries call this function; see
-- adr/28-arena-membership-function.md.
--
--   A match belongs to a camp arena iff it has a camp_matches link row.
--   Every other kind: the arena's filter covers it — all present conditions
--   hold (NULL = absent):
--     date range:   f.date_from <= m.date <= f.date_to
--     game OR tag:  m.game_id listed in f.game_ids, or m's game carries one of
--                   f.tag_ids; both empty (NULL or []) → any game
--
-- Returns NULL for an unknown arena or match; every caller uses it in WHERE,
-- where NULL filters the row out. LANGUAGE sql STABLE so the planner can
-- inline the body; no SET search_path (a SET clause would block inlining).
CREATE OR REPLACE FUNCTION arena_contains_match(p_arena_id uuid, p_match_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN a.camp THEN
            EXISTS (
                SELECT 1 FROM camp_matches cm
                WHERE cm.arena_id = a.id AND cm.match_id = p_match_id
            )
        ELSE
            (f.date_from IS NULL OR m.date >= f.date_from)
            AND (f.date_to IS NULL OR m.date <= f.date_to)
            AND (
                (coalesce(cardinality(f.game_ids), 0) = 0 AND coalesce(cardinality(f.tag_ids), 0) = 0)
                OR f.game_ids @> ARRAY[m.game_id]
                OR EXISTS (SELECT 1 FROM game_tag gt WHERE gt.game_id = m.game_id AND gt.tag_id = ANY(f.tag_ids))
            )
    END
    FROM arenas a
    LEFT JOIN match_filters f ON f.id = a.match_filter_id
    JOIN matches m ON m.id = p_match_id
    WHERE a.id = p_arena_id
$$;
