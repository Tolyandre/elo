-- The guarantor max-loss cap L (ADR-20) is gone (ADR-34): every wagered elo
-- converts to liquidity, b = Σrisk/ln(n). The per-market cap and the settings
-- default that seeded it are dropped; the settlement waterfall's per-wager
-- cap at the wagered risk keeps every guarantor's maximum loss at their
-- risked amount, so nothing else has to change.

ALTER TABLE markets DROP COLUMN max_guarantor_loss;

ALTER TABLE elo_settings DROP COLUMN market_default_max_guarantor_loss;
