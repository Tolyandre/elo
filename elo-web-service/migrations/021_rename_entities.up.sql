-- Rename betting tables to remove 'outcome_' prefix
ALTER TABLE outcome_markets RENAME TO markets;
ALTER TABLE outcome_bets RENAME TO bets;
ALTER TABLE outcome_market_match_winner_params RENAME TO market_match_winner_params;
ALTER TABLE outcome_market_win_streak_params RENAME TO market_win_streak_params;

-- Rename match_scores Elo columns: global_elo -> rating
-- (global_elo is used for bet market settlement, hence the rename to 'rating')
ALTER TABLE match_scores RENAME COLUMN global_elo_pay TO rating_pay;
ALTER TABLE match_scores RENAME COLUMN global_elo_earn TO rating_earn;

-- Update source_type values in player_ratings
UPDATE player_ratings SET source_type = 'market_settlement' WHERE source_type = 'bet_settlement';

-- Rename indexes that referenced old table names
ALTER INDEX outcome_bets_player_market RENAME TO bets_player_market;
ALTER INDEX outcome_bets_market_id RENAME TO bets_market_id;
