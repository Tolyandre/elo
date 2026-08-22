-- N-outcome markets (ADR-11). Markets stop being binary YES/NO: every market
-- owns a set of mutually-exclusive outcomes identified by GUID
-- (market_outcomes). Bets and markets.resolution_outcome reference outcome ids;
-- outcome display names are derived on the fly (player outcome → player name,
-- 'other' → Ничья, win_streak's two fixed outcomes → «Да»/«Нет»).
--
-- match_winner markets change semantics: instead of one target player + a list
-- of required players there is a list of target players (one "player wins"
-- outcome each) plus the boolean allow_other_players (true — the old semantics:
-- every target must participate, extra players allowed; false — the match must
-- consist of exactly the target players). A player outcome wins only when that
-- player is the SOLE first-place holder; ties and non-target winners resolve
-- the 'other' outcome. Cancellation is carried by markets.status alone —
-- resolution_outcome becomes NULL for cancelled markets, so every non-null
-- value is a real outcome id (enforced by FK below).
--
-- Deploy precondition (same style as 039): NO open/betting_closed markets
-- exist. The guard below makes the migration refuse to run otherwise — the
-- yes/no bet labels of a live market cannot be remapped to outcome ids.
--
-- The data backfill lives here (not in the Go data migration) because sqlc
-- compiles queries against the schema as it exists after ALL SQL migrations:
-- the legacy columns (market_match_winner_params.target_player_id /
-- required_player_ids, markets.q_yes / q_no) and the TEXT outcome columns must
-- be dropped/retyped within this migration.
--
-- Payout preservation: bets.cost, bets.shares and global_arena_settlement are
-- never touched. Each historical bet is remapped so its win/lose status is
-- preserved — bets on the historically winning side map to the new winning
-- outcome (the sole first-place player's outcome, or 'other' on ties /
-- non-target winners); losing-side bets map to 'other' when a player outcome
-- won, and to the old target player's outcome when 'other' won (mapping them
-- to 'other' would flip losers into winners). Resolved match_winner markets
-- get starts_at = closes_at = the resolution match date so a recalculation
-- re-links the same match and reproduces the settlements byte-for-byte.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM markets WHERE status IN ('open', 'betting_closed')) THEN
        RAISE EXCEPTION 'market_outcomes migration: open/betting_closed markets exist — resolve or cancel them before deploying n-outcome markets';
    END IF;
END
$$;

-- One row per outcome. kind: 'player' (player_id set) — this target player is
-- the sole winner; 'other' — tie at first place or a non-target winner
-- (match_winner); 'yes'/'no' — the two fixed outcomes of a win_streak market.
-- q is the LMSR outstanding shares of this outcome (the AMM state vector
-- component); prices are derived from it and sum to 1.
CREATE TABLE market_outcomes (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    market_id UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    kind      TEXT NOT NULL CHECK (kind IN ('player', 'other', 'yes', 'no')),
    player_id UUID NULL REFERENCES players(id),
    q         FLOAT NOT NULL DEFAULT 0 CHECK (q >= 0),
    CONSTRAINT market_outcomes_player_kind_check
        CHECK ((kind = 'player') = (player_id IS NOT NULL))
);

CREATE INDEX market_outcomes_market_idx ON market_outcomes (market_id);
-- At most one 'other'/'yes'/'no' per market; at most one outcome per player.
CREATE UNIQUE INDEX market_outcomes_other_unique ON market_outcomes (market_id) WHERE kind = 'other';
CREATE UNIQUE INDEX market_outcomes_yes_unique ON market_outcomes (market_id) WHERE kind = 'yes';
CREATE UNIQUE INDEX market_outcomes_no_unique ON market_outcomes (market_id) WHERE kind = 'no';
CREATE UNIQUE INDEX market_outcomes_player_unique ON market_outcomes (market_id, player_id) WHERE kind = 'player';

-- match_winner params: target_player_ids = required_player_ids + the old
-- target (deduplicated); allow_other_players = TRUE preserves the old
-- semantics (all targets must participate, extra players allowed).
ALTER TABLE market_match_winner_params
    ADD COLUMN target_player_ids   UUID[]  NOT NULL DEFAULT '{}',
    ADD COLUMN allow_other_players BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE market_match_winner_params p
SET target_player_ids = r.ids
FROM (
    SELECT pp.market_id,
           array_agg(DISTINCT x ORDER BY x) AS ids
    FROM market_match_winner_params pp,
         unnest(array_append(pp.required_player_ids, pp.target_player_id)) AS x
    GROUP BY pp.market_id
) r
WHERE p.market_id = r.market_id;

-- Outcome rows for every existing market: one 'player' outcome per target plus
-- 'other' (match_winner, ties resolve there), and the Да/Нет pair (win_streak).
INSERT INTO market_outcomes (market_id, kind, player_id)
SELECT p.market_id, 'player', x
FROM market_match_winner_params p, unnest(p.target_player_ids) AS x;

INSERT INTO market_outcomes (market_id, kind)
SELECT p.market_id, 'other'
FROM market_match_winner_params p;

INSERT INTO market_outcomes (market_id, kind)
SELECT w.market_id, k
FROM market_win_streak_params w CROSS JOIN (VALUES ('yes'), ('no')) AS k;

-- Pin every resolved match_winner market's window to its resolution match
-- date: the condition semantics changed, so a wide historical window could let
-- a recalculation pick a different match; the pinned closed interval [date,
-- date] re-links exactly the match the market is currently settled with.
-- (win_streak windows are untouched — their semantics did not change and the
-- streak stats query needs the original starts_at.)
UPDATE markets m
SET starts_at = mm.date,
    closes_at = mm.date
FROM matches mm, market_match_winner_params p
WHERE p.market_id = m.id
  AND m.resolution_match_id = mm.id
  AND m.status = 'resolved';

-- Remap bets on resolved match_winner markets, preserving each bet's win/lose
-- status (see the payout-preservation note at the top).
WITH sole AS (
    -- The single player holding the strict maximum score of a match, when
    -- there is exactly one such player (ties at the top produce no row).
    SELECT match_id, player_id
    FROM (
        SELECT ms.match_id, ms.player_id,
               ms.score,
               MAX(ms.score) OVER (PARTITION BY ms.match_id) AS max_score,
               COUNT(*) OVER (PARTITION BY ms.match_id, ms.score) AS score_count
        FROM match_scores ms
    ) t
    WHERE t.score = t.max_score
      AND t.score_count = 1
),
resolved AS (
    SELECT m.id AS market_id,
           m.resolution_outcome AS old_outcome,
           other_o.id AS other_outcome,
           target_o.id AS target_outcome,
           CASE
               WHEN s.player_id IS NOT NULL
                    AND s.player_id = ANY (p.target_player_ids)
                   THEN winner_o.id
               ELSE other_o.id
           END AS new_win_outcome,
               s.player_id IS NOT NULL
               AND s.player_id = ANY (p.target_player_ids)
           AS player_won
    FROM markets m
    JOIN market_match_winner_params p ON p.market_id = m.id
    JOIN market_outcomes other_o
        ON other_o.market_id = m.id AND other_o.kind = 'other'
    JOIN market_outcomes target_o
        ON target_o.market_id = m.id AND target_o.kind = 'player'
       AND target_o.player_id = p.target_player_id
    LEFT JOIN sole s ON s.match_id = m.resolution_match_id
    LEFT JOIN market_outcomes winner_o
        ON winner_o.market_id = m.id AND winner_o.kind = 'player'
       AND winner_o.player_id = s.player_id
    WHERE m.status = 'resolved'
)
UPDATE bets b
SET outcome = CASE
    -- Historically winning side → the new winning outcome.
    WHEN r.old_outcome IN ('yes', 'no') AND b.outcome = r.old_outcome
        THEN r.new_win_outcome::text
    -- Losing side while a player outcome won → 'other' (loses).
    WHEN r.player_won
        THEN r.other_outcome::text
    -- Losing side while 'other' won (tie / non-target winner) → the old
    -- target's outcome (loses; mapping to 'other' would flip it to a win).
    ELSE r.target_outcome::text
END
FROM resolved r
WHERE b.market_id = r.market_id;

-- Cancelled match_winner markets: remap for display only (refunds depend on
-- the cost, not the outcome).
UPDATE bets b
SET outcome = CASE WHEN b.outcome = 'yes' THEN t.id::text ELSE o.id::text END
FROM markets m
JOIN market_match_winner_params p ON p.market_id = m.id
JOIN market_outcomes t
    ON t.market_id = m.id AND t.kind = 'player' AND t.player_id = p.target_player_id
JOIN market_outcomes o ON o.market_id = m.id AND o.kind = 'other'
WHERE b.market_id = m.id
  AND m.status = 'cancelled';

-- win_streak bets (no prod data, but the test database may hold some).
UPDATE bets b
SET outcome = CASE WHEN b.outcome = 'yes' THEN y.id::text ELSE n.id::text END
FROM markets m
JOIN market_outcomes y ON y.market_id = m.id AND y.kind = 'yes'
JOIN market_outcomes n ON n.market_id = m.id AND n.kind = 'no'
WHERE b.market_id = m.id
  AND m.market_type = 'win_streak';

-- resolution_outcome → the new winning outcome id.
WITH sole AS (
    SELECT match_id, player_id
    FROM (
        SELECT ms.match_id, ms.player_id,
               ms.score,
               MAX(ms.score) OVER (PARTITION BY ms.match_id) AS max_score,
               COUNT(*) OVER (PARTITION BY ms.match_id, ms.score) AS score_count
        FROM match_scores ms
    ) t
    WHERE t.score = t.max_score
      AND t.score_count = 1
),
resolved AS (
    SELECT m.id AS market_id,
           CASE
               WHEN s.player_id IS NOT NULL
                    AND s.player_id = ANY (p.target_player_ids)
                   THEN winner_o.id
               ELSE other_o.id
           END AS new_win_outcome
    FROM markets m
    JOIN market_match_winner_params p ON p.market_id = m.id
    JOIN market_outcomes other_o
        ON other_o.market_id = m.id AND other_o.kind = 'other'
    LEFT JOIN sole s ON s.match_id = m.resolution_match_id
    LEFT JOIN market_outcomes winner_o
        ON winner_o.market_id = m.id AND winner_o.kind = 'player'
       AND winner_o.player_id = s.player_id
    WHERE m.status = 'resolved'
)
UPDATE markets m
SET resolution_outcome = r.new_win_outcome::text
FROM resolved r
WHERE m.id = r.market_id;

UPDATE markets m
SET resolution_outcome = CASE m.resolution_outcome
    WHEN 'yes' THEN y.id::text
    WHEN 'no' THEN n.id::text
END
FROM market_outcomes y, market_outcomes n
WHERE y.market_id = m.id AND y.kind = 'yes'
  AND n.market_id = m.id AND n.kind = 'no'
  AND m.market_type = 'win_streak';

-- Cancellation is carried by status alone.
UPDATE markets SET resolution_outcome = NULL WHERE status = 'cancelled';

-- Seed the AMM state: q equals the outstanding share sum per outcome (the
-- invariant every n-outcome market satisfies).
UPDATE market_outcomes o
SET q = COALESCE(s.shares_sum, 0)
FROM (
    SELECT market_id, outcome, SUM(shares) AS shares_sum
    FROM bets
    GROUP BY market_id, outcome
) s
WHERE s.market_id = o.market_id
  AND s.outcome = o.id::text;

-- Legacy binary-market columns are gone: the AMM state lives in
-- market_outcomes.q, and the target set fully describes match_winner params.
ALTER TABLE market_match_winner_params
    DROP COLUMN target_player_id,
    DROP COLUMN required_player_ids;
ALTER TABLE markets
    DROP COLUMN q_yes,
    DROP COLUMN q_no;

-- All outcome references are GUIDs now; tighten the types and enforce
-- referential integrity. The ON DELETE actions exist only so cascading market
-- deletion works: outcomes are never deleted while their market lives.
ALTER TABLE bets ALTER COLUMN outcome TYPE uuid USING outcome::uuid;
ALTER TABLE bets
    ADD CONSTRAINT bets_outcome_market_outcome_fk
    FOREIGN KEY (outcome) REFERENCES market_outcomes(id) ON DELETE CASCADE;

ALTER TABLE markets ALTER COLUMN resolution_outcome TYPE uuid USING resolution_outcome::uuid;
ALTER TABLE markets
    ADD CONSTRAINT markets_resolution_outcome_fk
    FOREIGN KEY (resolution_outcome) REFERENCES market_outcomes(id) ON DELETE SET NULL;
