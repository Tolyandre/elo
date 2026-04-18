-- name: CreateMarket :one
INSERT INTO markets (market_type, starts_at, closes_at, created_by)
VALUES ($1, $2, $3, $4)
RETURNING id, market_type, status, starts_at, closes_at, created_by, created_at, resolved_at, resolution_match_id, resolution_outcome, betting_closed_at;

-- name: CreateMatchWinnerParams :exec
INSERT INTO market_match_winner_params (market_id, target_player_id, required_player_ids, game_ids)
VALUES ($1, $2, $3, $4);

-- name: CreateWinStreakParams :exec
INSERT INTO market_win_streak_params (market_id, target_player_id, game_ids, wins_required, max_losses)
VALUES ($1, $2, $3, $4, $5);

-- name: GetMarketWithPools :one
SELECT
    om.id, om.market_type, om.status, om.resolution_outcome, om.starts_at, om.closes_at,
    om.created_by, om.created_at, om.resolved_at, om.resolution_match_id, om.betting_closed_at,
    COALESCE(SUM(CASE WHEN ob.outcome = 'yes' THEN ob.amount ELSE 0 END), 0)::float8 AS yes_pool,
    COALESCE(SUM(CASE WHEN ob.outcome = 'no'  THEN ob.amount ELSE 0 END), 0)::float8 AS no_pool,
    COALESCE(mwp.target_player_id, wsp.target_player_id) AS target_player_id,
    mwp.required_player_ids,
    mwp.game_ids AS mw_game_ids,
    wsp.game_ids AS ws_game_ids,
    wsp.wins_required,
    wsp.max_losses
FROM markets om
LEFT JOIN market_match_winner_params mwp ON mwp.market_id = om.id
LEFT JOIN market_win_streak_params wsp ON wsp.market_id = om.id
LEFT JOIN bets ob ON ob.market_id = om.id
WHERE om.id = $1
GROUP BY om.id, mwp.target_player_id, mwp.required_player_ids, mwp.game_ids,
         wsp.target_player_id, wsp.game_ids, wsp.wins_required, wsp.max_losses;

-- name: ListMarketsWithPools :many
SELECT
    om.id, om.market_type, om.status, om.resolution_outcome, om.starts_at, om.closes_at,
    om.created_by, om.created_at, om.resolved_at, om.resolution_match_id, om.betting_closed_at,
    COALESCE(SUM(CASE WHEN ob.outcome = 'yes' THEN ob.amount ELSE 0 END), 0)::float8 AS yes_pool,
    COALESCE(SUM(CASE WHEN ob.outcome = 'no'  THEN ob.amount ELSE 0 END), 0)::float8 AS no_pool,
    COALESCE(mwp.target_player_id, wsp.target_player_id) AS target_player_id,
    mwp.required_player_ids,
    mwp.game_ids AS mw_game_ids,
    wsp.game_ids AS ws_game_ids,
    wsp.wins_required,
    wsp.max_losses
FROM markets om
LEFT JOIN market_match_winner_params mwp ON mwp.market_id = om.id
LEFT JOIN market_win_streak_params wsp ON wsp.market_id = om.id
LEFT JOIN bets ob ON ob.market_id = om.id
GROUP BY om.id, mwp.target_player_id, mwp.required_player_ids, mwp.game_ids,
         wsp.target_player_id, wsp.game_ids, wsp.wins_required, wsp.max_losses
ORDER BY om.created_at DESC;

-- name: GetMatchWinnerParams :one
SELECT * FROM market_match_winner_params WHERE market_id = $1;

-- name: GetWinStreakParams :one
SELECT * FROM market_win_streak_params WHERE market_id = $1;

-- name: ListOpenMatchWinnerMarkets :many
SELECT om.id, om.starts_at, om.closes_at,
    mwp.target_player_id, mwp.required_player_ids, mwp.game_ids
FROM markets om
JOIN market_match_winner_params mwp ON mwp.market_id = om.id
WHERE om.status IN ('open', 'betting_closed');

-- name: ListOpenWinStreakMarkets :many
SELECT om.id, om.starts_at, om.closes_at,
    wsp.target_player_id, wsp.game_ids, wsp.wins_required, wsp.max_losses
FROM markets om
JOIN market_win_streak_params wsp ON wsp.market_id = om.id
WHERE om.status IN ('open', 'betting_closed');

-- name: ListOverdueMatchWinnerMarkets :many
SELECT om.id, om.closes_at
FROM markets om
JOIN market_match_winner_params mwp ON mwp.market_id = om.id
WHERE om.status IN ('open', 'betting_closed') AND om.closes_at <= NOW();

-- name: ListOverdueWinStreakMarkets :many
SELECT om.id, om.closes_at, om.starts_at,
    wsp.target_player_id, wsp.game_ids, wsp.wins_required, wsp.max_losses
FROM markets om
JOIN market_win_streak_params wsp ON wsp.market_id = om.id
WHERE om.status IN ('open', 'betting_closed') AND om.closes_at <= NOW();

-- name: ListOverdueMatchWinnerMarketsAtDate :many
SELECT om.id, om.closes_at
FROM markets om
JOIN market_match_winner_params mwp ON mwp.market_id = om.id
WHERE om.status IN ('open', 'betting_closed') AND om.closes_at <= $1;

-- name: ListOverdueWinStreakMarketsAtDate :many
SELECT om.id, om.closes_at, om.starts_at,
    wsp.target_player_id, wsp.game_ids, wsp.wins_required, wsp.max_losses
FROM markets om
JOIN market_win_streak_params wsp ON wsp.market_id = om.id
WHERE om.status IN ('open', 'betting_closed') AND om.closes_at <= $1;

-- name: GetNearestMarketExpiry :one
SELECT closes_at FROM markets
WHERE status IN ('open', 'betting_closed')
ORDER BY closes_at ASC
LIMIT 1;

-- name: ResolveMarket :exec
UPDATE markets
SET status = $2, resolved_at = $3, resolution_match_id = $4, resolution_outcome = $5
WHERE id = $1;

-- name: UnsettleMarket :exec
-- Restores the pre-settlement status: betting_closed if the betting lock user event
-- was set, otherwise open. betting_closed_at is intentionally left untouched — it is
-- a user event and must never be cleared by recalculation.
UPDATE markets
SET status = CASE WHEN betting_closed_at IS NOT NULL THEN 'betting_closed' ELSE 'open' END,
    resolved_at = NULL,
    resolution_match_id = NULL,
    resolution_outcome = NULL
WHERE id = $1;

-- name: GetMarketsForUnsettle :many
SELECT DISTINCT om.id
FROM markets om
WHERE om.status IN ('resolved', 'cancelled')
  AND om.resolved_at >= $1;

-- name: GetMarketsForUnsettleWithResolvedAt :many
-- Returns resolved_at and betting_closed_at for the history conflict validation.
-- betting_closed_at is a user event timestamp — preserved even after unsettling.
SELECT id, resolved_at, betting_closed_at
FROM markets
WHERE status IN ('resolved', 'cancelled')
  AND resolved_at >= $1;

-- name: GetMarketResolvedAt :one
SELECT resolved_at FROM markets WHERE id = $1;

-- name: GetBetsOnMarketPlacedBetween :many
SELECT id, player_id, placed_at FROM bets
WHERE market_id = $1
  AND placed_at >= $2
  AND placed_at < $3;

-- name: InsertBet :one
INSERT INTO bets (market_id, player_id, outcome, amount)
VALUES ($1, $2, $3, $4)
RETURNING id, placed_at;

-- name: GetPlayerReservedAmount :one
SELECT COALESCE(SUM(ob.amount), 0)::float8 AS reserved
FROM bets ob
JOIN markets om ON om.id = ob.market_id
WHERE ob.player_id = $1 AND om.status IN ('open', 'betting_closed');

-- name: GetBetsAggregatedByOutcome :many
SELECT player_id, outcome, SUM(amount)::float8 AS total_amount
FROM bets
WHERE market_id = $1
GROUP BY player_id, outcome
ORDER BY player_id, outcome;

-- name: GetPlayerBetsAggregatedForMarket :many
SELECT outcome, SUM(amount)::float8 AS total_amount
FROM bets
WHERE market_id = $1 AND player_id = $2
GROUP BY outcome;

-- name: InsertBetSettlementDetail :exec
INSERT INTO bet_settlement_details (market_id, player_id, staked, earned)
VALUES ($1, $2, $3, $4);

-- name: DeleteBetSettlementDetails :exec
DELETE FROM bet_settlement_details WHERE market_id = $1;

-- name: UpsertPlayerRatingByMarket :exec
INSERT INTO player_ratings (date, player_id, rating, source_type, market_id)
VALUES ($1, $2, $3, 'market_settlement', $4)
ON CONFLICT (market_id, player_id) WHERE market_id IS NOT NULL
DO UPDATE SET rating = EXCLUDED.rating, date = EXCLUDED.date;

-- name: DeletePlayerRatingsByMarket :exec
DELETE FROM player_ratings WHERE market_id = $1;

-- name: ListMarketsByResolutionMatch :many
SELECT
    om.id, om.market_type, om.status, om.resolution_outcome, om.starts_at, om.closes_at,
    om.created_by, om.created_at, om.resolved_at, om.resolution_match_id, om.betting_closed_at,
    COALESCE(SUM(CASE WHEN ob.outcome = 'yes' THEN ob.amount ELSE 0 END), 0)::float8 AS yes_pool,
    COALESCE(SUM(CASE WHEN ob.outcome = 'no'  THEN ob.amount ELSE 0 END), 0)::float8 AS no_pool,
    COALESCE(mwp.target_player_id, wsp.target_player_id) AS target_player_id,
    mwp.required_player_ids,
    mwp.game_ids AS mw_game_ids,
    wsp.game_ids AS ws_game_ids,
    wsp.wins_required,
    wsp.max_losses
FROM markets om
LEFT JOIN market_match_winner_params mwp ON mwp.market_id = om.id
LEFT JOIN market_win_streak_params wsp ON wsp.market_id = om.id
LEFT JOIN bets ob ON ob.market_id = om.id
WHERE om.resolution_match_id = $1
GROUP BY om.id, mwp.target_player_id, mwp.required_player_ids, mwp.game_ids,
         wsp.target_player_id, wsp.game_ids, wsp.wins_required, wsp.max_losses;

-- name: GetSettlementDetails :many
SELECT bsd.player_id, p.name AS player_name, bsd.staked, bsd.earned
FROM bet_settlement_details bsd
JOIN players p ON p.id = bsd.player_id
WHERE bsd.market_id = $1
ORDER BY (bsd.earned - bsd.staked) DESC;

-- name: GetPlayerBetLimit :one
SELECT bet_limit FROM players WHERE id = $1;

-- name: UpdatePlayerBetLimit :exec
UPDATE players SET bet_limit = $2 WHERE id = $1;

-- name: LockMarketBetting :exec
-- Sets status = 'betting_closed' and records the betting_closed_at timestamp (user event).
-- Only succeeds if current status = 'open'; the caller must check affected rows or
-- fetch the market first to return a proper domain error.
UPDATE markets
SET status = 'betting_closed',
    betting_closed_at = NOW()
WHERE id = $1 AND status = 'open';

-- name: DeleteMarket :exec
DELETE FROM markets WHERE id = $1;

-- name: GetPlayerStreakStats :one
SELECT
    COUNT(CASE WHEN ms.score = max_scores.max_score THEN 1 END)::int AS wins,
    COUNT(CASE WHEN ms.score < max_scores.max_score THEN 1 END)::int AS losses
FROM match_scores ms
JOIN matches m ON m.id = ms.match_id
JOIN (
    SELECT match_id, MAX(score) AS max_score
    FROM match_scores
    GROUP BY match_id
) max_scores ON max_scores.match_id = ms.match_id
WHERE ms.player_id = $1
    AND m.game_id = ANY($2::int[])
    AND m.date >= $3
    AND m.date <= $4;
