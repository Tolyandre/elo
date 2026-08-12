-- Share markets (Polymarket-style) with an LMSR automatic market maker +
-- player-guarantors. See ADR-10. Users buy YES/NO shares (shares-driven: the UI
-- always buys 1 share per click) at a price in (0,1) set by the LMSR cost
-- function (markets.liquidity_b / q_yes / q_no); at resolution each winning
-- share pays 1. Guarantors are the zero-sum counterparty that absorbs the
-- per-market settlement residual (deficit or surplus), recorded with
-- discriminator 'market_guarantor' so they can be shown separately from buyer
-- settlements ('market') — a player who is both buyer and guarantor gets one
-- row per role.
--
-- This migration is deployed when NO open/betting_closed markets exist: every
-- historical market is already resolved/cancelled, so the AMM columns stay at
-- their defaults for old rows and the data migration only backfills bets.shares
-- (and seeds q_yes/q_no to reflect the historical pool-implied price).

-- Shares of the outcome the user bought (the input of the purchase). `amount`
-- is the elo cost the AMM charged for them. At resolution each winning share
-- pays 1. Default 0 is a placeholder until the in-process data migration
-- backfills the historical parimutuel value.
ALTER TABLE bets ADD COLUMN shares FLOAT NOT NULL DEFAULT 0;

-- LMSR state, authoritative only while a market is open/betting_closed.
-- liquidity_b bounds the guarantors' worst-case loss to b*ln(2) per market.
ALTER TABLE markets ADD COLUMN liquidity_b FLOAT NOT NULL DEFAULT 16;
ALTER TABLE markets ADD COLUMN q_yes       FLOAT NOT NULL DEFAULT 0;
ALTER TABLE markets ADD COLUMN q_no        FLOAT NOT NULL DEFAULT 0;

-- Default liquidity parameter used when a creator does not supply one.
ALTER TABLE elo_settings ADD COLUMN market_default_liquidity_b FLOAT NOT NULL DEFAULT 16;

-- Players who back a market and split its settlement residual equally.
CREATE TABLE market_guarantors (
    market_id UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES players(id),
    PRIMARY KEY (market_id, player_id)
);

-- Guarantor payouts/losses get their own discriminator so they can be displayed
-- separately from buyer settlements (a guarantor is the house counterparty, not
-- a buyer). A player may be both buyer and guarantor on the same market (e.g.
-- the creator), so the settlement uniqueness widens from (market_id, player_id)
-- to include the discriminator: each role gets its own row, keeping the buy P&L
-- and the guarantor residual individually visible.
DROP INDEX global_arena_settlement_market_unique;

CREATE UNIQUE INDEX global_arena_settlement_market_unique
    ON global_arena_settlement (market_id, player_id, discriminator)
    WHERE market_id IS NOT NULL;

ALTER TABLE global_arena_settlement DROP CONSTRAINT global_arena_settlement_discriminator_check;
ALTER TABLE global_arena_settlement ADD CONSTRAINT global_arena_settlement_discriminator_check
    CHECK (discriminator IN ('match', 'market', 'market_guarantor', 'correction'));
