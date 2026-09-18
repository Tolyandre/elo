-- Bracket tournaments (ADR-26): the tournaments entity is repurposed for real
-- tournaments — a strict participant list, a game pool with table capacities,
-- and a pre-computed elimination bracket materialized into rounds / slots /
-- seats. The lifecycle is registration → running → completed | cancelled.
--
-- Arena membership (ADR-24 anchor + ADR-28): every started tournament auto-
-- creates its arena with the arenas.tournament_id anchor. Membership is the
-- insert-only tournament_matches link — NOT the live slot links — so detached
-- or cascade-voided results leave the bracket but keep counting for the
-- arena's rating and medals ("the arena counts matches that were played at
-- the event"). The link table is created before arena_contains_match is
-- replaced below so sqlc (which compiles queries against this directory) can
-- see it; the function body itself stays table-free (pure expression, 055).

-- 1. The repurposed entity starts clean. Post-053 rows are camp shells
--    (id + name only — 053 kept them "until ADR-26 rebuilds it"); their names
--    become reusable. Defensive detach first: no arena should still reference
--    a tournament after 053, and the anchor FK would otherwise cascade-delete it.
UPDATE arenas SET tournament_id = NULL WHERE tournament_id IS NOT NULL;
DELETE FROM tournaments;

ALTER TABLE tournaments
    ADD COLUMN status               TEXT NOT NULL
                                    CHECK (status IN ('registration','running','completed','cancelled')),
    ADD COLUMN elimination          TEXT NOT NULL
                                    CHECK (elimination IN ('single','double')),
    ADD COLUMN winner_player_id     UUID NULL REFERENCES players(id),
    ADD COLUMN seed                 BIGINT NULL,         -- PRNG seed; reproducible draws
    ADD COLUMN grand_final_deadline TIMESTAMPTZ NULL,    -- optional; auto-cancel
    ADD COLUMN plan                 JSONB NULL,          -- chosen shape, verbatim (set at start)
    ADD COLUMN plan_schema_version  INT  NOT NULL DEFAULT 1,
    ADD COLUMN created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX tournaments_status_idx ON tournaments (status);

-- 2. Participants (registration state). The organizer maintains the set;
--    signed-in users self-register through their linked player.
CREATE TABLE tournament_participants (
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    player_id     UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tournament_id, player_id)
);

CREATE INDEX tournament_participants_player_idx ON tournament_participants (player_id);

-- 3. The game pool with table capacity.
CREATE TABLE tournament_games (
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    game_id       UUID NOT NULL REFERENCES games(id),
    min_players   INT  NOT NULL CHECK (min_players >= 2),
    max_players   INT  NOT NULL CHECK (max_players >= min_players),
    PRIMARY KEY (tournament_id, game_id)
);

-- 4. The bracket materialization. "index" is quoted: legal in Postgres, but
--    the column sits next to track and reads as a keyword.
CREATE TABLE tournament_rounds (
    id            UUID PRIMARY KEY,
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    track         TEXT NOT NULL CHECK (track IN ('winners','losers','final')),
    "index"       INT  NOT NULL,           -- 1-based within the track
    UNIQUE (tournament_id, track, "index")
);

CREATE INDEX tournament_rounds_tournament_idx ON tournament_rounds (tournament_id);

CREATE TABLE tournament_slots (            -- one table + its match series
    id        UUID PRIMARY KEY,
    round_id  UUID NOT NULL REFERENCES tournament_rounds(id) ON DELETE CASCADE,
    position  INT  NOT NULL,               -- table number within the round
    game_id   UUID NOT NULL REFERENCES games(id),
    promote   INT  NOT NULL CHECK (promote >= 1),   -- uniform per round; < seat count
    status    TEXT NOT NULL CHECK (status IN ('waiting','playing','completed')),
    ruling    JSONB NULL,                  -- organizer-ordered promotion set (ADR-26);
                                           -- replaced by a strict standings cut
    UNIQUE (round_id, position)
);

CREATE TABLE tournament_seats (            -- who sits at a slot's table
    id             UUID PRIMARY KEY,
    slot_id        UUID NOT NULL REFERENCES tournament_slots(id) ON DELETE CASCADE,
    position       INT  NOT NULL,
    player_id      UUID NULL,              -- direct seed (round 1 / byes) …
    source_slot_id UUID NULL REFERENCES tournament_slots(id),
    source_place   INT  NULL,              -- … or "place i of that slot" (1-based)
    UNIQUE (slot_id, position),
    -- player_id doubles as the cache filled when the source completes, so a
    -- resolved source seat carries provenance AND player: the real invariant
    -- is that a seat never has neither.
    CHECK (player_id IS NOT NULL OR source_slot_id IS NOT NULL)
);

CREATE INDEX tournament_seats_source_idx ON tournament_seats (source_slot_id);

CREATE TABLE tournament_slot_matches (     -- matches counted for a slot
    slot_id   UUID NOT NULL REFERENCES tournament_slots(id) ON DELETE CASCADE,
    match_id  UUID NOT NULL REFERENCES matches(id),
    PRIMARY KEY (slot_id, match_id)
);

CREATE INDEX tournament_slot_matches_match_idx ON tournament_slot_matches (match_id);

CREATE TABLE tournament_slot_promotions (  -- recorded at slot completion
    slot_id   UUID NOT NULL REFERENCES tournament_slots(id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES players(id),
    place     INT  NOT NULL CHECK (place >= 1),      -- 1..promote; drives downstream seats
    PRIMARY KEY (slot_id, player_id),
    UNIQUE (slot_id, place)
);

-- 5. The arena-membership link: written when a match is accepted (or attached
--    by the organizer) and never deleted — detach and cascade-void remove slot
--    links only.
CREATE TABLE tournament_matches (
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    match_id      UUID NOT NULL REFERENCES matches(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tournament_id, match_id)
);

CREATE INDEX tournament_matches_match_idx ON tournament_matches (match_id);

-- 5b. Tournament arenas are the third arena kind (ADR-26): non-camp, no
--     filter — membership is the tournament_matches link. 053's rule
--     (camp = no filter) widens accordingly: camps are link-only with no
--     anchor, filter arenas keep their filter, tournament arenas are
--     link-only with the anchor.
ALTER TABLE arenas DROP CONSTRAINT IF EXISTS arenas_camp_filter_agree;
ALTER TABLE arenas ADD CONSTRAINT arenas_camp_filter_agree
    CHECK (
        (camp AND match_filter_id IS NULL AND tournament_id IS NULL)
        OR (NOT camp AND match_filter_id IS NOT NULL AND tournament_id IS NULL)
        OR (NOT camp AND match_filter_id IS NULL AND tournament_id IS NOT NULL)
    );

-- 6. Tournament-domain mutations join the audit log (ADR-14): entity_type
--    gains 'tournament', details_kind gains the five bracket documents, and
--    actor_user_id becomes nullable — the grand-final-deadline auto-cancel is
--    recorded by the system (ADR-26: actor IS NULL, reason "deadline").
ALTER TABLE audit_log ALTER COLUMN actor_user_id DROP NOT NULL;
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_entity_type_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_entity_type_check
    CHECK (entity_type IN ('match', 'game', 'player', 'club', 'tag', 'arena', 'tournament'));
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_details_kind_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_details_kind_check
    CHECK (details_kind IN ('entity', 'rename', 'match-update', 'arena-camp-config', 'camp-link',
                            'tournament-config', 'tournament-start', 'tournament-state',
                            'slot-ruling', 'slot-link', 'slot-adjust'));

-- 7. The membership function gains the tournament flavor (ADR-28). Same shape
--    as 055: a pure expression whose sub-SELECT probes are passed in by the
--    caller — the tournament-link EXISTS lives in the query text, where the
--    planner hashes it once per query. Tournament arenas are link-only: their
--    filter is NULL (like camps), and a NULL filter would otherwise match
--    every match.
DROP FUNCTION arena_contains_match(boolean, boolean, boolean, timestamptz, uuid,
                                   timestamptz, timestamptz, uuid[], uuid[]);

CREATE OR REPLACE FUNCTION arena_contains_match(
    p_camp             boolean,
    p_tournament       boolean,
    p_camp_link        boolean,
    p_tournament_link  boolean,
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
        WHEN p_tournament THEN p_tournament_link
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
