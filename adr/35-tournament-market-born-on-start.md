# A tournament's betting market is born with the tournament

## Problem

A `tournament_winner` market had to be created by hand after the tournament
started: the organizer picked the running tournament in the market form, the
API validated it (`ValidateTournamentWinnerTarget` — running status, ≥2
participants) and froze the roster into outcomes. In practice:

- **The market could be forgotten.** Nothing tied the market's existence to
  the tournament's start — a tournament could run (and complete) with nobody
  having opened betting on it.
- **Timing was manual.** The market's `starts_at` was whatever the organizer
  chose, not the moment the roster actually froze.
- **The validation existed only for the manual path.** "Must be running, must
  have participants" guarded a create request; with the market born in the
  start transaction those checks are the start flow's own preconditions.

## Decision

**The tournament_winner market is created automatically when the tournament
starts, and can no longer be created by hand.**

- `StartTournament` creates the market in the same transaction as the status
  write (`CreateTournamentWinnerMarket`): `created_by` is the acting
  organizer, `starts_at` is now, `closes_at` stays infinity, and the roster
  the status write just froze becomes one "player wins" outcome per
  participant. A running tournament always carries exactly one market — start
  and market birth are atomic.
- `POST /markets` accepts only `match_winner` and `win_streak`;
  `tournament_winner` is rejected as an unknown type. The creation form loses
  the type.
- The rest of the lifecycle is unchanged and already existed: the market
  settles when the tournament completes, is refunded when it is cancelled
  (organizer or grand-final deadline), reopens on a bracket-edit revert, and
  is re-settled by the recalculation sweep.

Tournaments already running before this change get no backfill migration —
only tournaments started after it carry the market.

## Consequences

- Starting a tournament is now also a market-creation event: the feed gains a
  live "markets-changed" signal on start, and the start flow fails if the
  market cannot be created (same transaction).
- The one-market-per-tournament invariant is structural, not conventional —
  tests can rely on it instead of creating markets through a helper.
- `ValidateTournamentWinnerTarget`, `ErrTournamentNotRunning` and the API's
  tournament branch of market creation are gone; the spec's create enum and
  the `StartTournament` description are the contract.
