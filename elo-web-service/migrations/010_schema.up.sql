-- Squashed schema representing the state after all previous migrations (001–010).
-- New databases run only this file. Existing databases at version 10 skip it automatically.

CREATE TABLE IF NOT EXISTS clubs (
    id   SERIAL PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
    id   SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    CONSTRAINT games_name_unique UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS players (
    id             SERIAL PRIMARY KEY,
    name           TEXT NOT NULL,
    geologist_name TEXT NULL,
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
    id      SERIAL PRIMARY KEY,
    date    TIMESTAMP WITH TIME ZONE NULL,
    game_id INT NOT NULL,
    FOREIGN KEY (game_id) REFERENCES games(id)
);

CREATE TABLE IF NOT EXISTS match_scores (
    match_id  INT   NOT NULL,
    player_id INT   NOT NULL,
    score     FLOAT NOT NULL,
    elo_pay   FLOAT,
    elo_earn  FLOAT,
    new_elo   FLOAT,
    PRIMARY KEY (match_id, player_id),
    FOREIGN KEY (match_id)  REFERENCES matches(id),
    FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS player_ratings (
    date      TIMESTAMP WITH TIME ZONE NOT NULL,
    player_id INT                      NOT NULL,
    rating    FLOAT                    NOT NULL,
    PRIMARY KEY (date, player_id),
    FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS users (
    id                    SERIAL  NOT NULL PRIMARY KEY,
    allow_editing         BOOLEAN NOT NULL,
    google_oauth_user_id  TEXT    NOT NULL UNIQUE,
    google_oauth_user_name TEXT   NOT NULL
);

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
