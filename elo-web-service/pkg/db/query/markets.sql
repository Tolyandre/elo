-- name: CreateMarket :one
INSERT INTO outcome_markets (market_type, starts_at, closes_at, created_by)
VALUES ($1, $2, $3, $4)
RETURNING id, market_type, status, starts_at, closes_at, created_by, created_at, resolved_at, resolution_match_id;

-- name: CreateMatchWinnerParams :exec
INSERT INTO outcome_market_match_winner_params (market_id, target_player_id, required_player_ids, game_id)
VALUES ($1, $2, $3, $4);

-- name: CreateWinStreakParams :exec
INSERT INTO outcome_market_win_streak_params (market_id, target_player_id, game_id, wins_required, max_losses)
VALUES ($1, $2, $3, $4, $5);

-- name: GetMarketWithPools :one
SELECT
    om.id, om.market_type, om.status, om.starts_at, om.closes_at,
    om.created_by, om.created_at, om.resolved_at, om.resolution_match_id,
    COALESCE(SUM(CASE WHEN ob.outcome = 'yes' THEN ob.amount ELSE 0 END), 0)::float8 AS yes_pool,
    COALESCE(SUM(CASE WHEN ob.outcome = 'no'  THEN ob.amount ELSE 0 END), 0)::float8 AS no_pool,
    COALESCE(mwp.target_player_id, wsp.target_player_id) AS target_player_id,
    mwp.required_player_ids,
    mwp.game_id AS mw_game_id,
    wsp.game_id AS ws_game_id,
    wsp.wins_required,
    wsp.max_losses
FROM outcome_markets om
LEFT JOIN outcome_market_match_winner_params mwp ON mwp.market_id = om.id
LEFT JOIN outcome_market_win_streak_params wsp ON wsp.market_id = om.id
LEFT JOIN outcome_bets ob ON ob.market_id = om.id
WHERE om.id = $1
GROUP BY om.id, mwp.target_player_id, mwp.required_player_ids, mwp.game_id,
         wsp.target_player_id, wsp.game_id, wsp.wins_required, wsp.max_losses;

-- name: ListMarketsWithPools :many
SELECT
    om.id, om.market_type, om.status, om.starts_at, om.closes_at,
    om.created_by, om.created_at, om.resolved_at, om.resolution_match_id,
    COALESCE(SUM(CASE WHEN ob.outcome = 'yes' THEN ob.amount ELSE 0 END), 0)::float8 AS yes_pool,
    COALESCE(SUM(CASE WHEN ob.outcome = 'no'  THEN ob.amount ELSE 0 END), 0)::float8 AS no_pool,
    COALESCE(mwp.target_player_id, wsp.target_player_id) AS target_player_id,
    mwp.required_player_ids,
    mwp.game_id AS mw_game_id,
    wsp.game_id AS ws_game_id,
    wsp.wins_required,
    wsp.max_losses
FROM outcome_markets om
LEFT JOIN outcome_market_match_winner_params mwp ON mwp.market_id = om.id
LEFT JOIN outcome_market_win_streak_params wsp ON wsp.market_id = om.id
LEFT JOIN outcome_bets ob ON ob.market_id = om.id
GROUP BY om.id, mwp.target_player_id, mwp.required_player_ids, mwp.game_id,
         wsp.target_player_id, wsp.game_id, wsp.wins_required, wsp.max_losses
ORDER BY om.created_at DESC;

-- name: GetMatchWinnerParams :one
SELECT * FROM outcome_market_match_winner_params WHERE market_id = $1;

-- name: GetWinStreakParams :one
SELECT * FROM outcome_market_win_streak_params WHERE market_id = $1;

-- name: ListOpenMatchWinnerMarkets :many
SELECT om.id, om.starts_at, om.closes_at,
    mwp.target_player_id, mwp.required_player_ids, mwp.game_id
FROM outcome_markets om
JOIN outcome_market_match_winner_params mwp ON mwp.market_id = om.id
WHERE om.status = 'open';

-- name: ListOpenWinStreakMarkets :many
SELECT om.id, om.starts_at, om.closes_at,
    wsp.target_player_id, wsp.game_id, wsp.wins_required, wsp.max_losses
FROM outcome_markets om
JOIN outcome_market_win_streak_params wsp ON wsp.market_id = om.id
WHERE om.status = 'open';

-- name: ListOverdueMatchWinnerMarkets :many
SELECT om.id, om.closes_at
FROM outcome_markets om
JOIN outcome_market_match_winner_params mwp ON mwp.market_id = om.id
WHERE om.status = 'open' AND om.closes_at <= NOW();

-- name: ListOverdueWinStreakMarkets :many
SELECT om.id, om.closes_at, om.starts_at,
    wsp.target_player_id, wsp.game_id, wsp.wins_required, wsp.max_losses
FROM outcome_markets om
JOIN outcome_market_win_streak_params wsp ON wsp.market_id = om.id
WHERE om.status = 'open' AND om.closes_at <= NOW();

-- name: GetNearestMarketExpiry :one
SELECT closes_at FROM outcome_markets
WHERE status = 'open'
ORDER BY closes_at ASC
LIMIT 1;

-- name: ResolveMarket :exec
UPDATE outcome_markets
SET status = $2, resolved_at = $3, resolution_match_id = $4
WHERE id = $1;

-- name: UnsettleMarket :exec
UPDATE outcome_markets
SET status = 'open', resolved_at = NULL, resolution_match_id = NULL
WHERE id = $1;

-- name: GetMarketsForUnsettle :many
SELECT DISTINCT om.id
FROM outcome_markets om
WHERE om.status != 'open'
  AND om.resolved_at >= $1;

-- name: InsertBet :one
INSERT INTO outcome_bets (market_id, player_id, outcome, amount)
VALUES ($1, $2, $3, $4)
RETURNING id, placed_at;

-- name: GetPlayerReservedAmount :one
SELECT COALESCE(SUM(ob.amount), 0)::float8 AS reserved
FROM outcome_bets ob
JOIN outcome_markets om ON om.id = ob.market_id
WHERE ob.player_id = $1 AND om.status = 'open';

-- name: GetBetsAggregatedByOutcome :many
SELECT player_id, outcome, SUM(amount)::float8 AS total_amount
FROM outcome_bets
WHERE market_id = $1
GROUP BY player_id, outcome
ORDER BY player_id, outcome;

-- name: GetPlayerBetsAggregatedForMarket :many
SELECT outcome, SUM(amount)::float8 AS total_amount
FROM outcome_bets
WHERE market_id = $1 AND player_id = $2
GROUP BY outcome;

-- name: InsertBetSettlementDetail :exec
INSERT INTO bet_settlement_details (market_id, player_id, staked, earned)
VALUES ($1, $2, $3, $4);

-- name: DeleteBetSettlementDetails :exec
DELETE FROM bet_settlement_details WHERE market_id = $1;

-- name: UpsertPlayerRatingByMarket :exec
INSERT INTO player_ratings (date, player_id, rating, source_type, market_id)
VALUES ($1, $2, $3, 'bet_settlement', $4)
ON CONFLICT (market_id, player_id) WHERE market_id IS NOT NULL
DO UPDATE SET rating = EXCLUDED.rating, date = EXCLUDED.date;

-- name: DeletePlayerRatingsByMarket :exec
DELETE FROM player_ratings WHERE market_id = $1;

-- name: ListMarketsByResolutionMatch :many
SELECT
    om.id, om.market_type, om.status, om.starts_at, om.closes_at,
    om.created_by, om.created_at, om.resolved_at, om.resolution_match_id,
    COALESCE(SUM(CASE WHEN ob.outcome = 'yes' THEN ob.amount ELSE 0 END), 0)::float8 AS yes_pool,
    COALESCE(SUM(CASE WHEN ob.outcome = 'no'  THEN ob.amount ELSE 0 END), 0)::float8 AS no_pool,
    COALESCE(mwp.target_player_id, wsp.target_player_id) AS target_player_id,
    mwp.required_player_ids,
    mwp.game_id AS mw_game_id,
    wsp.game_id AS ws_game_id,
    wsp.wins_required,
    wsp.max_losses
FROM outcome_markets om
LEFT JOIN outcome_market_match_winner_params mwp ON mwp.market_id = om.id
LEFT JOIN outcome_market_win_streak_params wsp ON wsp.market_id = om.id
LEFT JOIN outcome_bets ob ON ob.market_id = om.id
WHERE om.resolution_match_id = $1
GROUP BY om.id, mwp.target_player_id, mwp.required_player_ids, mwp.game_id,
         wsp.target_player_id, wsp.game_id, wsp.wins_required, wsp.max_losses;

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

-- name: DeleteMarket :exec
DELETE FROM outcome_markets WHERE id = $1;

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
    AND m.game_id = $2
    AND m.date >= $3
    AND m.date <= $4;
