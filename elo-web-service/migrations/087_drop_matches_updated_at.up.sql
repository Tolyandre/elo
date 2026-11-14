-- Reverts migration 086: the matches.updated_at stamp existed solely for the
-- offline match replica's incremental pull (?updated_since=), which was
-- reverted together with the offline elo replay (ADR-38/39). 086 stays in
-- the tree (golang-migrate requires the applied versions' files), so fresh
-- databases apply it and then immediately undo it here; the IF EXISTS
-- guards make every drop idempotent either way.
DROP TRIGGER IF EXISTS match_scores_touch_match ON match_scores;
DROP TRIGGER IF EXISTS arena_matches_touch_match ON arena_matches;
DROP TRIGGER IF EXISTS matches_updated_at ON matches;
DROP FUNCTION IF EXISTS matches_touch_from_child();
DROP FUNCTION IF EXISTS matches_touch_updated_at();
ALTER TABLE matches DROP COLUMN IF EXISTS updated_at;
