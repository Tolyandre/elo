ALTER TABLE global_arena_settlement RENAME COLUMN new_rating TO rating_after;
ALTER TABLE global_arena_settlement RENAME COLUMN new_elo    TO elo_after;
ALTER TABLE game_arena_settlement   RENAME COLUMN new_rating TO rating_after;
ALTER TABLE game_arena_settlement   RENAME COLUMN new_elo    TO elo_after;
