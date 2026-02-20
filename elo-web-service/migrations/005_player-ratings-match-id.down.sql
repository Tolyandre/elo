-- Revert to date-based player_ratings table
ALTER TABLE player_ratings DROP CONSTRAINT player_ratings_pkey;
ALTER TABLE player_ratings DROP CONSTRAINT player_ratings_match_id_fkey;
ALTER TABLE player_ratings DROP COLUMN match_id;
ALTER TABLE player_ratings ADD COLUMN date TIMESTAMP WITH TIME ZONE NOT NULL;
ALTER TABLE player_ratings ADD PRIMARY KEY (date, player_id);
