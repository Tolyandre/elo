-- Per-device hosting claim (ADR-18): the table remembers which device
-- (client token, minted per browser) last claimed hosting. Summaries carry
-- it so the same user's other devices — which see host_user_id unchanged —
-- can still step down to player/viewer mode when hosting is claimed
-- elsewhere. Empty string = legacy table, no enforcement.
ALTER TABLE game_tables
    ADD COLUMN host_client_token TEXT NOT NULL DEFAULT '';
