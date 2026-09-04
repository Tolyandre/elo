-- The default liquidity setting is repurposed to the user-facing risk
-- parameter: elo_settings.market_default_max_guarantor_loss holds the
-- guarantors' worst-case combined loss L (elo); markets created without an
-- explicit liquidity derive b = L/ln(n) for their n outcomes. Existing
-- markets keep their stored liquidity_b — settlement never reads this setting.
ALTER TABLE elo_settings RENAME COLUMN market_default_liquidity_b TO market_default_max_guarantor_loss;

-- 16 elo: for a typical two-target market (n = 3) this yields b ≈ 14.6,
-- for a Да/Нет market (n = 2) b ≈ 23.1.
-- SET DEFAULT only affects future inserts, and existing rows may hold the old
-- raw-b value (16) — overwrite so every settings row carries the new risk
-- parameter's default. Rollout is planned with no active markets; historical
-- closed markets are unaffected either way (settlement never reads this
-- setting, and each market keeps its own liquidity_b).
UPDATE elo_settings SET market_default_max_guarantor_loss = 16;
ALTER TABLE elo_settings ALTER COLUMN market_default_max_guarantor_loss SET DEFAULT 16;
