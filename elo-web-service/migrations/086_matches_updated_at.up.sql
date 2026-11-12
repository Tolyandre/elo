-- matches.updated_at backs the offline match replica's incremental pull
-- (ADR-39, the design ADR-37 named): the client re-mirrors only the rows
-- whose stamp is newer than its stored cursor, instead of draining the whole
-- tenant history after every sync. Creation sets it via the default; the
-- triggers below bump it on every change that is visible through
-- GET /matches — the row itself, its per-player scores, and its camp /
-- tournament links (all served through joins).
ALTER TABLE matches
    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Pre-fill from the audit trail: the last audited event per match (created
-- or updated, ADR-14) is the best known "last change" instant. Matches with
-- no audit rows — created before ADR-14 and untouched since — keep the
-- default.
UPDATE matches m
SET updated_at = last_change.last_change
FROM (
    SELECT entity_id, MAX(created_at) AS last_change
    FROM audit_log
    WHERE entity_type = 'match'
    GROUP BY entity_id
) AS last_change
WHERE m.id = last_change.entity_id;

-- The games trigger's rule (085): a write that changes none of the writable
-- columns — saving the dialog without an edit — must not refresh the stamp.
-- The extra updated_at comparison lets the child triggers below (which do a
-- bare `SET updated_at = now()`) push a stamp through despite the guard.
CREATE FUNCTION matches_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.date IS NOT DISTINCT FROM OLD.date
       AND NEW.game_id IS NOT DISTINCT FROM OLD.game_id
       AND NEW.calculator_kind IS NOT DISTINCT FROM OLD.calculator_kind
       AND NEW.calculator_schema_version IS NOT DISTINCT FROM OLD.calculator_schema_version
       AND NEW.calculator_data IS NOT DISTINCT FROM OLD.calculator_data
       AND NEW.mode IS NOT DISTINCT FROM OLD.mode
       AND NEW.game_score IS NOT DISTINCT FROM OLD.game_score
       AND NEW.game_won IS NOT DISTINCT FROM OLD.game_won
       AND NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at
    THEN
        NEW.updated_at = OLD.updated_at;
    ELSE
        NEW.updated_at = now();
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER matches_updated_at
BEFORE UPDATE ON matches
FOR EACH ROW EXECUTE FUNCTION matches_touch_updated_at();

-- Score and link changes are visible in the match payload (the scores map
-- and the camps array / tournament slot ride along via joins), so they count
-- as match changes for the incremental cursor. Settlement rewrites are
-- deliberately NOT a match change: the replica carries no settlement
-- columns — the settlement ledger has its own change signal (the arena
-- fingerprint, ADR-39).
CREATE FUNCTION matches_touch_from_child() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE matches SET updated_at = now()
    WHERE id = COALESCE(NEW.match_id, OLD.match_id);
    RETURN NULL;
END;
$$;

CREATE TRIGGER match_scores_touch_match
AFTER INSERT OR UPDATE OR DELETE ON match_scores
FOR EACH ROW EXECUTE FUNCTION matches_touch_from_child();

CREATE TRIGGER arena_matches_touch_match
AFTER INSERT OR UPDATE OR DELETE ON arena_matches
FOR EACH ROW EXECUTE FUNCTION matches_touch_from_child();
