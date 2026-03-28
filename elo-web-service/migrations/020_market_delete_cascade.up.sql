-- Add ON DELETE CASCADE to outcome_bets and bet_settlement_details so that
-- deleting a market hard-deletes all its bets and settlement records.
-- player_ratings.market_id is intentionally left as RESTRICT and handled
-- explicitly in the service layer to preserve Elo chain integrity.

ALTER TABLE outcome_bets
    DROP CONSTRAINT outcome_bets_market_id_fkey;
ALTER TABLE outcome_bets
    ADD CONSTRAINT outcome_bets_market_id_fkey
        FOREIGN KEY (market_id) REFERENCES outcome_markets(id) ON DELETE CASCADE;

ALTER TABLE bet_settlement_details
    DROP CONSTRAINT bet_settlement_details_market_id_fkey;
ALTER TABLE bet_settlement_details
    ADD CONSTRAINT bet_settlement_details_market_id_fkey
        FOREIGN KEY (market_id) REFERENCES outcome_markets(id) ON DELETE CASCADE;
