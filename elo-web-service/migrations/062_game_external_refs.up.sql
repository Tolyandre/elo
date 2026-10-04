-- Board-game metadata: canonical names and external catalog refs (BGG/Tesera).
--
-- `name` stays the display name everywhere and is app-maintained as
-- COALESCE(alias, name_ru, name_original); existing rows get the current
-- name as name_original so the invariant holds before any matching runs.
ALTER TABLE games
    ADD COLUMN name_original TEXT,
    ADD COLUMN name_ru TEXT,
    ADD COLUMN alias TEXT,
    ADD COLUMN bgg_id INTEGER,
    ADD COLUMN tesera_id INTEGER;

UPDATE games SET name_original = name;
