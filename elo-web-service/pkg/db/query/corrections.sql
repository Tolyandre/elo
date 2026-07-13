-- name: CreateCorrection :one
INSERT INTO corrections (id, player_id, discriminator, diff)
VALUES ($1, $2, $3, $4) RETURNING *;

-- name: GetCorrectionsFromDate :many
SELECT * FROM corrections WHERE date >= $1 ORDER BY date ASC, id ASC;

-- name: DeleteAllSettlementsFromDate :exec
-- Single delete covering match, market, AND correction settlements.
-- Called at the start of RecalculateFrom so per-market deletes in
-- UnsettleMarketsFromDate become harmless no-ops.
DELETE FROM global_arena_settlement WHERE date >= $1;

-- name: UpsertGlobalArenaSettlementByCorrection :exec
INSERT INTO global_arena_settlement
    (player_id, date, rating_after, elo_after, discriminator, correction_id,
     elo_staked, elo_earned, rating_staked, rating_earned, league)
VALUES ($1, $2, $3, $4, 'correction', $5, 0, 0, $6, $7, $8)
ON CONFLICT (correction_id, player_id) WHERE correction_id IS NOT NULL
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

-- name: GetPlayerLatestGlobalStateBeforeCorrection :one
-- Picks the latest settlement before correction $3 for player $1 at date $2.
-- Same-date matches/markets (discriminator != 'correction') come before corrections.
-- Earlier same-date corrections (correction_id < $3) are also included.
SELECT gas.rating_after AS rating, gas.elo_after AS elo, gas.league
FROM global_arena_settlement gas
WHERE gas.player_id = $1
  AND (gas.date < $2
       OR (gas.date = $2 AND gas.discriminator != 'correction')
       OR (gas.date = $2 AND gas.discriminator = 'correction' AND gas.correction_id < $3))
ORDER BY gas.date DESC, gas.id DESC
LIMIT 1;
