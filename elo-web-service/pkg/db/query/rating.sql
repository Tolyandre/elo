-- Arena settlement queries (ADR-24). Every query is arena-scoped; callers
-- working with «Синие люди»'s main arena pass elo.BlueMenArenaID. The arena
-- is seeded by migration 051 with the well-known id below; since ADR-36 phase
-- 2 the display reads in matches.sql, players.sql and player_ranks.sql take
-- the arena as a parameter, and since migration 068 the arena itself is
-- «Синие люди»'s main arena.

-- name: UpsertArenaSettlementByMatch :exec
INSERT INTO arena_settlements
    (id, arena_id, player_id, date, rating_after, elo_after, discriminator, match_id,
     elo_staked, elo_earned, rating_staked, rating_earned, league)
VALUES ($1, $2, $3, $4, $5, $6, 'match', $7, $8, $9, $10, $11, $12)
ON CONFLICT (arena_id, match_id, player_id) WHERE match_id IS NOT NULL
DO UPDATE SET rating_after  = EXCLUDED.rating_after,
              elo_after     = EXCLUDED.elo_after,
              date          = EXCLUDED.date,
              elo_staked    = EXCLUDED.elo_staked,
              elo_earned    = EXCLUDED.elo_earned,
              rating_staked = EXCLUDED.rating_staked,
              rating_earned = EXCLUDED.rating_earned,
              league        = EXCLUDED.league;

-- name: DeleteArenaSettlementsFromDate :exec
-- Replay support for the arena updater: removes the arena's MATCH settlement
-- rows from the date on — the replay re-settles matches only. Market rows
-- belong to their own lifecycle (they re-settle via the unsettle/re-resolve
-- sweep in RecalculateFrom, per-market in the owning tenant's arena) and must
-- survive an arena replay.
DELETE FROM arena_settlements
WHERE arena_id = $1 AND date >= $2 AND discriminator = 'match';

-- name: GetPlayerLatestArenaElo :one
-- Returns the true Elo value (elo_after) for Elo calculations.
SELECT s.elo_after AS rating
FROM arena_settlements s
WHERE s.arena_id = $1 AND s.player_id = $2
ORDER BY s.date DESC, s.id DESC
LIMIT 1;

-- name: GetPlayerLatestArenaEloAtDate :one
SELECT s.elo_after AS rating
FROM arena_settlements s
WHERE s.arena_id = $1 AND s.player_id = $2 AND s.date <= $3
ORDER BY s.date DESC, s.id DESC
LIMIT 1;

-- name: GetPlayerLatestArenaEloBeforeMatch :one
SELECT s.elo_after AS rating
FROM arena_settlements s
WHERE s.arena_id = $1 AND s.player_id = $2
  AND (s.date < $3 OR (s.date = $3 AND s.match_id IS NOT NULL AND s.match_id < $4))
ORDER BY s.date DESC, s.id DESC
LIMIT 1;

-- name: GetPlayerLatestArenaRating :one
-- Returns the display rating (rating_after) and current league for
-- rating-track calculations.
SELECT s.rating_after AS rating, s.league
FROM arena_settlements s
WHERE s.arena_id = $1 AND s.player_id = $2
ORDER BY s.date DESC, s.id DESC
LIMIT 1;

-- name: GetPlayerLatestArenaRatingAtDate :one
SELECT s.rating_after AS rating, s.league
FROM arena_settlements s
WHERE s.arena_id = $1 AND s.player_id = $2 AND s.date <= $3
ORDER BY s.date DESC, s.id DESC
LIMIT 1;

-- name: GetPlayerLatestArenaRatingBeforeMatch :one
SELECT s.rating_after AS rating, s.league
FROM arena_settlements s
WHERE s.arena_id = $1 AND s.player_id = $2
  AND (s.date < $3 OR (s.date = $3 AND s.match_id IS NOT NULL AND s.match_id < $4))
ORDER BY s.date DESC, s.id DESC
LIMIT 1;

-- name: ListLatestArenaStatePerPlayer :many
-- The current state (latest settlement row) of every player in the arena.
-- Used to diff the state before and after a full recalculation replay.
SELECT DISTINCT ON (s.player_id)
  s.player_id,
  p.name AS player_name,
  s.rating_after,
  s.elo_after,
  s.league
FROM arena_settlements s
JOIN players p ON p.id = s.player_id
WHERE s.arena_id = $1
ORDER BY s.player_id, s.date DESC, s.id DESC;

-- name: ArenaRatingHistory :many
-- Returns rating_after and elo_after ordered by date for the player graph.
SELECT s.date, s.rating_after AS rating, s.elo_after AS elo
FROM arena_settlements s
WHERE s.arena_id = $1 AND s.player_id = $2
ORDER BY s.date;

-- name: DeleteSweepArenaSettlementsFromDate :exec
-- Single delete covering match AND market settlements of «Синие люди»'s main
-- arena (the settlement sweep's anchor — ADR-36). Other clubs' market rows are
-- removed by the per-market deletes in UnsettleMarketsFromDate, in each
-- market's own arena. Called at the start of RecalculateFrom.
DELETE FROM arena_settlements
WHERE arena_id = 'a2ea0000-0000-0000-0000-000000000001' AND date >= $1;
