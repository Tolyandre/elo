-- Squashed schema representing the state after all migrations through 041.
-- New databases run only this file. Existing databases at version 041 skip it automatically.

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

CREATE TABLE tournaments (
    id         UUID PRIMARY KEY,
    name       TEXT NOT NULL,
    start_date TIMESTAMP WITH TIME ZONE NOT NULL,
    end_date   TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT tournaments_name_unique UNIQUE (name)
);

CREATE TABLE tournament_player_membership (
    tournament_id UUID NOT NULL,
    player_id     UUID NOT NULL,
    PRIMARY KEY (tournament_id, player_id),
    FOREIGN KEY (player_id)     REFERENCES players(id) ON DELETE CASCADE,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id)
);

CREATE TABLE match_tournament (
    match_id      UUID NOT NULL,
    tournament_id UUID NOT NULL,
    PRIMARY KEY (match_id, tournament_id),
    FOREIGN KEY (match_id)      REFERENCES matches(id) ON DELETE CASCADE,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id)
);

CREATE TABLE markets (
    id                  UUID PRIMARY KEY,
    market_type         TEXT                     NOT NULL CHECK (market_type IN ('match_winner', 'win_streak')),
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
    liquidity_b         FLOAT                    NOT NULL DEFAULT 16,
    CONSTRAINT markets_betting_closed_at_check
        CHECK (status != 'betting_closed' OR betting_closed_at IS NOT NULL)
);

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

CREATE TABLE bets (
    id        UUID  PRIMARY KEY,
    market_id UUID  NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    player_id UUID  NOT NULL REFERENCES players(id),
    outcome   UUID  NOT NULL CONSTRAINT bets_outcome_market_outcome_fk
                            REFERENCES market_outcomes(id) ON DELETE CASCADE,
    -- Constraint name predates the amount → cost rename and is kept stable.
    cost      FLOAT NOT NULL CONSTRAINT bets_amount_check CHECK (cost > 0),
    placed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    shares    FLOAT NOT NULL DEFAULT 0
);

CREATE INDEX bets_player_market ON bets (player_id, market_id);
CREATE INDEX bets_market_id     ON bets (market_id);

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
    market_default_liquidity_b   FLOAT NOT NULL DEFAULT 16
);

CREATE TABLE skull_king_tables (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    host_user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_state           JSONB       NOT NULL,
    connected_player_ids UUID[]      NOT NULL DEFAULT '{}',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at           TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 day'
);

CREATE INDEX skull_king_tables_expires_at_idx ON skull_king_tables (expires_at);

CREATE TABLE corrections (
    id            UUID PRIMARY KEY,
    player_id     UUID NOT NULL REFERENCES players(id),
    discriminator TEXT NOT NULL CHECK (discriminator IN ('correction')),
    diff          FLOAT NOT NULL,
    date          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX corrections_date_idx ON corrections (date);

-- Guarantor payouts get their own discriminator so they can be displayed
-- separately from buyer settlements (ADR-10): a player may be both buyer and
-- guarantor on the same market, so market settlements are unique per
-- (market_id, player_id, discriminator) — each role gets its own row.
CREATE TABLE global_arena_settlement (
    id            UUID                     NOT NULL PRIMARY KEY,
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
    league        TEXT                     NOT NULL DEFAULT 'amateur'
                      CHECK (league IN ('newbie', 'amateur', 'elite'))
);

CREATE UNIQUE INDEX global_arena_settlement_match_unique
    ON global_arena_settlement (match_id, player_id)
    WHERE match_id IS NOT NULL;

CREATE UNIQUE INDEX global_arena_settlement_market_unique
    ON global_arena_settlement (market_id, player_id, discriminator)
    WHERE market_id IS NOT NULL;

CREATE UNIQUE INDEX global_arena_settlement_correction_unique
    ON global_arena_settlement (correction_id, player_id)
    WHERE correction_id IS NOT NULL;

CREATE TABLE game_arena_settlement (
    id            UUID                     NOT NULL PRIMARY KEY,
    game_id       UUID                     NOT NULL REFERENCES games(id),
    player_id     UUID                     NOT NULL REFERENCES players(id),
    date          TIMESTAMP WITH TIME ZONE NOT NULL,
    rating_after  FLOAT                    NOT NULL,
    elo_after     FLOAT                    NOT NULL,
    discriminator TEXT                     NOT NULL CHECK (discriminator IN ('match')),
    match_id      UUID                     NULL REFERENCES matches(id),
    elo_staked    FLOAT                    NOT NULL,
    elo_earned    FLOAT                    NOT NULL,
    rating_staked FLOAT                    NOT NULL,
    rating_earned FLOAT                    NOT NULL,
    league        TEXT                     NOT NULL DEFAULT 'amateur'
                      CHECK (league IN ('newbie', 'amateur'))
);

CREATE UNIQUE INDEX game_arena_settlement_match_unique
    ON game_arena_settlement (match_id, player_id)
    WHERE match_id IS NOT NULL;

-- Players who back a market and split its settlement residual equally (ADR-10).
CREATE TABLE market_guarantors (
    market_id UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES players(id),
    PRIMARY KEY (market_id, player_id)
);

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

-- Demo tournament for the 2026 Chelyabinsk camp + its members + back-filled matches.
-- utc+5 == the +05 offset. Members are all players whose name starts with "(Кэмп)".
-- Id is the deterministic int→uuid of the SERIAL id this seed row used to get.
WITH t AS (
    INSERT INTO tournaments (id, name, start_date, end_date)
    VALUES ('00000000-0000-0000-0000-000000000001', 'Челябинский игровой кэмп 2026',
            '2026-06-15 00:00:00+05', '2026-06-21 23:59:00+05')
    RETURNING id
), members AS (
    INSERT INTO tournament_player_membership (tournament_id, player_id)
    SELECT t.id, p.id FROM t, players p WHERE p.name LIKE '(Кэмп)%'
    RETURNING tournament_id, player_id
)
INSERT INTO match_tournament (match_id, tournament_id)
SELECT DISTINCT m.id, t.id
FROM t
JOIN matches m ON m.date >= '2026-06-15 00:00:00+05' AND m.date <= '2026-06-21 23:59:00+05'
JOIN match_scores ms ON ms.match_id = m.id
JOIN members mem ON mem.tournament_id = t.id AND mem.player_id = ms.player_id;
