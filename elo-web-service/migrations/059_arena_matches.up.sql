-- The two arena link tables merge into one (ADR-28 amendment): camp_matches
-- (ADR-27) and tournament_matches (ADR-26) both answer the same membership
-- question for a link-only arena — "is this match in this arena" — with the
-- anchor entity as the only difference. From here on a single arena_matches
-- table (anchored at the arena) serves both flavors, and the membership
-- function probes it with one EXISTS.
--
-- The copy is lossless: camp rows move verbatim; tournament rows map to
-- their auto-created arena through arenas.tournament_id (acceptance writes
-- membership only for running tournaments, and every started tournament has
-- its arena — a deleted tournament cascades both the arena and its rows).
-- The function's result is unchanged for every arena, so nothing is
-- stale-marked.

CREATE TABLE arena_matches (
    arena_id UUID NOT NULL REFERENCES arenas(id) ON DELETE CASCADE,
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    PRIMARY KEY (arena_id, match_id)
);

CREATE INDEX arena_matches_match_idx ON arena_matches (match_id);

INSERT INTO arena_matches (arena_id, match_id)
SELECT arena_id, match_id FROM camp_matches;

INSERT INTO arena_matches (arena_id, match_id)
SELECT a.id, tm.match_id
FROM tournament_matches tm
JOIN arenas a ON a.tournament_id = tm.tournament_id
ON CONFLICT DO NOTHING;

DROP TABLE camp_matches;
DROP TABLE tournament_matches;

-- The membership function loses the camp/tournament link split: both flavors
-- are link-only arenas (camp or tournament-anchored) probing arena_matches;
-- every other arena keeps its filter logic.
DROP FUNCTION arena_contains_match(boolean, boolean, boolean, boolean, boolean,
                                  timestamptz, uuid, timestamptz, timestamptz,
                                  uuid[], uuid[]);

CREATE OR REPLACE FUNCTION arena_contains_match(
    p_link_only        boolean,
    p_link             boolean,
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
        WHEN p_link_only THEN p_link
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
