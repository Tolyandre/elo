-- Squashed schema representing the state after all migrations through 061.
-- New databases run only this file. Existing databases at version 061 —
-- production included — skip it automatically: golang-migrate records only the
-- version number, so their startup migration reports "no change".
--
-- Folds in, on top of the previous squash baseline (041): the audit log
-- (ADR-14), the guarantor-loss liquidity setting, game tables + host client
-- tokens (ADR-16/18), market guarantees (ADR-20), settlement read indexes
-- (ADR-21), game tags, the arena rework (ADR-24), camp arenas (ADR-27), the
-- arena-membership function (ADR-28), bracket tournaments (ADR-26), the
-- arena_matches link merge (ADR-28 amendment) and the tournament_winner
-- market. Intermediate shapes that later migrations replaced or dropped
-- (market_guarantors, global/game_arena_settlement, skull_king_tables,
-- camp_matches, tournament_matches, the tournaments camp columns) never
-- existed for databases built from this file and are not recreated.

-- Ids are client-generated ULIDs stored as UUID (ADR-01 §22, ADR-06): the id
-- columns carry no default and inserts must supply one. The seeded rows below
-- reuse the deterministic int→uuid mapping of the pre-UUID SERIAL ids so
-- environments rebuilt from this baseline keep the same ids as migrated ones.

CREATE TABLE clubs (
    id             UUID PRIMARY KEY,
    name           TEXT NOT NULL,
    geologist_name TEXT NULL,
    icon           TEXT NULL
);

CREATE TABLE games (
    id   UUID PRIMARY KEY,
    name TEXT NOT NULL,
    CONSTRAINT games_name_unique UNIQUE (name)
);

CREATE TABLE players (
    id             UUID PRIMARY KEY,
    name           TEXT NOT NULL,
    geologist_name TEXT  NULL,
    bet_limit      FLOAT NOT NULL DEFAULT 0,
    CONSTRAINT players_name_unique UNIQUE (name)
);

CREATE TABLE player_club_membership (
    club_id   UUID NOT NULL,
    player_id UUID NOT NULL,
    PRIMARY KEY (club_id, player_id),
    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
    FOREIGN KEY (club_id)   REFERENCES clubs(id)
);

CREATE INDEX player_club_membership_player_idx ON player_club_membership (player_id);

CREATE TABLE matches (
    id                        UUID                     PRIMARY KEY,
    date                      TIMESTAMP WITH TIME ZONE NOT NULL,
    game_id                   UUID                     NOT NULL,
    calculator_kind           TEXT NULL,
    calculator_schema_version INT  NULL,
    calculator_data           JSONB NULL,
    FOREIGN KEY (game_id) REFERENCES games(id),
    -- kind ⇔ data ⇔ schema_version must always agree: either all three are set
    -- (calculator-backed match, see ADR-09) or all three are NULL (plain match).
    CONSTRAINT matches_calculator_kind_consistency CHECK (
        (calculator_kind IS NULL AND calculator_data IS NULL AND calculator_schema_version IS NULL)
        OR
        (calculator_kind IS NOT NULL AND calculator_data IS NOT NULL AND calculator_schema_version IS NOT NULL)
    )
);

CREATE INDEX matches_has_calculator_data_idx
    ON matches (id) WHERE calculator_kind IS NOT NULL;

CREATE TABLE users (
    id                     UUID    NOT NULL PRIMARY KEY,
    allow_editing          BOOLEAN NOT NULL,
    google_oauth_user_id   TEXT    NOT NULL UNIQUE,
    google_oauth_user_name TEXT    NOT NULL,
    player_id              UUID    NULL REFERENCES players(id) ON DELETE SET NULL,
    -- Pre-UUID SERIAL id kept for JWT "sub" fallback (ADR-08); NULL for users
    -- created after the ULID switch.
    legacy_int_id          INTEGER NULL,
    CONSTRAINT users_player_id_unique UNIQUE (player_id)
);

CREATE UNIQUE INDEX users_legacy_int_id_idx ON users (legacy_int_id);

CREATE TABLE match_scores (
    match_id  UUID  NOT NULL,
    player_id UUID  NOT NULL,
    score     FLOAT NOT NULL,
    PRIMARY KEY (match_id, player_id),
    FOREIGN KEY (match_id)  REFERENCES matches(id),
    FOREIGN KEY (player_id) REFERENCES players(id)
);

-- Per-player match counts feed the league thresholds (6-month / 2-month
-- windows); the (match_id, player_id) PK only serves match-side lookups.
CREATE INDEX match_scores_player_idx ON match_scores (player_id, match_id);

-- Bracket tournaments (ADR-26): a strict participant list, a game pool with
-- table capacities, and a pre-computed elimination bracket materialized into
-- rounds / slots / seats. Lifecycle: registration → running →
-- completed | cancelled. The camp era's start/end columns are gone (ADR-27);
-- elimination is the chosen plan's family, stamped at start — NULL until then.
CREATE TABLE tournaments (
    id                   UUID PRIMARY KEY,
    name                 TEXT NOT NULL,
    CONSTRAINT tournaments_name_unique UNIQUE (name),
    status               TEXT NOT NULL
                         CHECK (status IN ('registration','running','completed','cancelled')),
    elimination          TEXT NULL
                         CHECK (elimination IN ('single','double')),
    winner_player_id     UUID NULL REFERENCES players(id),
    seed                 BIGINT NULL,         -- PRNG seed; reproducible draws
    grand_final_deadline TIMESTAMPTZ NULL,    -- optional; auto-cancel
    plan                 JSONB NULL,          -- chosen shape, verbatim (set at start)
    plan_schema_version  INT  NOT NULL DEFAULT 1,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX tournaments_status_idx ON tournaments (status);

-- Participants (registration state). The organizer maintains the set;
-- signed-in users self-register through their linked player.
CREATE TABLE tournament_participants (
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    player_id     UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tournament_id, player_id)
);

CREATE INDEX tournament_participants_player_idx ON tournament_participants (player_id);

-- The game pool with table capacity.
CREATE TABLE tournament_games (
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    game_id       UUID NOT NULL REFERENCES games(id),
    min_players   INT  NOT NULL CHECK (min_players >= 2),
    max_players   INT  NOT NULL CHECK (max_players >= min_players),
    PRIMARY KEY (tournament_id, game_id)
);

-- The bracket materialization. "index" is quoted: legal in Postgres, but
-- the column sits next to track and reads as a keyword.
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
    CONSTRAINT tournament_seats_check
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

-- Prediction markets (ADR-11): an n-outcome LMSR AMM per market.

CREATE TABLE markets (
    id                  UUID PRIMARY KEY,
    market_type         TEXT                     NOT NULL CONSTRAINT markets_market_type_check
                                    CHECK (market_type IN ('match_winner', 'win_streak', 'tournament_winner')),
    status              TEXT                     NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open', 'betting_closed', 'resolved', 'cancelled')),
    starts_at           TIMESTAMP WITH TIME ZONE NOT NULL,
    closes_at           TIMESTAMP WITH TIME ZONE NOT NULL,
    created_by          UUID                     NOT NULL REFERENCES users(id),
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    resolved_at         TIMESTAMP WITH TIME ZONE NULL,
    resolution_match_id UUID                     NULL REFERENCES matches(id) ON DELETE SET NULL,
    resolution_outcome  UUID                     NULL,
    betting_closed_at   TIMESTAMPTZ              NULL,
    -- liquidity_b is dynamic (ADR-20): markets are created with b = 0 (no
    -- guarantors) and grow as guarantees arrive.
    liquidity_b         FLOAT                    NOT NULL DEFAULT 0,
    -- The market's own copy of the risk parameter L (ADR-20); derived per
    -- market as L/ln(n) at creation from elo_settings.
    max_guarantor_loss  FLOAT                    NOT NULL DEFAULT 16,
    CONSTRAINT markets_betting_closed_at_check
        CHECK (status != 'betting_closed' OR betting_closed_at IS NOT NULL)
);

-- The match list probes "does any market resolve from this match?" per row;
-- FK constraints do not create indexes on their own.
CREATE INDEX markets_resolution_match_idx
    ON markets (resolution_match_id) WHERE resolution_match_id IS NOT NULL;

CREATE TABLE market_match_winner_params (
    market_id            UUID    NOT NULL PRIMARY KEY REFERENCES markets(id) ON DELETE CASCADE,
    game_ids             UUID[]  NOT NULL DEFAULT '{}',
    target_player_ids    UUID[]  NOT NULL DEFAULT '{}',
    allow_other_players  BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE market_win_streak_params (
    market_id        UUID   NOT NULL PRIMARY KEY REFERENCES markets(id) ON DELETE CASCADE,
    target_player_id UUID   NOT NULL REFERENCES players(id),
    wins_required    INT    NOT NULL,
    max_losses       INT    NULL,
    game_ids         UUID[] NOT NULL DEFAULT '{}'
);

-- One row per outcome (ADR-11). kind: 'player' (player_id set) — this target
-- player is the sole winner; 'other' — tie at first place or a non-target
-- winner (match_winner); 'yes'/'no' — the two fixed outcomes of a win_streak
-- market. q is the LMSR outstanding shares of this outcome (the AMM state
-- vector component); prices are derived from it and sum to 1.
CREATE TABLE market_outcomes (
    id        UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
    market_id UUID  NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    kind      TEXT  NOT NULL CHECK (kind IN ('player', 'other', 'yes', 'no')),
    player_id UUID  NULL REFERENCES players(id),
    q         FLOAT NOT NULL DEFAULT 0 CHECK (q >= 0),
    CONSTRAINT market_outcomes_player_kind_check
        CHECK ((kind = 'player') = (player_id IS NOT NULL))
);

CREATE INDEX market_outcomes_market_idx ON market_outcomes (market_id);
-- At most one 'other'/'yes'/'no' per market; at most one outcome per player.
CREATE UNIQUE INDEX market_outcomes_other_unique ON market_outcomes (market_id) WHERE kind = 'other';
CREATE UNIQUE INDEX market_outcomes_yes_unique   ON market_outcomes (market_id) WHERE kind = 'yes';
CREATE UNIQUE INDEX market_outcomes_no_unique    ON market_outcomes (market_id) WHERE kind = 'no';
CREATE UNIQUE INDEX market_outcomes_player_unique ON market_outcomes (market_id, player_id) WHERE kind = 'player';

ALTER TABLE markets
    ADD CONSTRAINT markets_resolution_outcome_fk
    FOREIGN KEY (resolution_outcome) REFERENCES market_outcomes(id) ON DELETE SET NULL;

-- tournament_winner market type (one "player wins" outcome per tournament
-- participant; resolves when the tournament completes, refunds when it is
-- cancelled — the market has no closes_at deadline of its own).
CREATE TABLE market_tournament_winner_params (
    market_id     UUID NOT NULL PRIMARY KEY REFERENCES markets(id) ON DELETE CASCADE,
    tournament_id UUID NOT NULL REFERENCES tournaments(id)
);

CREATE TABLE bets (
    id        UUID  PRIMARY KEY,
    market_id UUID  NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    player_id UUID  NOT NULL REFERENCES players(id),
    outcome   UUID  NOT NULL CONSTRAINT bets_outcome_market_outcome_fk
                            REFERENCES market_outcomes(id) ON DELETE CASCADE,
    -- Constraint name predates the amount → cost rename and is kept stable.
    cost      FLOAT NOT NULL CONSTRAINT bets_amount_check CHECK (cost > 0),
    placed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    shares    FLOAT NOT NULL DEFAULT 0,
    -- Maker fee charged on each buy (variance-proportional, ADR-20).
    fee       FLOAT NOT NULL DEFAULT 0
);

CREATE INDEX bets_player_market ON bets (player_id, market_id);
CREATE INDEX bets_market_id     ON bets (market_id);

-- Price-history replay reads a market's bets in placement order.
CREATE INDEX bets_market_placed_idx ON bets (market_id, placed_at);

CREATE TABLE elo_settings (
    effective_date               TIMESTAMP WITH TIME ZONE NOT NULL PRIMARY KEY,
    elo_const_k                  FLOAT NOT NULL,
    elo_const_d                  FLOAT NOT NULL,
    starting_elo                 FLOAT NOT NULL,
    win_reward                   FLOAT NOT NULL,
    elite_league_matches_6months INT   NOT NULL DEFAULT 20,
    elite_league_matches_2months INT   NOT NULL DEFAULT 3,
    newbie_league_earned_min     FLOAT NOT NULL DEFAULT 2,
    newbie_league_earned_max     FLOAT NOT NULL DEFAULT 64,
    newbie_league_earned_tau     FLOAT NOT NULL DEFAULT 100,
    newbie_league_goal_gap       FLOAT NOT NULL DEFAULT 16,
    starting_rating_global_arena FLOAT NOT NULL DEFAULT 0,
    starting_rating_game_arena   FLOAT NOT NULL DEFAULT 900,
    -- The user-facing risk parameter (ADR-20): guarantors' worst-case combined
    -- loss L (elo); markets created without explicit guarantees derive
    -- b = L/ln(n) for their n outcomes.
    market_default_max_guarantor_loss FLOAT NOT NULL DEFAULT 16
);

-- Live game tables (ADR-16): generalizes the original Skull King tables,
-- keyed by the game being played. game_id references the well-known games.id
-- constants pinned in code (pkg/elo/game_ids.go): Skull King
-- 00000000-0000-0000-0000-000000000188, It's a Wonderful World
-- 00000000-0000-0000-0000-000000000009. No FK on purpose — the ids are
-- app-level constants and every environment must carry the rows anyway, but
-- tests bootstrap only the games they need.
--
-- version is the optimistic-lock counter for game_state updates: host state
-- patches must carry the version they were based on; the server rejects
-- stale writes instead of silently erasing other players' input.
--
-- host_client_token (ADR-18): per-device hosting claim — the table remembers
-- which device (client token, minted per browser) last claimed hosting.
-- Summaries carry it so the same user's other devices — which see host_user_id
-- unchanged — can still step down to player/viewer mode when hosting is
-- claimed elsewhere. Empty string = legacy table, no enforcement.
CREATE TABLE game_tables (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    host_user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_state           JSONB       NOT NULL,
    connected_player_ids UUID[]      NOT NULL DEFAULT '{}',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at           TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 day',
    game_id              UUID        NOT NULL DEFAULT '00000000-0000-0000-0000-000000000188',
    version              BIGINT      NOT NULL DEFAULT 1,
    host_client_token    TEXT        NOT NULL DEFAULT ''
);

CREATE INDEX game_tables_expires_at_idx ON game_tables (expires_at);

CREATE TABLE corrections (
    id            UUID PRIMARY KEY,
    player_id     UUID NOT NULL REFERENCES players(id),
    discriminator TEXT NOT NULL CHECK (discriminator IN ('correction')),
    diff          FLOAT NOT NULL,
    date          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX corrections_date_idx ON corrections (date);

-- Audit log of user actions (ADR-14). Append-only: rows are never updated or
-- deleted. entity_id has no foreign key on purpose — the referenced entity may
-- be deleted while its audit history must survive; the entity name at the time
-- of the event is captured in the details document.
--
-- details_* columns follow the versioned-JSON convention of ADR-09: every
-- details document carries its kind, schema version, and a payload validated
-- against the schema registered in pkg/audit for that kind. All three columns
-- are NULL together (e.g. match "created" events carry no details). The actor
-- is NULL for system-recorded events (ADR-26: the grand-final-deadline
-- auto-cancel).
CREATE TABLE audit_log (
    id UUID PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_user_id UUID NULL REFERENCES users(id),
    entity_type TEXT NOT NULL CONSTRAINT audit_log_entity_type_check
        CHECK (entity_type IN ('match', 'game', 'player', 'club', 'tag', 'arena', 'tournament')),
    entity_id UUID NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'renamed', 'deleted')),
    details_kind TEXT NULL CONSTRAINT audit_log_details_kind_check
        CHECK (details_kind IN ('entity', 'rename', 'match-update', 'arena-camp-config', 'camp-link',
                                'tournament-config', 'tournament-start', 'tournament-state',
                                'slot-ruling', 'slot-link', 'slot-adjust')),
    details_schema_version INT NULL,
    details JSONB NULL,
    CHECK (
        (
            details_kind IS NULL
            AND details_schema_version IS NULL
            AND details IS NULL
        )
        OR (
            details_kind IS NOT NULL
            AND details_schema_version IS NOT NULL
            AND details IS NOT NULL
        )
    )
);

-- Per-entity history (match view page): events for one entity, latest first.
CREATE INDEX audit_log_entity_idx
    ON audit_log (entity_type, entity_id, created_at DESC, id DESC);

-- Per-type feed (admin page audit tabs): all events of one entity type.
CREATE INDEX audit_log_type_idx
    ON audit_log (entity_type, created_at DESC, id DESC);

-- Game tags: a shared vocabulary of labels attached to games (many-to-many).
CREATE TABLE tags (
    id   UUID PRIMARY KEY,
    name TEXT NOT NULL,
    CONSTRAINT tags_name_unique UNIQUE (name)
);

CREATE TABLE game_tag (
    game_id UUID NOT NULL,
    tag_id  UUID NOT NULL,
    PRIMARY KEY (game_id, tag_id),
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id)  REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX game_tag_tag_idx ON game_tag (tag_id);

-- Reusable match filter: a match meets the filter iff it satisfies all present
-- conditions; NULL means the condition is absent. game_ids / tag_ids are
-- OR'd (game listed OR game carries a listed tag); both empty → any game.
CREATE TABLE match_filters (
    id        UUID PRIMARY KEY,
    date_from TIMESTAMPTZ NULL,
    date_to   TIMESTAMPTZ NULL,
    game_ids  UUID[] NULL,
    tag_ids   UUID[] NULL
);

-- Arena rework (ADR-24): one arena entity with configurable settings and a
-- match filter, replacing the two hard-coded arena types (global arena and
-- per-game arenas from ADR-02).
--
-- Arena ids are an independent keyspace (never derived from games/tournaments
-- ids — those carry the legacy int-era pattern of ADR-07). The global arena is
-- pinned by the well-known constant seeded below; auto-managed per-game and
-- per-tournament arenas mint fresh UUIDs and point at their entity through the
-- anchor columns (game_id / tournament_id).
--
-- Three arena kinds, distinguished by arenas_camp_filter_agree:
--   filter arenas     — match_filter_id set, no anchors: user-created arenas
--                       and the auto-managed per-game arenas
--   camp arenas       — link-only, no filter, no anchor; date window required
--                       (ADR-27)
--   tournament arenas — link-only, no filter, tournament anchor (ADR-26)
-- Link-only arenas answer membership through arena_matches.
--
-- Dirty queue: stale_at IS NOT NULL → arena needs recalculation; recalc_from
-- is the minimum replay date, NULL = full recalc.
CREATE TABLE arenas (
    id                      UUID PRIMARY KEY,
    name                    TEXT        NOT NULL,
    match_filter_id         UUID        NULL REFERENCES match_filters(id) ON DELETE CASCADE,
    settings                JSONB       NOT NULL,
    settings_schema_version INT         NOT NULL DEFAULT 1,
    game_id                 UUID        NULL REFERENCES games(id) ON DELETE CASCADE,
    tournament_id           UUID        NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    recalc_from             TIMESTAMPTZ NULL,
    stale_at                TIMESTAMPTZ NULL,
    camp                    BOOLEAN     NOT NULL DEFAULT false,
    starts_at               TIMESTAMPTZ NULL,
    ends_at                 TIMESTAMPTZ NULL,
    CONSTRAINT arenas_stale_recalc_agree CHECK (
        recalc_from IS NULL OR stale_at IS NOT NULL
    ),
    CONSTRAINT arenas_camp_filter_agree CHECK (
        (camp AND match_filter_id IS NULL AND tournament_id IS NULL)
        OR (NOT camp AND match_filter_id IS NOT NULL AND tournament_id IS NULL)
        OR (NOT camp AND match_filter_id IS NULL AND tournament_id IS NOT NULL)
    ),
    CONSTRAINT arenas_camp_dates_required
        CHECK (NOT camp OR (starts_at IS NOT NULL AND ends_at IS NOT NULL)),
    CONSTRAINT arenas_noncamp_no_dates
        CHECK (camp OR (starts_at IS NULL AND ends_at IS NULL))
);

CREATE INDEX arenas_game_id_idx       ON arenas (game_id);
CREATE INDEX arenas_tournament_id_idx ON arenas (tournament_id);
CREATE INDEX arenas_stale_at_idx      ON arenas (stale_at) WHERE stale_at IS NOT NULL;

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

-- Link-only arena membership (ADR-28 amendment): camp arenas (ADR-27) and
-- tournament arenas (ADR-26) both answer the same membership question — "is
-- this match in this arena" — with the anchor entity as the only difference.
-- This one table, anchored at the arena, serves both flavors; filter arenas
-- never get rows here.
CREATE TABLE arena_matches (
    arena_id UUID NOT NULL REFERENCES arenas(id) ON DELETE CASCADE,
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    PRIMARY KEY (arena_id, match_id)
);

CREATE INDEX arena_matches_match_idx ON arena_matches (match_id);

-- Voluntary guarantors as liquidity providers (ADR-20). A guarantee is a
-- player's immutable, consent-based wager: a risk amount (their honest maximum
-- loss) and a maker fee rate in [0, 0.25]. The LMSR liquidity becomes dynamic:
-- b = min(max_guarantor_loss, SUM(risk_amount)) / ln(n), recomputed as wagers
-- arrive; prices are preserved across joins by rescaling the q vector.
CREATE TABLE market_guarantees (
    id          UUID        NOT NULL PRIMARY KEY,
    market_id   UUID        NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    player_id   UUID        NOT NULL REFERENCES players(id),
    risk_amount FLOAT       NOT NULL CHECK (risk_amount > 0),
    fee_rate    FLOAT       NOT NULL CHECK (fee_rate >= 0 AND fee_rate <= 0.25),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX market_guarantees_market_idx ON market_guarantees (market_id);

-- The arena-membership rule (ADR-28) as one pure SQL expression. Two measured
-- facts drove this shape (adr/28-arena-membership-function.md):
--
-- 1. A function body containing any sub-SELECT is never inlined, and an
--    opaque call re-executes its subplans per (arena, match) pair.
-- 2. A body that is a pure expression inlines completely — even when an
--    ARGUMENT contains an EXISTS — and the planner then optimizes the whole
--    membership condition as if it were written inline.
--
-- So the function owns the STRUCTURE of the rule, and callers pass the two
-- probes it cannot express without sub-SELECTs — each a one-line EXISTS in
-- the caller, where the planner hashes it optimally:
--
--   p_link             EXISTS (SELECT 1 FROM arena_matches am
--                              WHERE am.arena_id = a.id AND am.match_id = m.id)
--   p_has_filtered_tag EXISTS (SELECT 1 FROM game_tag gt
--                              WHERE gt.game_id = m.game_id
--                                AND gt.tag_id = ANY(f.tag_ids))
--
-- The p_link_only flag keeps link-only arenas (camps, tournaments) mutually
-- exclusive from filter arenas: their filter is NULL, and NULL filters would
-- otherwise match everything.
--
-- Call sites: pkg/db/query/arenas.sql. Never inline the rule back, and never
-- bury a sub-SELECT in this body — inlining is the whole point. LANGUAGE sql
-- IMMUTABLE; no SET search_path (a SET clause would block inlining).
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

-- ---------------------------------------------------------------------------
-- Seed data (dev fixtures on top live in testdata/seed.sql).
-- ---------------------------------------------------------------------------

-- Initial clubs
INSERT INTO clubs (id, name, icon) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Синие люди', 'blue-figure'),
    ('00000000-0000-0000-0000-000000000002', 'Весёлые карточные игры', 'clover'),
    ('00000000-0000-0000-0000-000000000003', 'тбонк', 'tbonk');

-- Authorized users (legacy_int_id preserves the pre-UUID JWT "sub" claim, ADR-08)
INSERT INTO users (id, allow_editing, google_oauth_user_id, google_oauth_user_name, legacy_int_id) VALUES
    ('00000000-0000-0000-0000-000000000001', true, '116214603310517670471', 'User 1', 1);

-- Default Elo constants (effective from the beginning of time)
INSERT INTO elo_settings (effective_date, elo_const_k, elo_const_d, starting_elo, win_reward)
VALUES ('-infinity'::timestamp, 32, 400, 1000, 1);

-- Game tags (shared vocabulary; the Кланк! arena filter below references one).
INSERT INTO public.tags (id,"name") VALUES
	 ('01a09d03-b49e-7799-ada3-6ffa44981686'::uuid,'Евро'),
	 ('01a09d04-cff6-7ef1-be97-267e89b470b1'::uuid,'Взятки и избавление от карт'),
	 ('01a09d04-e2a3-772c-97fa-59ac147df7be'::uuid,'Кланк');

-- ---------------------------------------------------------------------------
-- Seeded arenas: the global arena, the Кланк! arena and the 2026 Chelyabinsk
-- camp arena. Per-game arenas are NOT seeded: games enter an environment
-- through the app (or the dev seed), and creating a game auto-creates its
-- arena (EnsureGameArena, pkg/elo/arena.go). Settings for the global arena are
-- copied from the elo_settings row — from here on the arena settings document
-- is the single source for league parameters (the elo_settings league columns
-- are dead configuration).
-- ---------------------------------------------------------------------------

-- Well-known ids (see ADR-24 and pkg/elo/arena.go):
--   global arena        a2ea0000-0000-0000-0000-000000000001
--   global arena filter a2ea0000-0000-0000-0000-000000000002
INSERT INTO match_filters (id) VALUES ('a2ea0000-0000-0000-0000-000000000002');

WITH s AS (SELECT * FROM elo_settings ORDER BY effective_date DESC LIMIT 1)
INSERT INTO arenas (id, name, match_filter_id, settings, game_id, tournament_id)
SELECT
    'a2ea0000-0000-0000-0000-000000000001',
    'Главная',
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

-- The Кланк! arena (user-created in prod; its filter targets the Кланк tag).
INSERT INTO match_filters (id, date_from, date_to, game_ids, tag_ids) VALUES
     ('5e9d008c-35c4-4075-a7f5-ca4723164534'::uuid, NULL, NULL, NULL,
      '{01a09d04-e2a3-772c-97fa-59ac147df7be}');

INSERT INTO arenas (id, name, match_filter_id, settings) VALUES
     ('5e9d008c-35c4-4075-a7f5-ca4723164534'::uuid, 'Кланк!',
      '5e9d008c-35c4-4075-a7f5-ca4723164534'::uuid,
      '{"leagues": [{"tau": 50, "kind": "newbie", "goal_gap": 16, "earned_max": 64, "earned_min": 2}, {"kind": "amateur"}], "starting_rating": 900}');

-- The 2026 Chelyabinsk camp arena: the previous squash baseline (041) seeded a
-- demo tournament for the camp, which the arena rework (051) turned into an
-- arena and the camp rework (053) converted into a camp arena. The tournament
-- shell is long gone (056); the camp arena it became is kept, with the id as a
-- well-known constant in the arena keyspace (a2ea… is the global arena).
-- Starts stale — the background worker (or POST /admin/update-arenas) fills
-- it after deploy.
WITH s AS (SELECT * FROM elo_settings ORDER BY effective_date DESC LIMIT 1)
INSERT INTO arenas (id, name, match_filter_id, settings, camp, starts_at, ends_at, stale_at)
SELECT
    'a2eb0000-0000-0000-0000-000000000001',
    'Челябинский игровой кэмп 2026',
    NULL,
    jsonb_build_object('starting_rating', s.starting_elo, 'leagues', jsonb_build_array()),
    true,
    '2026-06-15 00:00:00+05',
    '2026-06-21 23:59:00+05',
    NOW()
FROM s;
