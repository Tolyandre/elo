-- 1. global_arena_settlement: add dual-track columns (rating vs elo)
ALTER TABLE global_arena_settlement
    ADD COLUMN new_elo        FLOAT,
    ADD COLUMN elo_staked     FLOAT,
    ADD COLUMN elo_earned     FLOAT,
    ADD COLUMN rating_staked  FLOAT,
    ADD COLUMN rating_earned  FLOAT,
    ADD COLUMN league         TEXT NOT NULL DEFAULT 'amateur';

-- Back-fill from existing single-track data (elo == rating initially)
UPDATE global_arena_settlement SET
    new_elo       = new_rating,
    elo_staked    = staked,
    elo_earned    = earned,
    rating_staked = staked,
    rating_earned = earned;

ALTER TABLE global_arena_settlement
    ALTER COLUMN new_elo       SET NOT NULL,
    ALTER COLUMN elo_staked    SET NOT NULL,
    ALTER COLUMN elo_earned    SET NOT NULL,
    ALTER COLUMN rating_staked SET NOT NULL,
    ALTER COLUMN rating_earned SET NOT NULL,
    DROP COLUMN staked,
    DROP COLUMN earned;

ALTER TABLE global_arena_settlement
    ADD CONSTRAINT global_arena_settlement_league_check
    CHECK (league IN ('newbie', 'amateur', 'elite'));

-- 2. game_arena_settlement: same dual-track split (no elite league for game arenas)
ALTER TABLE game_arena_settlement
    ADD COLUMN new_elo        FLOAT,
    ADD COLUMN elo_staked     FLOAT,
    ADD COLUMN elo_earned     FLOAT,
    ADD COLUMN rating_staked  FLOAT,
    ADD COLUMN rating_earned  FLOAT,
    ADD COLUMN league         TEXT NOT NULL DEFAULT 'amateur';

UPDATE game_arena_settlement SET
    new_elo       = new_rating,
    elo_staked    = staked,
    elo_earned    = earned,
    rating_staked = staked,
    rating_earned = earned;

ALTER TABLE game_arena_settlement
    ALTER COLUMN new_elo       SET NOT NULL,
    ALTER COLUMN elo_staked    SET NOT NULL,
    ALTER COLUMN elo_earned    SET NOT NULL,
    ALTER COLUMN rating_staked SET NOT NULL,
    ALTER COLUMN rating_earned SET NOT NULL,
    DROP COLUMN staked,
    DROP COLUMN earned;

ALTER TABLE game_arena_settlement
    ADD CONSTRAINT game_arena_settlement_league_check
    CHECK (league IN ('newbie', 'amateur'));

-- 3. elo_settings: league configuration columns with sensible defaults
ALTER TABLE elo_settings
    ADD COLUMN starting_rating              FLOAT NOT NULL DEFAULT 0,
    ADD COLUMN newbie_league_goal           FLOAT NOT NULL DEFAULT 500,
    ADD COLUMN newbie_league_elo_const_k    FLOAT NOT NULL DEFAULT 64,
    ADD COLUMN newbie_league_elo_const_d    FLOAT NOT NULL DEFAULT 400,
    ADD COLUMN elite_league_matches_6months INT   NOT NULL DEFAULT 20,
    ADD COLUMN elite_league_matches_2months INT   NOT NULL DEFAULT 3;
