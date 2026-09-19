-- Bracket materialization queries (ADR-26): rounds, slots, seats, the slot
-- match series, and the recorded promotions. Standings are never stored —
-- they are derived from the linked matches' scores at read/completion time.

-- name: GetTournamentSlot :one
-- The slot plus its round coordinates (the (tournament, track, index,
-- position) address used for deterministic ordering and display) and its
-- seat count.
SELECT s.id, s.round_id, s.position, s.game_id, s.promote, s.status, s.ruling,
       r.track, r."index" AS round_index, r.tournament_id,
       (SELECT COUNT(*)::int FROM tournament_seats se WHERE se.slot_id = s.id) AS seat_count
FROM tournament_slots s
JOIN tournament_rounds r ON r.id = s.round_id
WHERE s.id = $1;

-- name: GetTournamentOfSlot :one
SELECT t.* FROM tournaments t
JOIN tournament_rounds r ON r.tournament_id = t.id
JOIN tournament_slots s ON s.round_id = r.id
WHERE s.id = $1;

-- name: ListTournamentRounds :many
SELECT * FROM tournament_rounds WHERE tournament_id = $1
ORDER BY CASE track WHEN 'winners' THEN 0 WHEN 'losers' THEN 1 ELSE 2 END, "index";

-- name: ListTournamentSlots :many
SELECT s.id, s.round_id, s.position, s.game_id, s.promote, s.status, s.ruling,
       r.track, r."index" AS round_index, r.tournament_id
FROM tournament_slots s
JOIN tournament_rounds r ON r.id = s.round_id
WHERE r.tournament_id = $1
ORDER BY CASE r.track WHEN 'winners' THEN 0 WHEN 'losers' THEN 1 ELSE 2 END,
         r."index", s.position;

-- name: ListSlotsBySource :many
-- Slots whose seats are fed by the given slot (downstream neighbours for the
-- seat refill / cascade invalidation).
SELECT DISTINCT s.id, s.round_id, s.position, s.game_id, s.promote, s.status, s.ruling,
       r.track, r."index" AS round_index, r.tournament_id
FROM tournament_slots s
JOIN tournament_seats se ON se.slot_id = s.id
JOIN tournament_rounds r ON r.id = s.round_id
WHERE se.source_slot_id = sqlc.arg('source_slot_id')::uuid
ORDER BY s.position;

-- name: AddTournamentMatch :exec
-- The tournament-membership link (ADR-26): inserted whenever the match is
-- linked to a slot, deleted whenever the match leaves the slot (detach or
-- void) — the tournament arena counts exactly the slot-linked matches.
INSERT INTO tournament_matches (tournament_id, match_id)
VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: DeleteTournamentMatch :exec
-- The match's tournament-membership row (a match belongs to at most one
-- tournament); also used by the startup-free orphan cleanup (migration 058).
DELETE FROM tournament_matches WHERE match_id = $1;

-- name: CreateTournamentRound :one
INSERT INTO tournament_rounds (id, tournament_id, track, "index")
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: CreateTournamentSlot :one
INSERT INTO tournament_slots (id, round_id, position, game_id, promote, status)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: CreateTournamentSeat :exec
INSERT INTO tournament_seats (id, slot_id, position, player_id, source_slot_id, source_place)
VALUES ($1, $2, $3, $4, $5, $6);

-- name: ListSeatsBySlots :many
SELECT * FROM tournament_seats
WHERE slot_id = ANY(sqlc.arg('slot_ids')::uuid[])
ORDER BY slot_id, position;

-- name: ListSeatsBySourceSlot :many
SELECT * FROM tournament_seats WHERE source_slot_id = sqlc.arg('source_slot_id')::uuid ORDER BY position;

-- name: SetSlotSeatsFromPromotions :exec
-- Refill the seat caches fed by a completed source slot: place i of the
-- source seats the i-th promoted player.
UPDATE tournament_seats se
SET player_id = p.player_id
FROM tournament_slot_promotions p
WHERE se.source_slot_id = p.slot_id
  AND se.source_place = p.place
  AND se.slot_id = sqlc.arg('slot_id')::uuid;

-- name: ClearSlotSeatCaches :exec
-- Invalidate the seat caches fed by a source slot whose promotion set was
-- rewritten or voided (the downstream slot re-derives on its next completion).
UPDATE tournament_seats SET player_id = NULL WHERE source_slot_id = sqlc.arg('source_slot_id')::uuid;

-- name: AddSlotMatch :exec
INSERT INTO tournament_slot_matches (slot_id, match_id)
VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: DeleteSlotMatches :exec
DELETE FROM tournament_slot_matches WHERE slot_id = $1;

-- name: DeleteSlotMatch :exec
DELETE FROM tournament_slot_matches WHERE slot_id = $1 AND match_id = $2;

-- name: SlotHasMatches :one
SELECT EXISTS(SELECT 1 FROM tournament_slot_matches WHERE slot_id = $1) AS has;

-- name: ListSlotMatchResults :many
-- The slot's match series with derived inputs for the standings: scores of
-- every linked match, in event order (date, then id — same as the arena
-- replay order).
SELECT tsm.match_id, m.date, ms.player_id, ms.score
FROM tournament_slot_matches tsm
JOIN matches m ON m.id = tsm.match_id
JOIN match_scores ms ON ms.match_id = tsm.match_id
WHERE tsm.slot_id = $1
ORDER BY m.date, tsm.match_id, ms.player_id;

-- name: ListSlotMatchesForMatchIDs :many
-- Which tournament/slot (if any) each match is counted for — the match DTO's
-- tournament badge (ADR-26).
SELECT tsm.match_id, t.id AS tournament_id, t.name AS tournament_name, tsm.slot_id
FROM tournament_slot_matches tsm
JOIN tournament_slots s ON s.id = tsm.slot_id
JOIN tournament_rounds r ON r.id = s.round_id
JOIN tournaments t ON t.id = r.tournament_id
WHERE tsm.match_id = ANY(sqlc.arg('match_ids')::uuid[]);

-- name: ListSlotPromotions :many
SELECT slot_id, player_id, place FROM tournament_slot_promotions
WHERE slot_id = $1
ORDER BY place;

-- name: SlotHasPromotions :one
SELECT EXISTS(SELECT 1 FROM tournament_slot_promotions WHERE slot_id = $1) AS has;

-- name: DeleteSlotPromotions :exec
DELETE FROM tournament_slot_promotions WHERE slot_id = $1;

-- name: AddSlotPromotion :exec
INSERT INTO tournament_slot_promotions (slot_id, player_id, place)
VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING;

-- name: SetSlotStatus :exec
UPDATE tournament_slots SET status = $2 WHERE id = $1;

-- name: SetSlotStatusAndRuling :exec
UPDATE tournament_slots SET status = $2, ruling = $3 WHERE id = $1;

-- name: SetSlotRuling :exec
UPDATE tournament_slots SET ruling = $2 WHERE id = $1;

-- name: SetSlotGame :exec
-- Organizer adjustment (ADR-26): only for slots with zero linked matches.
UPDATE tournament_slots SET game_id = $2 WHERE id = $1;

-- name: ListAcceptanceCandidates :many
-- Playing slots of running tournaments hosting the given game, in the
-- deterministic acceptance order (track, round index, table position). The
-- seated-set equality is checked by the caller (small candidate lists).
SELECT s.id, s.game_id, s.promote, s.status, s.ruling,
       r.track, r."index" AS round_index, r.tournament_id,
       (SELECT COUNT(*)::int FROM tournament_seats se WHERE se.slot_id = s.id) AS seat_count
FROM tournament_slots s
JOIN tournament_rounds r ON r.id = s.round_id
JOIN tournaments t ON t.id = r.tournament_id
WHERE t.status = 'running' AND s.status = 'playing' AND s.game_id = sqlc.arg('game_id')::uuid
ORDER BY CASE r.track WHEN 'winners' THEN 0 WHEN 'losers' THEN 1 ELSE 2 END, r."index", s.position;

-- name: CountUnresolvedSeats :one
-- Seats still waiting for their source slot (player_id IS NULL by design for
-- source seats).
SELECT COUNT(*)::int AS count FROM tournament_seats
WHERE slot_id = sqlc.arg('slot_id')::uuid AND player_id IS NULL;

-- name: ListRunningTournamentsPastDeadline :many
-- Running tournaments whose grand-final deadline has passed — the lazy
-- auto-cancel input. Completion flips status='completed' in the same tx as
-- the final promotion, so a completed tournament never appears here.
SELECT t.* FROM tournaments t
WHERE t.status = 'running'
  AND t.grand_final_deadline IS NOT NULL
  AND t.grand_final_deadline <= NOW();

-- name: DeleteSlotSeats :exec
-- Seat-count adjustment (ADR-26): the slot's seats are re-created from the
-- same seed; only callable on slots with zero linked matches.
DELETE FROM tournament_seats WHERE slot_id = $1;

-- name: ListSlotsOfTournamentByAddress :many
SELECT s.id, s.round_id, s.position, s.game_id, s.promote, s.status, s.ruling,
       r.track, r."index" AS round_index, r.tournament_id
FROM tournament_slots s
JOIN tournament_rounds r ON r.id = s.round_id
WHERE r.tournament_id = sqlc.arg('tournament_id')::uuid
ORDER BY s.id;

-- name: DeleteSlotSeat :exec
-- Drops one seat (a bye absorbed into a growing first-round table).
DELETE FROM tournament_seats WHERE slot_id = $1 AND position = $2;

-- name: UpdateSeatPlayer :exec
-- Fills one seat cache from the source slot's derived placing.
UPDATE tournament_seats SET player_id = $2 WHERE id = $1;
