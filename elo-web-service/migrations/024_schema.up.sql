-- Squashed schema representing the state after all previous migrations (010–024).
-- New databases run only this file. Existing databases at version 24 skip it automatically.

CREATE TABLE IF NOT EXISTS clubs (
    id             SERIAL PRIMARY KEY,
    name           TEXT   NOT NULL,
    geologist_name TEXT   NULL
);

CREATE TABLE IF NOT EXISTS games (
    id   SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    CONSTRAINT games_name_unique UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS players (
    id             SERIAL PRIMARY KEY,
    name           TEXT  NOT NULL,
    geologist_name TEXT  NULL,
    bet_limit      FLOAT NOT NULL DEFAULT 0,
    CONSTRAINT players_name_unique UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS player_club_membership (
    club_id   INT NOT NULL,
    player_id INT NOT NULL,
    PRIMARY KEY (club_id, player_id),
    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
    FOREIGN KEY (club_id)   REFERENCES clubs(id)
);

CREATE TABLE IF NOT EXISTS matches (
    id      SERIAL                   PRIMARY KEY,
    date    TIMESTAMP WITH TIME ZONE NOT NULL,
    game_id INT                      NOT NULL,
    FOREIGN KEY (game_id) REFERENCES games(id)
);

CREATE TABLE IF NOT EXISTS users (
    id                     SERIAL   NOT NULL PRIMARY KEY,
    allow_editing          BOOLEAN  NOT NULL,
    google_oauth_user_id   TEXT     NOT NULL UNIQUE,
    google_oauth_user_name TEXT     NOT NULL,
    player_id              INTEGER  NULL REFERENCES players(id) ON DELETE SET NULL,
    CONSTRAINT users_player_id_unique UNIQUE (player_id)
);

CREATE TABLE IF NOT EXISTS match_scores (
    match_id      INT   NOT NULL,
    player_id     INT   NOT NULL,
    score         FLOAT NOT NULL,
    rating_pay    FLOAT NOT NULL,
    rating_earn   FLOAT NOT NULL,
    game_elo_pay  FLOAT NOT NULL,
    game_elo_earn FLOAT NOT NULL,
    game_new_elo  FLOAT NOT NULL,
    PRIMARY KEY (match_id, player_id),
    FOREIGN KEY (match_id)  REFERENCES matches(id),
    FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS markets (
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

CREATE TABLE IF NOT EXISTS market_match_winner_params (
    market_id            INT   NOT NULL PRIMARY KEY REFERENCES markets(id) ON DELETE CASCADE,
    target_player_id     INT   NOT NULL REFERENCES players(id),
    required_player_ids  INT[] NOT NULL DEFAULT '{}',
    game_id              INT   NULL REFERENCES games(id)
);

CREATE TABLE IF NOT EXISTS market_win_streak_params (
    market_id        INT NOT NULL PRIMARY KEY REFERENCES markets(id) ON DELETE CASCADE,
    target_player_id INT NOT NULL REFERENCES players(id),
    game_id          INT NOT NULL REFERENCES games(id),
    wins_required    INT NOT NULL,
    max_losses       INT NULL
);

CREATE TABLE IF NOT EXISTS bets (
    id        SERIAL PRIMARY KEY,
    market_id INT   NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    player_id INT   NOT NULL REFERENCES players(id),
    outcome   TEXT  NOT NULL,
    amount    FLOAT NOT NULL CHECK (amount > 0),
    placed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bets_player_market ON bets (player_id, market_id);
CREATE INDEX IF NOT EXISTS bets_market_id     ON bets (market_id);

CREATE TABLE IF NOT EXISTS bet_settlement_details (
    market_id INT   NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    player_id INT   NOT NULL REFERENCES players(id),
    staked    FLOAT NOT NULL,
    earned    FLOAT NOT NULL,
    PRIMARY KEY (market_id, player_id)
);

CREATE TABLE IF NOT EXISTS player_ratings (
    id          SERIAL                   NOT NULL PRIMARY KEY,
    date        TIMESTAMP WITH TIME ZONE NOT NULL,
    player_id   INT                      NOT NULL,
    rating      FLOAT                    NOT NULL,
    source_type TEXT                     NOT NULL DEFAULT 'match',
    match_id    INT                      NULL,
    market_id   INT                      NULL REFERENCES markets(id),
    FOREIGN KEY (player_id)           REFERENCES players(id),
    FOREIGN KEY (match_id, player_id) REFERENCES match_scores(match_id, player_id)
        ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS player_ratings_match_unique
    ON player_ratings (match_id, player_id)
    WHERE match_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS player_ratings_market_unique
    ON player_ratings (market_id, player_id)
    WHERE market_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS elo_settings (
    effective_date TIMESTAMP WITH TIME ZONE NOT NULL PRIMARY KEY,
    elo_const_k    FLOAT NOT NULL,
    elo_const_d    FLOAT NOT NULL,
    starting_elo   FLOAT NOT NULL,
    win_reward     FLOAT NOT NULL
);

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
