-- Replace date with match_id in player_ratings table
ALTER TABLE player_ratings DROP CONSTRAINT player_ratings_pkey;
ALTER TABLE player_ratings DROP COLUMN date;
ALTER TABLE player_ratings ADD COLUMN match_id INT NOT NULL;
ALTER TABLE player_ratings ADD FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE;
ALTER TABLE player_ratings ADD PRIMARY KEY (match_id, player_id);
