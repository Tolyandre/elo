# Game modes: competitive, coop/solo, mixed

Extends ADR-24 (arenas), ADR-28 (arena membership), ADR-32 (the home feed).
Not every game at the table is a rating event: cooperative and solo games have
no per-player ranking to normalize, so recording them as competitive matches
was impossible — and bolting them into the Elo pipeline would have been wrong.

## Problem

- Coop and solo games (Pandemic, Saturday-night solo Agricola) could only be
  recorded by inventing fake per-player scores, which then fed Elo, arenas,
  markets, tournaments and profile stats — all meaningless for them.
- There was no way to say "this game is never competitive" or "this game is
  sometimes played coop".

## Decision

### A game mode and a per-match mode

`games.game_mode` (migration 066) is one of:

| value | meaning |
| --- | --- |
| `competitive` | rating matches only (the mode of every game created before this ADR) |
| `coop` | cooperative or solo only — never rated |
| `mixed` | each match picks one of the two |

`matches.mode` is the **resolved snapshot** per match (`competitive` / `coop`),
derived server-side at write time: coop-only → coop, competitive-only →
competitive, mixed → the request's `mode` (default competitive). A match with
calculator columns (ADR-09) is always competitive. The snapshot matters: a
game later flipped from mixed to competitive never rewrites history — recorded
coop matches stay coop, recorded competitive matches keep their settlements.

A coop match carries one shared result — `game_score` + `game_won` — instead
of per-player scores. Its participants still live in `match_scores` (score 0):
the participant list is the join key every read path already uses. Solo = one
participant (the ≥2-player rule applies to competitive matches only). The
create/update API carries `mode`, `game_score`, `game_won` and `player_ids`;
`score` is the competitive-only player list. Malformed combinations (coop with
per-player scores, competitive with a game result, a mode contradicting the
game's own) are 400s.

### Coop matches touch nothing that computes a rating

The exclusion has exactly two plug-in points:

1. **`arena_contains_match` v2** (ADR-28): the membership function takes the
   match mode and returns `false` for `coop` before any other check. Every
   arena kind — global, per-game, filter, camp, tournament — and everything
   derived from the membership set (settlements, medals, arena feeds, replay,
   period counts, player profile stats that read settlements) excludes coop
   matches through this single function. A coop match is created with no
   settlement step, no market resolution, no bracket acceptance, no camp links
   and no arena drain; the replay (`RecalculateFrom`) skips its Elo/market
   steps but still advances time-based market expiry — a coop match is a point
   on the timeline even though it settles nothing. Converting a match's mode
   on edit works both ways: the date-window replays and the affected-arena
   union delete the settlements of a match that became coop and settle a match
   that became competitive.
2. **The home feed includes them** (ADR-32 delivered the surface): `GET /feed`
   merges coop matches into its match branch (the query's `include_coop`
   flag, set only by `ListHomeFeed`); `GET /arenas/{id}/feed` — the global
   arena's own feed included — never sees them. The feed's match event schema
   gained `mode` / `game_score` / `game_won`; the card renders the shared
   result (win/loss badge, score, participants) with no ranks and no Elo bars.

Client-side, the win_streak progress mirror (`markets/progress.ts`) and the
tournament attach-match dialog filter coop matches out; the market and
tournament game pickers hide coop-only games (`game_mode = 'coop'`), and the
server rejects them anyway (`RejectCoopGames` at pool write, slot adjustment,
and market param creation).

## Consequences

- `GET /matches` and profile-adjacent raw match counts (`cnt_60/180`) exclude
  coop matches from stat-like reads but the matches list itself shows them —
  they are real games, just not rating events.
- Audit trail: mode conversions surface as score changes in the match-update
  details (zeroing/restoring per-player scores); no new audit schema version.
- Games' `game_mode` is full-state metadata in `PatchGame` (null resets to
  competitive) and travels with offline-created games in the pending queue's
  meta; the offline match queue carries mode/participants/shared result and
  pushes them on sync.
- A coop game's auto-managed arena (ADR-24) exists but stays empty by
  definition; harmless, and consistent with "every game has an arena".
