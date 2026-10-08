-- The "global arena" naming is retired (ADR-36 phase 6): this elo_settings
-- column is the default starting rating for newly auto-created arenas —
-- fresh tenant arenas in particular — not a global-arena constant.
ALTER TABLE elo_settings RENAME COLUMN starting_rating_global_arena TO starting_rating_default;
