-- Introduce global_arena_settlement and game_arena_settlement as the first step toward the arena model.
-- Migrates data from player_ratings, bet_settlement_details, and match_scores rating columns,
-- then drops those old tables/columns.

-- global_arena_settlement: replaces player_ratings + bet_settlement_details.
-- staked is always negative (cost/risk), earned is always non-negative (gain).
CREATE TABLE global_arena_settlement (
    id            SERIAL                   NOT NULL PRIMARY KEY,
    player_id     INT                      NOT NULL REFERENCES players(id),
    date          TIMESTAMP WITH TIME ZONE NOT NULL,
    new_rating    FLOAT                    NOT NULL,
    discriminator TEXT                     NOT NULL CHECK (discriminator IN ('match', 'market')),
    match_id      INT                      NULL REFERENCES matches(id),
    market_id     INT                      NULL REFERENCES markets(id),
    staked        FLOAT                    NOT NULL,
    earned        FLOAT                    NOT NULL
);

CREATE UNIQUE INDEX global_arena_settlement_match_unique
    ON global_arena_settlement (match_id, player_id)
    WHERE match_id IS NOT NULL;

CREATE UNIQUE INDEX global_arena_settlement_market_unique
    ON global_arena_settlement (market_id, player_id)
    WHERE market_id IS NOT NULL;

-- game_arena_settlement: replaces per-game Elo columns in match_scores.
-- date is duplicated from matches for efficient queries without JOIN.
CREATE TABLE game_arena_settlement (
    id            SERIAL                   NOT NULL PRIMARY KEY,
    game_id       INT                      NOT NULL REFERENCES games(id),
    player_id     INT                      NOT NULL REFERENCES players(id),
    date          TIMESTAMP WITH TIME ZONE NOT NULL,
    new_rating    FLOAT                    NOT NULL,
    discriminator TEXT                     NOT NULL CHECK (discriminator IN ('match')),
    match_id      INT                      NULL REFERENCES matches(id),
    staked        FLOAT                    NOT NULL,
    earned        FLOAT                    NOT NULL
);

CREATE UNIQUE INDEX game_arena_settlement_match_unique
    ON game_arena_settlement (match_id, player_id)
    WHERE match_id IS NOT NULL;

-- Migrate match-based global Elo: player_ratings + rating_pay/earn from match_scores.
INSERT INTO global_arena_settlement
    (player_id, date, new_rating, discriminator, match_id, market_id, staked, earned)
SELECT pr.player_id, pr.date, pr.rating, 'match', pr.match_id, NULL,
       ms.rating_pay, ms.rating_earn
FROM player_ratings pr
JOIN match_scores ms ON ms.match_id = pr.match_id AND ms.player_id = pr.player_id
WHERE pr.source_type = 'match';

-- Migrate market-based global Elo: player_ratings + bet_settlement_details.
-- staked is negated to follow the uniform sign convention (always negative).
INSERT INTO global_arena_settlement
    (player_id, date, new_rating, discriminator, match_id, market_id, staked, earned)
SELECT pr.player_id, pr.date, pr.rating, 'market', NULL, pr.market_id,
       -bsd.staked, bsd.earned
FROM player_ratings pr
JOIN bet_settlement_details bsd
    ON bsd.market_id = pr.market_id AND bsd.player_id = pr.player_id
WHERE pr.source_type = 'market_settlement';

-- Migrate game Elo from match_scores (with date duplicated from matches).
INSERT INTO game_arena_settlement
    (game_id, player_id, date, new_rating, discriminator, match_id, staked, earned)
SELECT m.game_id, ms.player_id, m.date, ms.game_new_elo, 'match', ms.match_id,
       ms.game_elo_pay, ms.game_elo_earn
FROM match_scores ms
JOIN matches m ON m.id = ms.match_id;

DROP TABLE player_ratings;
DROP TABLE bet_settlement_details;

ALTER TABLE match_scores
    DROP COLUMN rating_pay,
    DROP COLUMN rating_earn,
    DROP COLUMN game_elo_pay,
    DROP COLUMN game_elo_earn,
    DROP COLUMN game_new_elo;
