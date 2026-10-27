-- games.updated_at backs the admin games list's «Недавно изменённые» sort:
-- creation sets it via the default, the trigger below bumps it on every
-- update that actually changes the row (a no-op save keeps the old stamp).
ALTER TABLE games
    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Pre-fill from the audit trail: the last audited event per game (created or
-- updated, ADR-14) is the best known "last change" instant. Games with no
-- audit rows — created before ADR-14 and untouched since — keep the default.
UPDATE games g
SET updated_at = last_change.last_change
FROM (
    SELECT entity_id, MAX(created_at) AS last_change
    FROM audit_log
    WHERE entity_type = 'game'
    GROUP BY entity_id
) AS last_change
WHERE g.id = last_change.entity_id;

CREATE FUNCTION games_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    -- `name` is a generated column (its NEW value is not computed yet in a
    -- BEFORE trigger), so the comparison spells out the writable ones. A
    -- write that changes none of them — saving the dialog without an edit —
    -- must not refresh the recency stamp.
    IF NEW.name_en IS NOT DISTINCT FROM OLD.name_en
       AND NEW.name_ru IS NOT DISTINCT FROM OLD.name_ru
       AND NEW.alias IS NOT DISTINCT FROM OLD.alias
       AND NEW.bgg_id IS NOT DISTINCT FROM OLD.bgg_id
       AND NEW.tesera_id IS NOT DISTINCT FROM OLD.tesera_id
       AND NEW.game_mode IS NOT DISTINCT FROM OLD.game_mode
       AND NEW.image_url IS NOT DISTINCT FROM OLD.image_url
       AND NEW.image_thumb_url IS NOT DISTINCT FROM OLD.image_thumb_url
    THEN
        NEW.updated_at = OLD.updated_at;
    ELSE
        NEW.updated_at = now();
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER games_updated_at
BEFORE UPDATE ON games
FOR EACH ROW EXECUTE FUNCTION games_touch_updated_at();
