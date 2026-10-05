# Slot points from the Elo earn part; the minimal advance score

Amends ADR-26 (§Slot play). The placement-points scale made comebacks
arbitrary and tie situations expensive; the slot score now reuses the Elo
earn part, and the organizer gets a minimal-score gate per slot. The
"promote" vocabulary becomes "advance" throughout.

## Problem

ADR-26 scored every linked match by placement: place 1 → seats, place 2 →
seats−1, …, the last place → 1. Two problems surfaced in play:

- **Ties at the top are punishing.** With a shared top game score (a 3-seat
  table finishing 3/3/1) the co-leaders tie on points and the slot replays —
  but the third player sits a full win behind and can only catch up through
  specific outcomes of the other two. The fixed place offsets make a comeback
  a matter of luck in other players' results, not of playing well.
- **The series length is opaque.** The organizer could not say "play until
  someone reaches N points"; a replay loop only ends when a strict cut
  happens to appear.

## Decision

**Slot points are the Elo earn part (ADR-30).** Each match awards every
player their `ratingmath.NormalizedScore` share — the score surplus over the
worst score, raised to the effective `elo_settings.win_reward` (W), divided by
the summed surplus — a value in [0, 1]. No K, no D: the slot score is
relative, not a rating. The share is rounded to **one decimal per match**, and
slot points are accumulated as **integer tenths** (`bracket.PointsTenths`):
binary floats cannot represent 0.1, and the completion rule compares points
with `==`, so float accumulation would corrupt tie detection. The wire format
divides by 10 once at the API boundary.

Consequences: a 2-seat win always earns the full 1.0; a tied 3-seat top
(3/3/1) earns the co-winners 0.5 each — the loser is not stranded and catches
up match by match; the amount a win earns varies with the margin ("how good"
the win was), which is exactly the Elo earn-part semantics the arenas already
settle with. W is taken per match from `elo_settings` effective at the
match's date, so a later settings change never rewrites already-played slot
history — the same effective-dating the Elo settlements use.

**The minimal advance score (ADR-30).** A slot gains `min_score` (float,
0–10, default 0). The organizer sets it per slot after the bracket exists —
only while the slot has zero linked matches (`PATCH
/tournaments/{id}/slots/{sid}` accepts `game_id` and/or `min_score`; the
change is audited as slot-adjust op `min_score`, schema v2). The completion
rule (`bracket.StrictCut`) becomes: the top-advance set must be strictly
separated **and** the leader must hold at least `min_score` points. With the
default 0 the rule is exactly ADR-26's strict cut; a tie at the cut still
blocks completion whatever the minimum is.

**Terminology.** "Promote" reads as HR-speak; the tournament word is
"advance". Renamed throughout: the DB column `tournament_slots.promote` →
`advance`, the recorded-outcome table `tournament_slot_promotions` →
`tournament_slot_advances`, the plan document's round key `promote` →
`advance` (plan schema version 2 — `ParsePlan` is strict, so the startup data
migration rewrites stored plans; nothing else in the document changes), the
wire fields `promote`/`promoted`/`promotes` → `advance`/`advanced`/
`advances`, and the Go/TS identifiers.

## Compatibility

Standings are derived, never stored, so displayed points change with the
formula; recorded outcomes (`tournament_slot_advances`), slot statuses and
`winner_player_id` are stored and are untouched — completed tournaments keep
their champion and their match series. No recompute is triggered by the
migration itself; the new formula applies from the next recompute trigger
(match add/edit/attach/detach, ruling), where re-derivation is the
established invariant.

## Rollout

One schema migration (064: column/table renames + `min_score`), the plan
data migration in `pkg/db/migrate_data.go`, sqlc/oapi regeneration, and the
bracket UI: the slot card drops the «Партий: n» counter, shows «· до N
очков» next to the game name when a minimum is set, and lists one row per
played match (brief names + earned shares) with placeholder rows up to
⌈min_score⌉. The organizer sets the minimum per slot in the running-state
editor while the slot has no matches.
