ALTER TABLE users ADD COLUMN player_id INTEGER NULL REFERENCES players(id) ON DELETE SET NULL;
ALTER TABLE users ADD CONSTRAINT users_player_id_unique UNIQUE (player_id);
