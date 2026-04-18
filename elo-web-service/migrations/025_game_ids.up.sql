-- match_winner: game_id (nullable INT) → game_ids (INT[] NOT NULL DEFAULT '{}')
ALTER TABLE market_match_winner_params ADD COLUMN game_ids INT[] NOT NULL DEFAULT '{}';
UPDATE market_match_winner_params SET game_ids = ARRAY[game_id] WHERE game_id IS NOT NULL;
ALTER TABLE market_match_winner_params DROP COLUMN game_id;

-- win_streak: game_id (required INT) → game_ids (INT[] NOT NULL DEFAULT '{}')
ALTER TABLE market_win_streak_params ADD COLUMN game_ids INT[] NOT NULL DEFAULT '{}';
UPDATE market_win_streak_params SET game_ids = ARRAY[game_id];
ALTER TABLE market_win_streak_params DROP COLUMN game_id;
