-- Document the settlement row semantics (ADR-21). Each row is a per-row
-- checkpoint: *_after is the player's balance after applying THIS row's
-- staked/earned deltas, so after = previous_after + staked + earned holds for
-- every row. For a market settlement a buyer∩guarantor player gets two rows
-- (discriminators 'market' and 'market_guarantor') written in that order; the
-- later row (larger id) carries the event-final balance, which is what the
-- latest-at-date reads pick up. `league` is event-level: both role rows of one
-- market carry the post-event league.

COMMENT ON COLUMN global_arena_settlement.rating_after IS
    'Display-rating balance after applying this row''s deltas (per-row checkpoint).';
COMMENT ON COLUMN global_arena_settlement.elo_after IS
    'True-Elo balance after applying this row''s deltas (per-row checkpoint).';
COMMENT ON COLUMN global_arena_settlement.rating_staked IS
    'This row''s rating risk delta (≤ 0).';
COMMENT ON COLUMN global_arena_settlement.elo_staked IS
    'This row''s Elo risk delta (≤ 0).';
COMMENT ON COLUMN global_arena_settlement.rating_earned IS
    'This row''s rating payout delta (≥ 0).';
COMMENT ON COLUMN global_arena_settlement.elo_earned IS
    'This row''s Elo payout delta (≥ 0).';
COMMENT ON COLUMN global_arena_settlement.league IS
    'Post-event league: both role rows of one market carry the same value.';

COMMENT ON COLUMN game_arena_settlement.rating_after IS
    'Display-rating balance after applying this row''s deltas (per-row checkpoint).';
COMMENT ON COLUMN game_arena_settlement.elo_after IS
    'True-Elo balance after applying this row''s deltas (per-row checkpoint).';
COMMENT ON COLUMN game_arena_settlement.rating_staked IS
    'This row''s rating risk delta (≤ 0).';
COMMENT ON COLUMN game_arena_settlement.elo_staked IS
    'This row''s Elo risk delta (≤ 0).';
COMMENT ON COLUMN game_arena_settlement.rating_earned IS
    'This row''s rating payout delta (≥ 0).';
COMMENT ON COLUMN game_arena_settlement.elo_earned IS
    'This row''s Elo payout delta (≥ 0).';
COMMENT ON COLUMN game_arena_settlement.league IS
    'League after this match settlement.';
