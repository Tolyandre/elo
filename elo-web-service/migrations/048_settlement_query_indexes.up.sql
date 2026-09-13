-- Indexes for the per-player read paths (ADR-21). Nearly every settlement
-- query filters by player_id ("latest/at-date/before-match" reads, the rating
-- history, the leaderboard's latest-per-player LATERAL), but no index led with
-- player_id, so each probe scanned the whole ever-growing table. The tie-break
-- columns mirror the ORDER BY of those reads, turning them into index seeks.
CREATE INDEX global_arena_settlement_player_date_idx
    ON global_arena_settlement (player_id, date DESC, id DESC);
CREATE INDEX game_arena_settlement_player_game_idx
    ON game_arena_settlement (player_id, game_id, date DESC, match_id DESC);

-- Per-player match counts feed the league thresholds (6-month / 2-month
-- windows); the (match_id, player_id) PK only serves match-side lookups.
CREATE INDEX match_scores_player_idx ON match_scores (player_id, match_id);

-- The match list probes "does any market resolve from this match?" per row;
-- FK constraints do not create indexes on their own.
CREATE INDEX markets_resolution_match_idx
    ON markets (resolution_match_id) WHERE resolution_match_id IS NOT NULL;

-- Club membership is looked up from the player side (profile, no-club filter).
CREATE INDEX player_club_membership_player_idx ON player_club_membership (player_id);

-- Price-history replay reads a market's bets in placement order.
CREATE INDEX bets_market_placed_idx ON bets (market_id, placed_at);
