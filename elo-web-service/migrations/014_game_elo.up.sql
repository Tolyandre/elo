ALTER TABLE match_scores
    ADD COLUMN game_elo_pay  FLOAT,
    ADD COLUMN game_elo_earn FLOAT,
    ADD COLUMN game_new_elo  FLOAT;
