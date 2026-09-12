-- Voluntary guarantors as liquidity providers (ADR-20). A guarantee is a
-- player's immutable, consent-based wager: a risk amount (their honest maximum
-- loss) and a maker fee rate in [0, 0.25]. The LMSR liquidity becomes dynamic:
-- b = min(max_guarantor_loss, SUM(risk_amount)) / ln(n), recomputed as wagers
-- arrive; prices are preserved across joins by rescaling the q vector.

ALTER TABLE markets
    ADD COLUMN max_guarantor_loss FLOAT NOT NULL DEFAULT 16;

-- Existing markets fixed b at creation as L/ln(n), so each market's L is
-- recovered as liquidity_b * ln(outcome count).
UPDATE markets m
SET max_guarantor_loss = m.liquidity_b * LN((SELECT COUNT(*) FROM market_outcomes o WHERE o.market_id = m.id));

-- liquidity_b is now dynamic: markets are created with b = 0 (no guarantors)
-- and grow as guarantees arrive.
ALTER TABLE markets ALTER COLUMN liquidity_b SET DEFAULT 0;

-- Maker fee charged on each buy (variance-proportional, ADR-20). Historical
-- bets carry no fee.
ALTER TABLE bets
    ADD COLUMN fee FLOAT NOT NULL DEFAULT 0;

CREATE TABLE market_guarantees (
    id          UUID        NOT NULL PRIMARY KEY,
    market_id   UUID        NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    player_id   UUID        NOT NULL REFERENCES players(id),
    risk_amount FLOAT       NOT NULL CHECK (risk_amount > 0),
    fee_rate    FLOAT       NOT NULL CHECK (fee_rate >= 0 AND fee_rate <= 0.25),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX market_guarantees_market_idx ON market_guarantees (market_id);

-- Migrate the designated guarantors of existing markets to equal, zero-fee
-- wagers: risk is the market's L split per guarantor, created_at backdated to
-- market creation so the chart replay and the fee-attribution window see them
-- from the start. Equal zero-fee risks reproduce the previous equal residual
-- split exactly (settlement stays replay-safe).
INSERT INTO market_guarantees (id, market_id, player_id, risk_amount, fee_rate, created_at)
SELECT gen_random_uuid(), g.market_id, g.player_id,
       m.max_guarantor_loss / c.guarantor_count,
       0,
       m.created_at
FROM market_guarantors g
JOIN markets m ON m.id = g.market_id
JOIN (
    SELECT market_id, COUNT(*) AS guarantor_count
    FROM market_guarantors
    GROUP BY market_id
) c ON c.market_id = g.market_id;

DROP TABLE market_guarantors;
