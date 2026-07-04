-- Squashed schema representing the state after all migrations through 035.
-- New databases run only this file. Existing databases at version 035 skip it automatically.

CREATE TABLE clubs (
    id             SERIAL PRIMARY KEY,
    name           TEXT   NOT NULL,
    geologist_name TEXT   NULL,
    icon_svg       TEXT   NULL
);

CREATE TABLE games (
    id              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    idempotency_key UUID NULL,
    CONSTRAINT games_name_unique UNIQUE (name)
);

CREATE UNIQUE INDEX games_idempotency_key_unique ON games (idempotency_key);

CREATE TABLE players (
    id              SERIAL PRIMARY KEY,
    name            TEXT  NOT NULL,
    geologist_name  TEXT  NULL,
    bet_limit       FLOAT NOT NULL DEFAULT 0,
    idempotency_key UUID  NULL,
    CONSTRAINT players_name_unique UNIQUE (name)
);

CREATE UNIQUE INDEX players_idempotency_key_unique ON players (idempotency_key);

CREATE TABLE player_club_membership (
    club_id   INT NOT NULL,
    player_id INT NOT NULL,
    PRIMARY KEY (club_id, player_id),
    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
    FOREIGN KEY (club_id)   REFERENCES clubs(id)
);

CREATE TABLE matches (
    id              SERIAL                   PRIMARY KEY,
    date            TIMESTAMP WITH TIME ZONE NOT NULL,
    game_id         INT                      NOT NULL,
    idempotency_key UUID                     NULL,
    FOREIGN KEY (game_id) REFERENCES games(id)
);

CREATE UNIQUE INDEX matches_idempotency_key_unique ON matches (idempotency_key);

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

CREATE TABLE tournaments (
    id         SERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    start_date TIMESTAMP WITH TIME ZONE NOT NULL,
    end_date   TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT tournaments_name_unique UNIQUE (name)
);

CREATE TABLE tournament_player_membership (
    tournament_id INT NOT NULL,
    player_id     INT NOT NULL,
    PRIMARY KEY (tournament_id, player_id),
    FOREIGN KEY (player_id)     REFERENCES players(id) ON DELETE CASCADE,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id)
);

CREATE TABLE match_tournament (
    match_id      INT NOT NULL,
    tournament_id INT NOT NULL,
    PRIMARY KEY (match_id, tournament_id),
    FOREIGN KEY (match_id)      REFERENCES matches(id) ON DELETE CASCADE,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id)
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
    elite_league_matches_6months INT   NOT NULL DEFAULT 20,
    elite_league_matches_2months INT   NOT NULL DEFAULT 3,
    newbie_league_earned_min     FLOAT NOT NULL DEFAULT 2,
    newbie_league_earned_max     FLOAT NOT NULL DEFAULT 64,
    newbie_league_earned_tau     FLOAT NOT NULL DEFAULT 100,
    newbie_league_goal_gap       FLOAT NOT NULL DEFAULT 16,
    starting_rating_global_arena FLOAT NOT NULL DEFAULT 0,
    starting_rating_game_arena   FLOAT NOT NULL DEFAULT 900
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
    rating_after  FLOAT                    NOT NULL,
    elo_after     FLOAT                    NOT NULL,
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
    rating_after  FLOAT                    NOT NULL,
    elo_after     FLOAT                    NOT NULL,
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
INSERT INTO clubs (id, name, icon_svg) VALUES
    (1, 'Синие люди',
     '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><path d="M2 14 H3.6 L6.2 21.5 L9.2 4 H22" stroke="#1d4ed8" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="15.8" cy="9.2" r="2.1" fill="#2563eb"/><path d="M14.4 11 L12 12.1 L11.7 13.6 L14.2 14 L12.6 21 L15.1 21 L15.8 17.4 L16.5 21 L19 21 L17.4 14 L19.9 13.6 L19.6 12.1 L17.2 11 Z" fill="#2563eb"/></svg>'),
    (2, 'Весёлые карточные игры',
     '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="leafGrad" cx="50%" cy="38%" r="65%"><stop offset="0%" stop-color="#78d156"/><stop offset="55%" stop-color="#43a040"/><stop offset="100%" stop-color="#1d6527"/></radialGradient><linearGradient id="stemGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#4ea540"/><stop offset="100%" stop-color="#2a6e2f"/></linearGradient><g id="leaf"><path d="M0,0 C0,0 -40,-35 -40,-60 C-40,-75 -25,-85 -10,-75 C-5,-72 0,-65 0,-60 C0,-65 5,-72 10,-75 C25,-85 40,-75 40,-60 C40,-35 0,0 0,0 Z" fill="url(#leafGrad)" stroke="#143f1c" stroke-width="3.5" stroke-linejoin="round"/><path d="M0,0 C0,0 -40,-35 -40,-60 C-40,-75 -25,-85 -10,-75 C-5,-72 0,-65 0,-60 C0,-65 5,-72 10,-75 C25,-85 40,-75 40,-60 C40,-35 0,0 0,0 Z" fill="none" stroke="#aae87b" stroke-width="2.4" opacity="0.5" transform="translate(0,-14) scale(0.62)"/><circle cx="0" cy="-56" r="8" fill="none" stroke="#c8f29a" stroke-width="2.4" opacity="0.5"/></g></defs><path d="M94,96 C92,118 92,150 96,176 L104,176 C108,150 108,118 106,96 Z" fill="url(#stemGrad)" stroke="#143f1c" stroke-width="3" stroke-linejoin="round"/><g transform="translate(100,92) scale(0.95)"><use href="#leaf" transform="rotate(0)"/><use href="#leaf" transform="rotate(120)"/><use href="#leaf" transform="rotate(240)"/></g></svg>');
SELECT setval('clubs_id_seq', (SELECT MAX(id) FROM clubs));

-- Authorized users
INSERT INTO users (allow_editing, google_oauth_user_id, google_oauth_user_name) VALUES
    (true, '116214603310517670471', 'User 1');

-- Default Elo constants (effective from the beginning of time)
INSERT INTO elo_settings (effective_date, elo_const_k, elo_const_d, starting_elo, win_reward)
VALUES ('-infinity'::timestamp, 32, 400, 1000, 1);

-- Demo tournament for the 2026 Chelyabinsk camp + its members + back-filled matches.
-- utc+5 == the +05 offset. Members are all players whose name starts with "(Кэмп)".
WITH t AS (
    INSERT INTO tournaments (name, start_date, end_date)
    VALUES ('Челябинский игровой кэмп 2026',
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
