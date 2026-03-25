-- Betting system: markets (рынки исходов), bets, settlement

-- 1. Add bet_limit to players
ALTER TABLE players ADD COLUMN bet_limit FLOAT NOT NULL DEFAULT 0;

-- 2. Outcome markets (shared base table)
CREATE TABLE outcome_markets (
    id                   SERIAL PRIMARY KEY,
    title                TEXT NOT NULL,
    description          TEXT NOT NULL DEFAULT '',
    market_type          TEXT NOT NULL CHECK (market_type IN ('match_winner', 'win_streak')),
    status               TEXT NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open', 'resolved_yes', 'resolved_no', 'cancelled')),
    starts_at            TIMESTAMP WITH TIME ZONE NOT NULL,
    closes_at            TIMESTAMP WITH TIME ZONE NOT NULL,
    created_by           INT NOT NULL REFERENCES users(id),
    created_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    resolved_at          TIMESTAMP WITH TIME ZONE NULL,
    resolution_match_id  INT NULL REFERENCES matches(id) ON DELETE SET NULL
);

-- 3. Class Table Inheritance: params for match_winner markets
CREATE TABLE outcome_market_match_winner_params (
    market_id            INT NOT NULL PRIMARY KEY REFERENCES outcome_markets(id) ON DELETE CASCADE,
    target_player_id     INT NOT NULL REFERENCES players(id),
    required_player_ids  INT[] NOT NULL DEFAULT '{}',
    game_id              INT NULL REFERENCES games(id)
);

-- 4. Class Table Inheritance: params for win_streak markets
CREATE TABLE outcome_market_win_streak_params (
    market_id        INT NOT NULL PRIMARY KEY REFERENCES outcome_markets(id) ON DELETE CASCADE,
    target_player_id INT NOT NULL REFERENCES players(id),
    game_id          INT NOT NULL REFERENCES games(id),
    wins_required    INT NOT NULL,
    max_losses       INT NULL
);

-- 5. Bets: multiple bets per player per (market, outcome) allowed
CREATE TABLE outcome_bets (
    id        SERIAL PRIMARY KEY,
    market_id INT   NOT NULL REFERENCES outcome_markets(id),
    player_id INT   NOT NULL REFERENCES players(id),
    outcome   TEXT  NOT NULL CHECK (outcome IN ('yes', 'no')),
    amount    FLOAT NOT NULL CHECK (amount > 0),
    placed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX outcome_bets_player_market ON outcome_bets (player_id, market_id);
CREATE INDEX outcome_bets_market_id     ON outcome_bets (market_id);

-- 6. Settlement details (аналог match_scores)
CREATE TABLE bet_settlement_details (
    market_id INT   NOT NULL REFERENCES outcome_markets(id),
    player_id INT   NOT NULL REFERENCES players(id),
    staked    FLOAT NOT NULL,
    earned    FLOAT NOT NULL,
    PRIMARY KEY (market_id, player_id)
);

-- 7. Extend player_ratings to reference a market settlement
ALTER TABLE player_ratings ADD COLUMN market_id INT NULL REFERENCES outcome_markets(id);

-- Partial unique index for upserts (mirrors existing match_id index pattern)
CREATE UNIQUE INDEX player_ratings_market_unique
    ON player_ratings (market_id, player_id)
    WHERE market_id IS NOT NULL;
