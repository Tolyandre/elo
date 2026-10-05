-- Game name columns: the "original" name really means the official English
-- title, and the hand-maintained display name becomes a DB-generated one.
--
-- "Оригинальное название" is the official English title — rename the column to
-- say so (the admin UI labels it "Название на английском").
ALTER TABLE games RENAME COLUMN name_original TO name_en;

-- games.name was app-maintained as COALESCE(alias, name_ru, name_original);
-- a hand-maintained copy can drift from its three sources, so it becomes a
-- generated column maintained by Postgres instead. Reads (joins, ordering)
-- keep working unchanged; writes to it are now rejected.
ALTER TABLE games DROP COLUMN name;
ALTER TABLE games
    ADD COLUMN name TEXT GENERATED ALWAYS AS (
        COALESCE(NULLIF(alias, ''), NULLIF(name_ru, ''), NULLIF(name_en, ''))
    ) STORED NOT NULL;

-- The old UNIQUE (name) column constraint dies with the column; recreate it
-- as an index on the generated column so display names stay unique.
CREATE UNIQUE INDEX games_name_unique ON games (name);
