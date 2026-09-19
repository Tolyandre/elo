-- Tournament queries (ADR-26). The bracket materialization has its own file
-- (tournament_brackets.sql); this one covers the entity itself: lifecycle
-- state, registration-time config, participants, and the game pool.

-- name: CreateTournament :one
-- Client-supplied id (ADR-06): the insert is an idempotent create — a replay
-- with the same id inserts nothing and the service fetches the stored row.
INSERT INTO tournaments (id, name, status, elimination, grand_final_deadline)
VALUES ($1, $2, 'registration', $3, $4)
ON CONFLICT (id) DO NOTHING
RETURNING *;

-- name: GetTournament :one
SELECT * FROM tournaments WHERE id = $1;

-- name: GetTournamentForUpdate :one
-- Row-locked variant for the lifecycle mutations (start/cancel/config): a
-- concurrent start and cancel queue behind the lock instead of racing.
SELECT * FROM tournaments WHERE id = $1 FOR UPDATE;

-- name: ListTournaments :many
-- The /tournaments list: live tournaments first, then finished ones.
SELECT * FROM tournaments
ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'registration' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END,
         name;

-- name: UpdateTournamentConfig :exec
-- Registration-time config (ADR-26): name and the optional grand-final
-- deadline. The pool and participants are managed by their own queries.
UPDATE tournaments SET name = $2, grand_final_deadline = $3 WHERE id = $1;

-- name: SetTournamentRunning :exec
-- The single start action (ADR-26): snapshot the chosen plan + seed, close
-- registration. The bracket materialization happens in the same transaction.
UPDATE tournaments
SET status = 'running', seed = $2, plan = $3, plan_schema_version = $4
WHERE id = $1;

-- name: SetTournamentCompleted :exec
-- The grand final promoted exactly one player (ADR-26): read-only from here.
UPDATE tournaments SET status = 'completed', winner_player_id = $2 WHERE id = $1;

-- name: SetTournamentStatus :exec
-- Plain transitions: cancel (organizer or grand-final deadline).
UPDATE tournaments SET status = $2 WHERE id = $1;

-- ---------------------------------------------------------------------------
-- Participants
-- ---------------------------------------------------------------------------

-- name: AddTournamentParticipant :exec
INSERT INTO tournament_participants (tournament_id, player_id)
VALUES ($1, $2)
ON CONFLICT (tournament_id, player_id) DO NOTHING;

-- name: RemoveTournamentParticipant :exec
DELETE FROM tournament_participants WHERE tournament_id = $1 AND player_id = $2;

-- name: DeleteTournamentParticipantsNotIn :exec
-- The editor's desired-set semantics (PUT /tournaments): drop everyone absent
-- from the submitted set. An empty array removes everyone.
DELETE FROM tournament_participants
WHERE tournament_id = $1 AND NOT (player_id = ANY(sqlc.arg('player_ids')::uuid[]));

-- name: ListTournamentParticipants :many
SELECT player_id, created_at
FROM tournament_participants
WHERE tournament_id = $1
ORDER BY created_at, player_id;

-- name: ListParticipantsOfTournaments :many
-- Participants of several tournaments in registration order (the list read).
SELECT tournament_id, player_id
FROM tournament_participants
WHERE tournament_id = ANY(sqlc.arg('tournament_ids')::uuid[])
ORDER BY tournament_id, created_at, player_id;

-- name: CountTournamentParticipants :one
SELECT COUNT(*)::int AS count FROM tournament_participants WHERE tournament_id = $1;

-- ---------------------------------------------------------------------------
-- Game pool
-- ---------------------------------------------------------------------------

-- name: AddTournamentGame :exec
INSERT INTO tournament_games (tournament_id, game_id, min_players, max_players)
VALUES ($1, $2, $3, $4)
ON CONFLICT (tournament_id, game_id)
DO UPDATE SET min_players = EXCLUDED.min_players, max_players = EXCLUDED.max_players;

-- name: DeleteTournamentGames :exec
-- The pool is small; the PUT handler rewrites it wholesale inside its tx.
DELETE FROM tournament_games WHERE tournament_id = $1;

-- name: ListTournamentGames :many
SELECT tournament_id, game_id, min_players, max_players
FROM tournament_games
WHERE tournament_id = $1
ORDER BY game_id;

-- name: ClearTournamentWinner :exec
-- The champion is invalidated by a post-completion bracket change (an edit
-- cascade); the tournament re-runs its final and completes again.
UPDATE tournaments SET winner_player_id = NULL WHERE id = $1;

-- name: GetTournamentPlan :one
SELECT plan, plan_schema_version, seed, status FROM tournaments WHERE id = $1;
