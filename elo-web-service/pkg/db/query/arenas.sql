-- Arena queries (ADR-24, ADR-27). The "does this match belong to this arena"
-- condition — camp link, or the filter (date range, game OR tag) — has ONE
-- canonical definition: the arena_contains_match() function created by
-- migration 054_arena_contains_match.up.sql (see adr/28-arena-membership-function.md).
-- The queries below call it; never inline the condition back.

-- The read queries share one 15-column projection (arena row + its filter
-- columns). Keep the column list identical across them: pkg/elo/arena_rows_test.go
-- asserts the generated row structs stay field-identical.

-- name: GetArena :one
SELECT a.id, a.name, a.settings, a.settings_schema_version,
       a.game_id, a.tournament_id, a.recalc_from, a.stale_at,
       a.camp, a.starts_at, a.ends_at,
       f.date_from, f.date_to,
       f.game_ids AS filter_game_ids, f.tag_ids AS filter_tag_ids
FROM arenas a
LEFT JOIN match_filters f ON f.id = a.match_filter_id
WHERE a.id = $1;

-- name: GetArenaForUpdate :one
-- Row-locked variant used by the recalculation updater: concurrent dirty marks
-- queue behind the lock and apply after the recalculation commits.
SELECT a.id, a.name, a.settings, a.settings_schema_version,
       a.game_id, a.tournament_id, a.recalc_from, a.stale_at,
       a.camp, a.starts_at, a.ends_at,
       f.date_from, f.date_to,
       f.game_ids AS filter_game_ids, f.tag_ids AS filter_tag_ids
FROM arenas a
LEFT JOIN match_filters f ON f.id = a.match_filter_id
WHERE a.id = $1
FOR UPDATE OF a;

-- kind narrows the list for the /arenas page tabs: 'games' returns every
-- user-managed arena except camps and the global one (the main page, not a
-- list entry); 'camps' returns only camp arenas; 'tournaments' returns only
-- the tournament arenas (empty until ADR-26 creates them).
-- name: ListArenas :many
SELECT a.id, a.name, a.settings, a.settings_schema_version,
       a.game_id, a.tournament_id, a.recalc_from, a.stale_at,
       a.camp, a.starts_at, a.ends_at,
       f.date_from, f.date_to,
       f.game_ids AS filter_game_ids, f.tag_ids AS filter_tag_ids,
       -- Camp participants are derived, never stored (ADR-27): every player
       -- with a settlement row in the arena. Empty for non-camps.
       CASE WHEN a.camp THEN (
           SELECT COALESCE(array_agg(DISTINCT s.player_id), '{}'::uuid[])
           FROM arena_settlements s WHERE s.arena_id = a.id
       ) ELSE '{}'::uuid[] END AS camp_player_ids,
       (
           SELECT COUNT(*) FROM matches m
           WHERE arena_contains_match(a.id, m.id)
       ) AS matches_count
FROM arenas a
LEFT JOIN match_filters f ON f.id = a.match_filter_id
WHERE (
    sqlc.narg('kind')::text IS NULL
    OR (sqlc.narg('kind')::text = 'tournaments' AND a.tournament_id IS NOT NULL)
    OR (sqlc.narg('kind')::text = 'camps' AND a.camp)
    OR (sqlc.narg('kind')::text = 'games' AND NOT a.camp
        AND a.tournament_id IS NULL
        AND a.id <> 'a2ea0000-0000-0000-0000-000000000001'
        AND NOT (
            coalesce(cardinality(f.game_ids), 0) = 0
            AND coalesce(cardinality(f.tag_ids), 0) = 0
            AND f.date_from IS NULL
            AND f.date_to IS NULL
        ))
)
ORDER BY a.name;

-- name: ListArenasForGame :many
-- Arenas whose filter includes game @game_id or one of its tags, plus
-- unconditional (global) arenas — the /games page arena list. Camp arenas
-- have no filter and never appear here.
SELECT a.id, a.name, a.settings, a.settings_schema_version,
       a.game_id, a.tournament_id, a.recalc_from, a.stale_at,
       a.camp, a.starts_at, a.ends_at,
       f.date_from, f.date_to,
       f.game_ids AS filter_game_ids, f.tag_ids AS filter_tag_ids
FROM arenas a
LEFT JOIN match_filters f ON f.id = a.match_filter_id
WHERE a.game_id = sqlc.arg('game_id')
   OR (
       NOT a.camp
       AND coalesce(cardinality(f.game_ids), 0) = 0
       AND coalesce(cardinality(f.tag_ids), 0) = 0
       AND f.date_from IS NULL
       AND f.date_to IS NULL
   )
   OR f.game_ids @> ARRAY[sqlc.arg('game_id')]
   OR EXISTS (
       SELECT 1 FROM game_tag gt
       WHERE gt.game_id = sqlc.arg('game_id') AND gt.tag_id = ANY(f.tag_ids)
   )
ORDER BY a.name;

-- name: GetArenaByGame :one
SELECT a.id, a.name, a.settings, a.settings_schema_version,
       a.game_id, a.tournament_id, a.recalc_from, a.stale_at,
       a.camp, a.starts_at, a.ends_at,
       f.date_from, f.date_to,
       f.game_ids AS filter_game_ids, f.tag_ids AS filter_tag_ids
FROM arenas a
LEFT JOIN match_filters f ON f.id = a.match_filter_id
WHERE a.game_id = $1;

-- name: GetArenaByTournament :one
-- Auto-managed bracket-tournament arenas (ADR-24 anchor, reused by ADR-26);
-- empty until ADR-26 creates them.
SELECT a.id, a.name, a.settings, a.settings_schema_version,
       a.game_id, a.tournament_id, a.recalc_from, a.stale_at,
       a.camp, a.starts_at, a.ends_at,
       f.date_from, f.date_to,
       f.game_ids AS filter_game_ids, f.tag_ids AS filter_tag_ids
FROM arenas a
LEFT JOIN match_filters f ON f.id = a.match_filter_id
WHERE a.tournament_id = $1;

-- name: CreateMatchFilter :one
INSERT INTO match_filters (id, date_from, date_to, game_ids, tag_ids)
VALUES ($1, $2, $3, $4, $5)
RETURNING id;

-- name: CreateArena :one
INSERT INTO arenas (id, name, match_filter_id, settings, settings_schema_version, game_id, tournament_id, camp, starts_at, ends_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING *;

-- name: UpdateArena :one
UPDATE arenas
SET name = $2, match_filter_id = $3, settings = $4, settings_schema_version = $5,
    camp = $6, starts_at = $7, ends_at = $8
WHERE id = $1
RETURNING *;

-- name: UpdateArenaName :exec
-- Name sync for auto-managed arenas when their game is renamed.
UPDATE arenas SET name = $2 WHERE id = $1;

-- name: ArenaNameExists :one
-- Uniqueness guard for the user-facing arena CRUD (case-insensitive).
-- @exclude_id skips the arena being updated; NULL on create.
SELECT EXISTS(
    SELECT 1 FROM arenas
    WHERE lower(name) = lower(sqlc.arg('name')::text)
      AND (sqlc.narg('exclude_id')::uuid IS NULL OR id <> sqlc.narg('exclude_id')::uuid)
) AS exists;

-- name: DeleteArena :one
-- Returns the deleted row so the audit trail can capture the name.
DELETE FROM arenas WHERE id = $1
RETURNING id, name;

-- name: ListArenasMatchingMatch :many
-- Arena ids containing the given match per the membership function — part of
-- the synchronous-drain affected set on match writes. Camps are included via
-- their camp_matches links (the match must already be linked when this runs).
SELECT a.id
FROM arenas a
WHERE arena_contains_match(a.id, sqlc.arg('match_id'));

-- name: ListTagFilteredArenaIds :many
-- Arenas whose filter has a game-tag condition — the conservative mark set
-- when any game's tags change (a tag toggle can flip any of them).
SELECT a.id
FROM arenas a
JOIN match_filters f ON f.id = a.match_filter_id
WHERE coalesce(cardinality(f.tag_ids), 0) > 0;

-- ---------------------------------------------------------------------------
-- Dirty queue
-- ---------------------------------------------------------------------------

-- name: MarkArenasStaleFull :exec
UPDATE arenas
SET stale_at = NOW(), recalc_from = NULL
WHERE id = ANY(sqlc.arg('arena_ids')::uuid[]);

-- name: MarkArenasStaleFromDate :exec
-- Incremental mark: widen the pending replay window to include @from_date.
-- A pending full recalc (recalc_from IS NULL while stale) wins over dates.
UPDATE arenas
SET stale_at = NOW(),
    recalc_from = CASE
        WHEN arenas.stale_at IS NOT NULL AND arenas.recalc_from IS NULL THEN NULL
        WHEN arenas.recalc_from IS NULL THEN sqlc.arg('from_date')::timestamptz
        ELSE least(arenas.recalc_from, sqlc.arg('from_date')::timestamptz)
    END
WHERE id = ANY(sqlc.arg('arena_ids')::uuid[]);

-- name: ListStaleArenas :many
SELECT a.id, a.name, a.settings, a.settings_schema_version,
       a.game_id, a.tournament_id, a.recalc_from, a.stale_at,
       a.camp, a.starts_at, a.ends_at,
       f.date_from, f.date_to,
       f.game_ids AS filter_game_ids, f.tag_ids AS filter_tag_ids
FROM arenas a
LEFT JOIN match_filters f ON f.id = a.match_filter_id
WHERE a.stale_at IS NOT NULL AND a.stale_at <= sqlc.arg('due_before')::timestamptz
ORDER BY a.stale_at;

-- name: ClearArenaStale :exec
-- Conditional clear: stale_at must still be the mark the recalculation
-- started from; a re-mark during the run leaves the arena stale (staleness
-- cancellation, ADR-24).
UPDATE arenas
SET stale_at = NULL, recalc_from = NULL
WHERE id = $1 AND stale_at = $2;

-- ---------------------------------------------------------------------------
-- Precalculated stats
-- ---------------------------------------------------------------------------

-- name: DeleteArenaStats :exec
DELETE FROM arena_player_stats WHERE arena_id = $1;

-- name: InsertArenaStats :exec
-- Recompute places 1..4 per match (RANK over the match's scores) for every
-- match belonging to the arena: via camp_matches links for camps, via the
-- filter for every other kind.
INSERT INTO arena_player_stats (arena_id, player_id, matches_count,
                                first_count, second_count, third_count, fourth_count)
SELECT sqlc.arg('arena_id'), r.player_id, COUNT(*)::int,
       COUNT(*) FILTER (WHERE r.place = 1)::int,
       COUNT(*) FILTER (WHERE r.place = 2)::int,
       COUNT(*) FILTER (WHERE r.place = 3)::int,
       COUNT(*) FILTER (WHERE r.place = 4)::int
FROM (
    SELECT ms.player_id,
           RANK() OVER (PARTITION BY ms.match_id ORDER BY ms.score DESC) AS place
    FROM match_scores ms
    WHERE ms.match_id IN (
        SELECT m.id
        FROM matches m
        WHERE arena_contains_match(sqlc.arg('arena_id'), m.id)
    )
) r
GROUP BY r.player_id;

-- ---------------------------------------------------------------------------
-- Arena page reads
-- ---------------------------------------------------------------------------

-- name: ListArenaPlayers :many
-- Latest settlement state joined with the precalculated stats. Final ranking
-- (league priority, then rating) is applied by the service.
SELECT p.id AS player_id, p.name AS player_name,
       -- CASE forces sqlc to infer a nullable type: a player whose latest
       -- settlement is after  (or who has none yet) yields a NULL row.
       CASE WHEN latest.rating_after IS NULL THEN NULL ELSE latest.rating_after END AS rating_after,
       CASE WHEN latest.elo_after IS NULL THEN NULL ELSE latest.elo_after END AS elo_after,
       latest.league,
       st.matches_count, st.first_count, st.second_count, st.third_count, st.fourth_count
FROM arena_player_stats st
JOIN players p ON p.id = st.player_id
LEFT JOIN LATERAL (
    SELECT s.rating_after, s.elo_after, s.league
    FROM arena_settlements s
    WHERE s.arena_id = st.arena_id AND s.player_id = st.player_id
    ORDER BY s.date DESC, s.id DESC
    LIMIT 1
) latest ON true
WHERE st.arena_id = sqlc.arg('arena_id')
ORDER BY p.name;

-- name: ListArenaMatchesPaginated :many
-- Cursor-paginated match list of one arena, same envelope as /matches.
-- Optional player/club/game filters mirror /matches; the cursor token carries
-- them, so continuation requests pass only the token.
WITH paginated_matches AS (
    SELECT DISTINCT m.id, m.date, m.game_id, m.calculator_kind
    FROM matches m
    JOIN match_scores ms ON ms.match_id = m.id
    WHERE arena_contains_match(sqlc.arg('arena_id'), m.id)
      AND (
          sqlc.narg('cursor_date')::timestamptz IS NULL
          OR m.date < sqlc.narg('cursor_date')::timestamptz
      )
      AND (
          sqlc.narg('player_id')::uuid IS NULL OR ms.player_id = sqlc.narg('player_id')::uuid
      )
      AND (
          sqlc.narg('club_id')::uuid IS NULL
          OR EXISTS (
              SELECT 1 FROM player_club_membership pcm
              WHERE pcm.club_id = sqlc.narg('club_id')::uuid
                AND pcm.player_id = ms.player_id
          )
      )
      AND (
          sqlc.narg('game_id')::uuid IS NULL OR m.game_id = sqlc.narg('game_id')::uuid
      )
    ORDER BY m.date DESC, m.id DESC
    LIMIT sqlc.arg('limit')::int4
)
SELECT
    pm.id AS match_id,
    pm.date,
    g.id AS game_id,
    g.name AS game_name,
    pm.calculator_kind AS calculator_kind,
    p.id AS player_id,
    p.name AS player_name,
    s.score,
    ars.rating_staked,
    ars.rating_earned,
    CASE WHEN ars.rating_after IS NULL THEN NULL ELSE ars.rating_after END AS rating_after,
    CASE WHEN prev_rating.rating_after IS NULL THEN NULL ELSE prev_rating.rating_after END AS prev_rating,
    EXISTS(SELECT 1 FROM markets WHERE resolution_match_id = pm.id) AS has_markets
FROM paginated_matches pm
JOIN games g ON g.id = pm.game_id
JOIN match_scores s ON s.match_id = pm.id
JOIN players p ON p.id = s.player_id
LEFT JOIN arena_settlements ars ON ars.arena_id = sqlc.arg('arena_id')
    AND ars.match_id = s.match_id AND ars.player_id = s.player_id AND ars.discriminator = 'match'
LEFT JOIN LATERAL (
    SELECT ars2.rating_after
    FROM arena_settlements ars2
    WHERE ars2.arena_id = sqlc.arg('arena_id') AND ars2.player_id = p.id AND ars2.date < pm.date
    ORDER BY ars2.date DESC, ars2.id DESC
    LIMIT 1
) prev_rating ON true
ORDER BY pm.date DESC, pm.id DESC, s.score DESC;

-- name: CountPlayerMatchesInArenaInPeriod :one
-- Matches of one player inside the arena (per the membership function) within
-- [date_from, date_to] — the elite promotion counters. Camp arenas have no
-- leagues, so the counters are never consulted for them.
SELECT COUNT(*)::int AS count
FROM matches m
JOIN match_scores ms ON ms.match_id = m.id
WHERE ms.player_id = sqlc.arg('player_id')
  AND m.date >= sqlc.arg('date_from')::timestamptz
  AND m.date <= sqlc.arg('date_to')::timestamptz
  AND arena_contains_match(sqlc.arg('arena_id'), m.id);

-- name: ListMatchesForArenaReplay :many
-- Matches of the arena from @from_date on, in event order — the updater's
-- replay input. The membership function selects camp-linked matches for camp
-- arenas and filter matches for every other kind (one replay source, ADR-28).
SELECT m.*
FROM matches m
WHERE m.date >= sqlc.arg('from_date')::timestamptz
  AND arena_contains_match(sqlc.arg('arena_id')::uuid, m.id)
ORDER BY m.date ASC, m.id ASC;

-- name: ListArenaPlayersAt :many
-- Point-in-time standings of one arena (for rank-change history): the latest
-- settlement at or before @at, plus the arena-filtered match counts the elite
-- staleness check needs. Lists players with at least one settlement.
SELECT p.id AS player_id, p.name AS player_name,
       -- CASE forces sqlc to infer a nullable type: a player whose latest
       -- settlement is after @at (or who has none yet) yields a NULL row.
       CASE WHEN latest.rating_after IS NULL THEN NULL ELSE latest.rating_after END AS rating_after,
       CASE WHEN latest.elo_after IS NULL THEN NULL ELSE latest.elo_after END AS elo_after,
       latest.league,
       COALESCE(cnt60.cnt, 0) AS cnt_60, COALESCE(cnt180.cnt, 0) AS cnt_180
FROM players p
JOIN LATERAL (
    SELECT 1 FROM arena_settlements s WHERE s.arena_id = $1 AND s.player_id = p.id LIMIT 1
) has_settlement ON true
LEFT JOIN LATERAL (
    SELECT s.rating_after, s.elo_after, s.league
    FROM arena_settlements s
    WHERE s.arena_id = $1 AND s.player_id = p.id AND s.date <= $2
    ORDER BY s.date DESC, s.id DESC
    LIMIT 1
) latest ON true
LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS cnt
    FROM matches m
    JOIN match_scores ms ON ms.match_id = m.id
    WHERE ms.player_id = p.id
      AND m.date >= ($2 - interval '60 days') AND m.date <= $2
      AND arena_contains_match($1, m.id)
) cnt60 ON true
LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS cnt
    FROM matches m
    JOIN match_scores ms ON ms.match_id = m.id
    WHERE ms.player_id = p.id
      AND m.date >= ($2 - interval '180 days') AND m.date <= $2
      AND arena_contains_match($1, m.id)
) cnt180 ON true
ORDER BY p.name;
