-- Game modes (ADR-33): games are competitive-only, coop/solo-only, or mixed;
-- individual matches snapshot the resolved mode so later game edits never
-- rewrite history.
--
-- coop matches carry one shared game result (score + win/loss) instead of
-- per-player scores; their participants stay in match_scores with score 0.
ALTER TABLE games
    ADD COLUMN game_mode TEXT NOT NULL DEFAULT 'competitive',
    ADD CONSTRAINT games_game_mode_check
        CHECK (game_mode IN ('competitive', 'coop', 'mixed'));

ALTER TABLE matches
    ADD COLUMN mode TEXT NOT NULL DEFAULT 'competitive',
    ADD COLUMN game_score DOUBLE PRECISION,
    ADD COLUMN game_won BOOLEAN,
    ADD CONSTRAINT matches_mode_check CHECK (mode IN ('competitive', 'coop')),
    ADD CONSTRAINT matches_game_result_consistency CHECK (
        (mode = 'competitive' AND game_score IS NULL AND game_won IS NULL)
        OR (mode = 'coop' AND game_score IS NOT NULL AND game_won IS NOT NULL));

-- v2 of the membership function (ADR-28 + ADR-33): a coop match belongs to no
-- arena of any kind — no settlements, no medals, no arena feeds. The home feed
-- includes coop matches through its own include_coop branch, never through
-- this function.
--
-- Signature changed, so CREATE OR REPLACE is not enough: drop the old
-- overload first.
--
-- Call sites: pkg/db/query/arenas.sql. Never inline the rule back, and never
-- bury a sub-SELECT in this body — inlining is the whole point. LANGUAGE sql
-- IMMUTABLE; no SET search_path (a SET clause would block inlining).
DROP FUNCTION arena_contains_match(
    p_link_only        boolean,
    p_link             boolean,
    p_has_filtered_tag boolean,
    p_match_date       timestamptz,
    p_match_game_id    uuid,
    p_filter_date_from timestamptz,
    p_filter_date_to   timestamptz,
    p_filter_game_ids  uuid[],
    p_filter_tag_ids   uuid[]
);

CREATE FUNCTION arena_contains_match(
    p_match_mode       text,
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
        WHEN p_match_mode = 'coop' THEN false
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
