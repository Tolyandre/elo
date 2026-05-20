ALTER TABLE elo_settings
    DROP COLUMN newbie_league_elo_const_k,
    DROP COLUMN newbie_league_elo_const_d,
    ADD COLUMN rating_max_k FLOAT NOT NULL DEFAULT 64,
    ADD COLUMN rating_k_tau FLOAT NOT NULL DEFAULT 100;
