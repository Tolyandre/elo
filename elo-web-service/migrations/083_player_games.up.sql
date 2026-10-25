-- A player's game collection ("коллекция игр"): the games the player keeps on
-- their shelf. Public to read (the profile page shows it to everyone); managed
-- only by the user linked to the player (users.player_id) — the check lives in
-- the API handlers, the table itself is authorization-free like the rest.
CREATE TABLE player_games (
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    game_id   UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT player_games_player_game_unique UNIQUE (player_id, game_id)
);

-- Deleting a game must stay cheap even with many collectors holding it.
CREATE INDEX player_games_game_id_idx ON player_games(game_id);
