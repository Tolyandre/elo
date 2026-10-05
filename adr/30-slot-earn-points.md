# Slot points from the match margin; the minimal advance score

Amends ADR-26 (§Slot play). The placement-points scale made comebacks
arbitrary and tie situations expensive; slot points now measure each player's
margin to the match's winner, and the organizer gets a minimal-score gate per
slot. The "promote" vocabulary becomes "advance" throughout.

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

A first revision scored matches with the Elo earn part (the W-normalized
share of the score surplus, `ratingmath.NormalizedScore`) rounded to one
decimal. It fixed the fixed-offset problem, but rounding itself became a new
tie source: a near-equal finish (13/12/−4 → raw shares 0.515/0.485/0) rounds
to 0.5/0.5 — the actual winner's edge disappears, the slot that had completed
on the raw scores no longer derives, and the players must replay.

## Decision

**Slot points measure the margin to the match's leader (ADR-30).** Each match
awards a share of 1 point per player: the leader's surplus over the worst
score maps to 0.95, every other score proportionally below (`0.95 × (score −
worst) / (leader − worst)`) — and every 1st place holder (a shared top
included) adds 0.05 on top. The share is rounded to **one decimal per
match**, and slot points are accumulated as **integer tenths**
(`bracket.PointsTenths`): binary floats cannot represent 0.1, and the
completion rule compares points with `==`. The wire format divides by 10 once
at the API boundary.

The 0.95 cap plus the 0.05 first-place bonus give the scale its key property:
a strict winner always rounds to exactly 1.0 while nobody else can pass 0.9 —
**rounding can never collapse a decisive win into a tie**. The near-equal
13/12/−4 finish derives 1.0/0.9/0 and the winner keeps a visible 0.1 edge; a
genuinely shared top (3/3/1) derives 1.0/1.0/0 and the standings still tie.
All-equal scores leave nothing to separate the players: everybody is a 1st
place holder, and the bare bonus rounds to a uniform 0.1. Unlike the first
revision, no W (win reward) shapes slot points — the share is a pure
within-match margin, needs no `elo_settings` lookup, and a settings change
can never influence slot standings.

**The minimal advance score.** A slot gains `min_score` (float, 0–10,
default 0). The organizer sets it per slot after the bracket exists — only
while the slot has zero linked matches (`PATCH /tournaments/{id}/slots/{sid}`
accepts `game_id` and/or `min_score`; the change is audited as slot-adjust op
`min_score`, schema v2). The completion rule (`bracket.StrictCut`) becomes:
the top-advance set must be strictly separated **and** the leader must hold
at least `min_score` points. With the default 0 the rule is exactly ADR-26's
strict cut; a tie at the cut still blocks completion whatever the minimum is
— equal slot scores keep the slot open and require the next match, which is
now only reachable through shared tops or cumulative ties across matches.

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
their champion and their match series without any outcome-pinning migration.
No recompute is triggered by the change itself; the new formula applies from
the next recompute trigger (match add/edit/attach/detach, ruling), where
re-derivation is the established ADR-26 invariant.

## Rollout

One schema migration (064: column/table renames + `min_score`), the plan
data migration in `pkg/db/migrate_data.go`, sqlc/oapi regeneration, and the
bracket UI: the slot card drops the «Партий: n» counter, shows «· до N
очков» next to the game name when a minimum is set, and lists one row per
played match (brief names + earned shares, linked to the match page) with
placeholder rows up to ⌈min_score⌉. The organizer sets the minimum per slot
in the running-state editor while the slot has no matches.
