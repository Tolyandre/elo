ALTER TABLE elo_settings
  ADD COLUMN newbie_league_earned_min      FLOAT NOT NULL DEFAULT 2,
  ADD COLUMN newbie_league_earned_max      FLOAT NOT NULL DEFAULT 64,
  ADD COLUMN newbie_league_earned_tau      FLOAT NOT NULL DEFAULT 100,
  ADD COLUMN newbie_league_goal_gap        FLOAT NOT NULL DEFAULT 16,
  ADD COLUMN starting_rating_global_arena  FLOAT NOT NULL DEFAULT 0,
  ADD COLUMN starting_rating_game_arena    FLOAT NOT NULL DEFAULT 900;

UPDATE elo_settings SET
  newbie_league_earned_min     = 2,
  newbie_league_earned_max     = 64,
  newbie_league_earned_tau     = 100,
  newbie_league_goal_gap       = 16,
  starting_rating_global_arena = 0,
  starting_rating_game_arena   = 900;

ALTER TABLE elo_settings
  DROP COLUMN rating_max_k,
  DROP COLUMN rating_k_tau,
  DROP COLUMN newbie_league_goal,
  DROP COLUMN starting_rating;
