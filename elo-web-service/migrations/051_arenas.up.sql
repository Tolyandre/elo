-- Arena rework (ADR-24): one arena entity with configurable settings and a
-- match filter, replacing the two hard-coded arena types (global arena and
-- per-game arenas from ADR-02).
--
-- Arena ids are an independent keyspace (never derived from games/tournaments
-- ids — those carry the legacy int-era pattern of ADR-07). The global arena is
-- pinned by the well-known constant below; auto-managed per-game and
-- per-tournament arenas mint fresh UUIDs and point at their entity through the
-- anchor columns (game_id / tournament_id). The match filter row carries the
-- matching semantics.

-- Reusable match filter: a match meets the filter iff it satisfies all present
-- conditions; NULL means the condition is absent. game_ids / tag_ids are
-- OR'd (game listed OR game carries a listed tag); both empty → any game.
CREATE TABLE match_filters (
    id            UUID PRIMARY KEY,
    date_from     TIMESTAMPTZ NULL,
    date_to       TIMESTAMPTZ NULL,
    game_ids      UUID[] NULL,
    tag_ids       UUID[] NULL,
    tournament_id UUID NULL REFERENCES tournaments(id) ON DELETE CASCADE
);

CREATE TABLE arenas (
    id                      UUID PRIMARY KEY,
    name                    TEXT        NOT NULL,
    match_filter_id         UUID        NOT NULL REFERENCES match_filters(id) ON DELETE CASCADE,
    settings                JSONB       NOT NULL,
    settings_schema_version INT         NOT NULL DEFAULT 1,
    -- Anchor columns mark auto-managed arenas (one per game / per tournament):
    -- lifecycle (ON DELETE CASCADE), name sync and direct lookups. NULL for
    -- user-created arenas.
    game_id                 UUID        NULL REFERENCES games(id) ON DELETE CASCADE,
    tournament_id           UUID        NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    -- Dirty queue: stale_at IS NOT NULL → arena needs recalculation;
    -- recalc_from is the minimum replay date, NULL = full recalc.
    recalc_from             TIMESTAMPTZ NULL,
    stale_at                TIMESTAMPTZ NULL,
    CONSTRAINT arenas_stale_recalc_agree CHECK (
        recalc_from IS NULL OR stale_at IS NOT NULL
    )
);

CREATE INDEX arenas_game_id_idx      ON arenas (game_id);
CREATE INDEX arenas_tournament_id_idx ON arenas (tournament_id);
CREATE INDEX arenas_stale_at_idx     ON arenas (stale_at) WHERE stale_at IS NOT NULL;

-- Unified settlement ledger (ADR-21 checkpoints) for every arena. Markets and
-- corrections write only to the global arena (discriminators 'market',
-- 'market_guarantor', 'correction'); other arenas only ever carry 'match'.
CREATE TABLE arena_settlements (
    id            UUID                     NOT NULL PRIMARY KEY,
    arena_id      UUID                     NOT NULL REFERENCES arenas(id) ON DELETE CASCADE,
    player_id     UUID                     NOT NULL REFERENCES players(id),
    date          TIMESTAMP WITH TIME ZONE NOT NULL,
    rating_after  FLOAT                    NOT NULL,
    elo_after     FLOAT                    NOT NULL,
    discriminator TEXT                     NOT NULL CHECK (discriminator IN ('match', 'market', 'market_guarantor', 'correction')),
    match_id      UUID                     NULL REFERENCES matches(id),
    market_id     UUID                     NULL REFERENCES markets(id),
    correction_id UUID                     NULL REFERENCES corrections(id),
    elo_staked    FLOAT                    NOT NULL,
    elo_earned    FLOAT                    NOT NULL,
    rating_staked FLOAT                    NOT NULL,
    rating_earned FLOAT                    NOT NULL,
    -- NULL when the arena has no leagues (settings leagues = []).
    league        TEXT                     NULL
                      CHECK (league IN ('newbie', 'amateur', 'elite'))
);

CREATE UNIQUE INDEX arena_settlements_match_unique
    ON arena_settlements (arena_id, match_id, player_id)
    WHERE match_id IS NOT NULL;

CREATE UNIQUE INDEX arena_settlements_market_unique
    ON arena_settlements (arena_id, market_id, player_id, discriminator)
    WHERE market_id IS NOT NULL;

CREATE UNIQUE INDEX arena_settlements_correction_unique
    ON arena_settlements (arena_id, correction_id, player_id)
    WHERE correction_id IS NOT NULL;

-- Latest-state reads (per player) and replay scans.
CREATE INDEX arena_settlements_player_read_idx
    ON arena_settlements (arena_id, player_id, date DESC, id DESC);
CREATE INDEX arena_settlements_replay_idx
    ON arena_settlements (arena_id, date, id);

-- Precalculated per-player medal statistics (places by RANK per match),
-- recomputed at the end of every arena recalculation.
CREATE TABLE arena_player_stats (
    arena_id      UUID NOT NULL REFERENCES arenas(id) ON DELETE CASCADE,
    player_id     UUID NOT NULL REFERENCES players(id),
    matches_count INT  NOT NULL,
    first_count   INT  NOT NULL,
    second_count  INT  NOT NULL,
    third_count   INT  NOT NULL,
    fourth_count  INT  NOT NULL,
    PRIMARY KEY (arena_id, player_id)
);

-- ---------------------------------------------------------------------------
-- Seeding: global arena + one arena per game + one per existing tournament.
-- Settings are copied from the latest elo_settings row so behavior is
-- preserved; from now on the settings document is the single source for
-- league parameters (elo_settings league columns become dead configuration).
-- ---------------------------------------------------------------------------

-- Well-known ids (see ADR-24 and pkg/elo/arena.go):
--   global arena       a2ea0000-0000-0000-0000-000000000001
--   global arena filter a2ea0000-0000-0000-0000-000000000002
INSERT INTO match_filters (id) VALUES ('a2ea0000-0000-0000-0000-000000000002');

WITH s AS (SELECT * FROM elo_settings ORDER BY effective_date DESC LIMIT 1)
INSERT INTO arenas (id, name, match_filter_id, settings, game_id, tournament_id)
SELECT
    'a2ea0000-0000-0000-0000-000000000001',
    'Общая арена',
    'a2ea0000-0000-0000-0000-000000000002',
    jsonb_build_object(
        'starting_rating', s.starting_rating_global_arena,
        'leagues', jsonb_build_array(
            jsonb_build_object(
                'kind', 'newbie',
                'goal_gap', s.newbie_league_goal_gap,
                'earned_min', s.newbie_league_earned_min,
                'earned_max', s.newbie_league_earned_max,
                'tau', s.newbie_league_earned_tau
            ),
            jsonb_build_object('kind', 'amateur'),
            jsonb_build_object(
                'kind', 'elite',
                'matches_6m', s.elite_league_matches_6months,
                'matches_2m', s.elite_league_matches_2months
            )
        )
    ),
    NULL, NULL
FROM s;

-- One arena per game: newbie + amateur leagues, game starting rating.
INSERT INTO match_filters (id, game_ids)
SELECT gen_random_uuid(), ARRAY[g.id]
FROM games g;

WITH s AS (SELECT * FROM elo_settings ORDER BY effective_date DESC LIMIT 1)
INSERT INTO arenas (id, name, match_filter_id, settings, game_id)
SELECT
    gen_random_uuid(),
    'Арена: ' || g.name,
    f.id,
    jsonb_build_object(
        'starting_rating', s.starting_rating_game_arena,
        'leagues', jsonb_build_array(
            jsonb_build_object(
                'kind', 'newbie',
                'goal_gap', s.newbie_league_goal_gap,
                'earned_min', s.newbie_league_earned_min,
                'earned_max', s.newbie_league_earned_max,
                'tau', s.newbie_league_earned_tau
            ),
            jsonb_build_object('kind', 'amateur')
        )
    ),
    g.id
FROM games g
JOIN match_filters f ON f.game_ids = ARRAY[g.id]
CROSS JOIN s;

-- One arena per existing tournament: no leagues (rating ≡ elo), starts stale
-- — the background worker (or POST /admin/update-arenas) fills it after deploy.
INSERT INTO match_filters (id, tournament_id)
SELECT gen_random_uuid(), t.id
FROM tournaments t;

WITH s AS (SELECT * FROM elo_settings ORDER BY effective_date DESC LIMIT 1)
INSERT INTO arenas (id, name, match_filter_id, settings, tournament_id, stale_at)
SELECT
    gen_random_uuid(),
    'Арена: ' || t.name,
    f.id,
    jsonb_build_object(
        'starting_rating', s.starting_elo,
        'leagues', jsonb_build_array()
    ),
    t.id,
    NOW()
FROM tournaments t
JOIN match_filters f ON f.tournament_id = t.id
CROSS JOIN s;

-- ---------------------------------------------------------------------------
-- Settlement row remap: global rows keep their settlement ids (the (date, id)
-- event ordering is preserved); game rows are re-keyed to the new per-game
-- arena ids via the anchor join.
-- ---------------------------------------------------------------------------

INSERT INTO arena_settlements (id, arena_id, player_id, date, rating_after, elo_after,
                               discriminator, match_id, market_id, correction_id,
                               elo_staked, elo_earned, rating_staked, rating_earned, league)
SELECT id, 'a2ea0000-0000-0000-0000-000000000001', player_id, date, rating_after, elo_after,
       discriminator, match_id, market_id, correction_id,
       elo_staked, elo_earned, rating_staked, rating_earned, league
FROM global_arena_settlement;

INSERT INTO arena_settlements (id, arena_id, player_id, date, rating_after, elo_after,
                               discriminator, match_id, market_id, correction_id,
                               elo_staked, elo_earned, rating_staked, rating_earned, league)
SELECT gas.id, a.id, gas.player_id, gas.date, gas.rating_after, gas.elo_after,
       gas.discriminator, gas.match_id, NULL, NULL,
       gas.elo_staked, gas.elo_earned, gas.rating_staked, gas.rating_earned, gas.league
FROM game_arena_settlement gas
JOIN arenas a ON a.game_id = gas.game_id;

-- Backfill precalculated stats for global + per-game arenas (tournament arenas
-- stay stale; their updater recomputes stats together with settlements).
INSERT INTO arena_player_stats (arena_id, player_id, matches_count,
                                first_count, second_count, third_count, fourth_count)
SELECT
    'a2ea0000-0000-0000-0000-000000000001',
    r.player_id,
    COUNT(*),
    COUNT(*) FILTER (WHERE r.place = 1),
    COUNT(*) FILTER (WHERE r.place = 2),
    COUNT(*) FILTER (WHERE r.place = 3),
    COUNT(*) FILTER (WHERE r.place = 4)
FROM (
    SELECT ms.player_id,
           RANK() OVER (PARTITION BY ms.match_id ORDER BY ms.score DESC) AS place
    FROM match_scores ms
) r
GROUP BY r.player_id;

INSERT INTO arena_player_stats (arena_id, player_id, matches_count,
                                first_count, second_count, third_count, fourth_count)
SELECT
    a.id,
    r.player_id,
    COUNT(*),
    COUNT(*) FILTER (WHERE r.place = 1),
    COUNT(*) FILTER (WHERE r.place = 2),
    COUNT(*) FILTER (WHERE r.place = 3),
    COUNT(*) FILTER (WHERE r.place = 4)
FROM arenas a
JOIN (
    SELECT m.game_id, ms.player_id,
           RANK() OVER (PARTITION BY ms.match_id ORDER BY ms.score DESC) AS place
    FROM matches m
    JOIN match_scores ms ON ms.match_id = m.id
) r ON r.game_id = a.game_id
WHERE a.game_id IS NOT NULL
GROUP BY a.id, r.player_id;

-- The unified table replaces both hard-coded arena ledgers.
DROP TABLE game_arena_settlement;
DROP TABLE global_arena_settlement;
