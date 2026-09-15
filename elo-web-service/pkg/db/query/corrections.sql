-- name: CreateCorrection :one
INSERT INTO corrections (id, player_id, discriminator, diff)
VALUES ($1, $2, $3, $4) RETURNING *;

-- name: GetCorrectionsFromDate :many
SELECT * FROM corrections WHERE date >= $1 ORDER BY date ASC, id ASC;

-- name: DeleteGlobalSettlementsFromDate :exec
-- Single delete covering match, market, AND correction settlements of the
-- global arena (the only arena markets and corrections touch).
-- Called at the start of RecalculateFrom so per-market deletes in
-- UnsettleMarketsFromDate become harmless no-ops.
DELETE FROM arena_settlements
WHERE arena_id = 'a2ea0000-0000-0000-0000-000000000001' AND date >= $1;

-- name: UpsertArenaSettlementByCorrection :exec
INSERT INTO arena_settlements
    (id, arena_id, player_id, date, rating_after, elo_after, discriminator, correction_id,
     elo_staked, elo_earned, rating_staked, rating_earned, league)
VALUES ($1, $2, $3, $4, $5, $6, 'correction', $7, 0, 0, $8, $9, $10)
ON CONFLICT (arena_id, correction_id, player_id) WHERE correction_id IS NOT NULL
DO UPDATE SET rating_after  = EXCLUDED.rating_after,
              elo_after     = EXCLUDED.elo_after,
              date          = EXCLUDED.date,
              rating_staked = EXCLUDED.rating_staked,
              rating_earned = EXCLUDED.rating_earned,
              league        = EXCLUDED.league;

-- name: ListCorrectionsPaginated :many
SELECT c.id, c.player_id, c.diff, c.date, p.name AS player_name
FROM corrections c
JOIN players p ON p.id = c.player_id
WHERE
  (sqlc.narg('player_id')::uuid IS NULL OR c.player_id = sqlc.narg('player_id')::uuid)
  AND (
    sqlc.narg('cursor_date')::timestamptz IS NULL
    OR c.date < sqlc.narg('cursor_date')::timestamptz
  )
  AND (
    sqlc.narg('club_id')::uuid IS NULL
    OR EXISTS (
      SELECT 1 FROM player_club_membership pcm
      WHERE pcm.club_id = sqlc.narg('club_id')::uuid
        AND pcm.player_id = c.player_id
    )
  )
  AND (
    sqlc.narg('no_club')::bool IS NOT TRUE
    OR NOT EXISTS (
      SELECT 1 FROM player_club_membership pcm2
      WHERE pcm2.player_id = c.player_id
    )
  )
ORDER BY c.date DESC, c.id DESC
LIMIT sqlc.arg('limit')::int4;

-- name: GetPlayerLatestArenaStateBeforeCorrection :one
-- Picks the latest settlement before correction $4 for player $2 at date $3
-- in arena $1. Same-date matches/markets (discriminator != 'correction') come
-- before corrections. Earlier same-date corrections (correction_id < $4) are
-- also included.
SELECT gas.rating_after AS rating, gas.elo_after AS elo, gas.league
FROM arena_settlements gas
WHERE gas.arena_id = $1
  AND gas.player_id = $2
  AND (gas.date < $3
       OR (gas.date = $3 AND gas.discriminator != 'correction')
       OR (gas.date = $3 AND gas.discriminator = 'correction' AND gas.correction_id < $4))
ORDER BY gas.date DESC, gas.id DESC
LIMIT 1;

-- name: CountCorrectionsFromDate :one
SELECT COUNT(*) AS count
FROM corrections
WHERE date >= $1;
