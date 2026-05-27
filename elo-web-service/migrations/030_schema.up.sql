-- Squashed schema representing the state after all migrations through 030.
-- New databases run only this file. Existing databases at version 030 skip it automatically.

CREATE TABLE clubs (
    id             SERIAL PRIMARY KEY,
    name           TEXT   NOT NULL,
    geologist_name TEXT   NULL
);

CREATE TABLE games (
    id   SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    CONSTRAINT games_name_unique UNIQUE (name)
);

CREATE TABLE players (
    id             SERIAL PRIMARY KEY,
    name           TEXT  NOT NULL,
    geologist_name TEXT  NULL,
    bet_limit      FLOAT NOT NULL DEFAULT 0,
    CONSTRAINT players_name_unique UNIQUE (name)
);

CREATE TABLE player_club_membership (
    club_id   INT NOT NULL,
    player_id INT NOT NULL,
    PRIMARY KEY (club_id, player_id),
    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
    FOREIGN KEY (club_id)   REFERENCES clubs(id)
);

CREATE TABLE matches (
    id      SERIAL                   PRIMARY KEY,
    date    TIMESTAMP WITH TIME ZONE NOT NULL,
    game_id INT                      NOT NULL,
    FOREIGN KEY (game_id) REFERENCES games(id)
);

CREATE TABLE users (
    id                     SERIAL  NOT NULL PRIMARY KEY,
    allow_editing          BOOLEAN NOT NULL,
    google_oauth_user_id   TEXT    NOT NULL UNIQUE,
    google_oauth_user_name TEXT    NOT NULL,
    player_id              INTEGER NULL REFERENCES players(id) ON DELETE SET NULL,
    CONSTRAINT users_player_id_unique UNIQUE (player_id)
);

CREATE TABLE match_scores (
    match_id  INT   NOT NULL,
    player_id INT   NOT NULL,
    score     FLOAT NOT NULL,
    PRIMARY KEY (match_id, player_id),
    FOREIGN KEY (match_id)  REFERENCES matches(id),
    FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE TABLE markets (
    id                  SERIAL PRIMARY KEY,
    market_type         TEXT                     NOT NULL CHECK (market_type IN ('match_winner', 'win_streak')),
    status              TEXT                     NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open', 'betting_closed', 'resolved', 'cancelled')),
    starts_at           TIMESTAMP WITH TIME ZONE NOT NULL,
    closes_at           TIMESTAMP WITH TIME ZONE NOT NULL,
    created_by          INT                      NOT NULL REFERENCES users(id),
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    resolved_at         TIMESTAMP WITH TIME ZONE NULL,
    resolution_match_id INT                      NULL REFERENCES matches(id) ON DELETE SET NULL,
    resolution_outcome  TEXT                     NULL,
    betting_closed_at   TIMESTAMPTZ              NULL,
    CONSTRAINT markets_betting_closed_at_check
        CHECK (status != 'betting_closed' OR betting_closed_at IS NOT NULL)
);

CREATE TABLE market_match_winner_params (
    market_id           INT   NOT NULL PRIMARY KEY REFERENCES markets(id) ON DELETE CASCADE,
    target_player_id    INT   NOT NULL REFERENCES players(id),
    required_player_ids INT[] NOT NULL DEFAULT '{}',
    game_ids            INT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE market_win_streak_params (
    market_id        INT   NOT NULL PRIMARY KEY REFERENCES markets(id) ON DELETE CASCADE,
    target_player_id INT   NOT NULL REFERENCES players(id),
    wins_required    INT   NOT NULL,
    max_losses       INT   NULL,
    game_ids         INT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE bets (
    id        SERIAL PRIMARY KEY,
    market_id INT   NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    player_id INT   NOT NULL REFERENCES players(id),
    outcome   TEXT  NOT NULL,
    amount    FLOAT NOT NULL CHECK (amount > 0),
    placed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX bets_player_market ON bets (player_id, market_id);
CREATE INDEX bets_market_id     ON bets (market_id);

CREATE TABLE elo_settings (
    effective_date               TIMESTAMP WITH TIME ZONE NOT NULL PRIMARY KEY,
    elo_const_k                  FLOAT NOT NULL,
    elo_const_d                  FLOAT NOT NULL,
    starting_elo                 FLOAT NOT NULL,
    win_reward                   FLOAT NOT NULL,
    starting_rating              FLOAT NOT NULL DEFAULT 0,
    newbie_league_goal           FLOAT NOT NULL DEFAULT 500,
    elite_league_matches_6months INT   NOT NULL DEFAULT 20,
    elite_league_matches_2months INT   NOT NULL DEFAULT 3,
    rating_max_k                 FLOAT NOT NULL DEFAULT 64,
    rating_k_tau                 FLOAT NOT NULL DEFAULT 100
);

CREATE TABLE skull_king_tables (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    host_user_id         INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_state           JSONB       NOT NULL,
    connected_player_ids INTEGER[]   NOT NULL DEFAULT '{}',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at           TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 day'
);

CREATE INDEX skull_king_tables_expires_at_idx ON skull_king_tables (expires_at);

CREATE TABLE corrections (
    id            SERIAL PRIMARY KEY,
    player_id     INT   NOT NULL REFERENCES players(id),
    discriminator TEXT  NOT NULL CHECK (discriminator IN ('correction')),
    diff          FLOAT NOT NULL,
    date          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX corrections_date_idx ON corrections (date);

CREATE TABLE global_arena_settlement (
    id            SERIAL                   NOT NULL PRIMARY KEY,
    player_id     INT                      NOT NULL REFERENCES players(id),
    date          TIMESTAMP WITH TIME ZONE NOT NULL,
    new_rating    FLOAT                    NOT NULL,
    new_elo       FLOAT                    NOT NULL,
    discriminator TEXT                     NOT NULL CHECK (discriminator IN ('match', 'market', 'correction')),
    match_id      INT                      NULL REFERENCES matches(id),
    market_id     INT                      NULL REFERENCES markets(id),
    correction_id INT                      NULL REFERENCES corrections(id),
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
    ON global_arena_settlement (market_id, player_id)
    WHERE market_id IS NOT NULL;

CREATE UNIQUE INDEX global_arena_settlement_correction_unique
    ON global_arena_settlement (correction_id, player_id)
    WHERE correction_id IS NOT NULL;

CREATE TABLE game_arena_settlement (
    id            SERIAL                   NOT NULL PRIMARY KEY,
    game_id       INT                      NOT NULL REFERENCES games(id),
    player_id     INT                      NOT NULL REFERENCES players(id),
    date          TIMESTAMP WITH TIME ZONE NOT NULL,
    new_rating    FLOAT                    NOT NULL,
    new_elo       FLOAT                    NOT NULL,
    discriminator TEXT                     NOT NULL CHECK (discriminator IN ('match')),
    match_id      INT                      NULL REFERENCES matches(id),
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

-- Initial clubs
INSERT INTO clubs (id, name) VALUES
    (1, 'Синие люди'),
    (2, 'Весёлые карточные игры');
SELECT setval('clubs_id_seq', (SELECT MAX(id) FROM clubs));

-- Authorized users
INSERT INTO users (allow_editing, google_oauth_user_id, google_oauth_user_name) VALUES
    (true, '116214603310517670471', 'User 1');

-- Default Elo constants (effective from the beginning of time)
INSERT INTO elo_settings (effective_date, elo_const_k, elo_const_d, starting_elo, win_reward)
VALUES ('-infinity'::timestamp, 32, 400, 1000, 1);
