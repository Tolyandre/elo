ALTER TABLE match_scores
    RENAME COLUMN elo_pay  TO global_elo_pay;
ALTER TABLE match_scores
    RENAME COLUMN elo_earn TO global_elo_earn;
ALTER TABLE match_scores
    RENAME COLUMN new_elo  TO global_new_elo;
