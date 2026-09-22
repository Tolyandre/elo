-- tournament_winner market type (one "player wins" outcome per tournament
-- participant; resolves when the tournament completes, refunds when it is
-- cancelled — the market has no closes_at deadline of its own).

-- The market_type check is unnamed in 041, so its auto-generated name differs
-- between databases built from the squashed baseline
-- (markets_market_type_check) and pre-squash ones
-- (outcome_markets_market_type_check): drop whichever check exists on the
-- column, then re-add under the canonical name.
DO $$
DECLARE
    con_name text;
BEGIN
    SELECT c.conname INTO con_name
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
    WHERE t.relname = 'markets'
      AND a.attname = 'market_type'
      AND c.contype = 'c';
    IF con_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE markets DROP CONSTRAINT %I', con_name);
    END IF;
END
$$;

ALTER TABLE markets
    ADD CONSTRAINT markets_market_type_check
    CHECK (market_type IN ('match_winner', 'win_streak', 'tournament_winner'));

CREATE TABLE market_tournament_winner_params (
    market_id     UUID NOT NULL PRIMARY KEY REFERENCES markets(id) ON DELETE CASCADE,
    tournament_id UUID NOT NULL REFERENCES tournaments(id)
);
