-- Rename bets.amount → bets.cost. After the ADR-10 redesign a bet stores the
-- `shares` bought plus the elo the AMM charged for them; `amount` was ambiguous
-- (amount of what — elo? shares?). `cost` matches the domain vocabulary ("the
-- elo cost the AMM charged") and aggregates into the API's per-player `staked`.
-- Column rename only — no data or type change; the amount > 0 CHECK follows the
-- rename automatically.
ALTER TABLE bets RENAME COLUMN amount TO cost;
