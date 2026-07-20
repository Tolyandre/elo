# Calculator data persistence (history mode)

## Problem

The two game calculators — Skull King (`/calculators/skull-king-game`) and It's a Wonderful World (`/its-a-wonderful-world`) — capture a detailed per-round / per-cell breakdown while a game is being played. Until now only the **final per-player scores** reached the server (`POST /matches`); the intermediate state lived in `localStorage` and was deleted on save. As a result, opening a saved match could never recover the round-by-round or cell-by-cell breakdown — editing meant re-typing flat scores through the generic form.

We want to:

- persist the calculator's intermediate state alongside the match;
- let the match be re-opened in the same calculator (history mode) to view or tweak the breakdown and recompute scores;
- gate writes to editors (a read-only user can view the saved breakdown but cannot save);
- use a different edit affordance/icon so users can tell the calculator-backed match apart from a generic one;
- design for adding calculators for other games later, each with its own UI and data shape, and for the data shape to evolve.

The live multiplayer aspects of Skull King (table/lobby, SSE, connected players) are part of *running* a game, not of editing a saved one, so history mode must not create or join a table.

## Decision

### Storage

Add three columns directly on `matches` (migration `037`):

```sql
calculator_kind            TEXT NULL,   -- 'skull-king' | 'iaww' | ...
calculator_schema_version  INT  NULL,   -- the version of the per-kind JSON Schema
calculator_data            JSONB NULL   -- the intermediate state document
```

A CHECK constraint enforces that either all three are set (calculator-backed match) or all three are NULL (plain match). Matches created through the generic form keep the columns NULL — Postgres stores NULLs cheaply, so the cost on the common path is negligible.

All three columns live on `matches` (not in a side table) to keep list/detail queries join-free and the data model simple. The JSONB payload is opaque to the DB; it is validated in Go at the HTTP boundary against a per-kind JSON Schema (see below).

### Normalized storage shape (player ids under `player_id`)

The pkg/api `idcodec` middleware rewrites short ↔ canonical UUIDs but only for JSON keys named `id`, `*_id`, `*_ids`, and the `score` map (whose keys are player ids). To get automatic rewriting of player ids inside `calculator_data` **without** teaching the middleware about each calculator's layout, the stored document keeps every player reference under a key named `player_id` (or ending in `_id`), never as an object key.

Example — It's a Wonderful World:

```jsonc
// live UI state (convenient for the UI, but ids are object keys — NOT stored)
{ "directVP":   { "<player_id>": 12 },
  "multipliers": { "str-res": { "<player_id>": { "coeff": 6, "count": 2 } } } }

// normalized stored form (ids under player_id — idcodec rewrites them)
{ "direct_vp":   [{ "player_id": "<player_id>", "value": 12 }],
  "multipliers": [{ "row": "str-res", "player_id": "<player_id>", "coeff": 6, "count": 2 }] }
```

Skull King's `rounds[][]` are positional (the index identifies the player) so no ids live there; only `players[].player_id` needs renaming.

The frontend owns the conversion at the storage boundary: `toStorage(state)` / `fromStorage(storage)` in `components/calculators/<kind>/storage.ts`. The domain and handler treat the document as opaque `json.RawMessage`.

#### Pitfall: non-entity keys that end in `_id` collide with Base58

A key ending in `_id` is rewritten by idcodec **only if its value parses as a short Base58 id or a canonical UUID**; other strings pass through untouched. This is usually fine, but it bites when a non-entity identifier happens to be a valid Base58 string: `shortid.ToCanonical("research")` succeeds and returns `00000000-0000-0000-0000-63b5ec8e7172`, silently corrupting the value.

This exact bug shipped in IAWW v1, where the multiplier row key was named `row_id`. Row ids like `structure`, `research`, `project`, `discovery`, `financier`, `direct` are all valid Base58 strings, so on the request path idcodec rewrote them into canonical UUIDs and the stored document was corrupted (reopening the match showed an empty scoring table because no row id matched any `ROWS` entry). IAWW v2 fixes it by renaming the key to `row` (no `_id` suffix); a v1→v2 migrator recovers corrupted documents by reverse-mapping the known UUIDs.

**Rule for new calculators:** only use a key ending in `_id` for actual entity ids (player, match, game, …). For any other identifier (row kind, phase, slot, …), pick a key name that does NOT end in `_id` so idcodec leaves it alone.

### Per-kind JSON Schema + migration support (pkg/calculator)

A new `pkg/calculator` package holds a registry of calculators. Each entry has:

- a stable `Kind` (e.g. `"skull-king"`, `"iaww"`);
- the current `schema_version` (currently 1 for both);
- an embedded JSON Schema (draft 2020-12) compiled with `github.com/santhosh-tekuri/jsonschema/v6`;
- a `migrators` map from `fromVersion → upgrade function`, initially empty.

The `AddMatch` / `UpdateMatch` handlers validate incoming `calculator_data` against the kind's schema (400 on failure) before passing it to the service. The service stores it verbatim alongside the version number.

When a calculator's data shape needs to change, ship a new schema file (`<kind>.v2.json`), bump `CurrentVersion` to 2, and register a migrator `1 → 2`. **Data migrations run once at application startup** (`pkg/db.MigrateCalculatorData`, wired in `main.go` after the SQL migration in every mode — `--migrate-db`, `--migrate-db-dsn`, and normal boot): it scans rows whose `calculator_schema_version` is behind, applies the migrators, validates the upgraded document against the current schema, and writes it back. A failure is fatal — the application refuses to start, mirroring how SQL migration failures are handled.

### API surface (OpenAPI)

`AddMatch`, `UpdateMatch`, and `Match` carry optional `calculator_kind` (string, nullable) and `calculator_data` (object, nullable). The OpenAPI layer treats `calculator_data` as opaque; the JSON Schema validation lives entirely in the Go handler. `UpdateMatch` supports three modes via the `calculator_kind` pointer:

- pointer unset (key absent) — leave existing columns untouched;
- pointer non-null + data — replace with validated document;
- pointer null — clear the columns.

### History mode UI

The single `/matches/edit?id=…` route dispatches on `calculator_kind`:

- if the match has `calculator_kind`, it loads the match detail (the list response omits `calculator_data` to keep payloads small, so a `GET /matches/{id}` is always issued), reads `calculator_kind` + `calculator_data`, and renders the per-kind calculator editor;
- otherwise it renders the generic `MatchForm` (date + game + participants + scores);
- **calculator-backed matches have no path to the generic form** — every save recomputes the score map from the calculator state, so `score` and `calculator_data` can never drift apart. (Letting the user edit `score` directly while leaving `calculator_data` stale would produce exactly that drift, so the generic form is intentionally unreachable for calculator-backed matches.)
- **skips the setup phase** (players are fixed by the match — agreeing to lose the ability to edit the player roster / date is an explicit trade-off, since re-using the calculator to fix a name typo is not the scenario);
- does NOT create or join a Skull King table — history mode is a local re-edit, so the user is implicitly the host (table/lobby/SSE are live-mode-only);
- `readOnly = !me.canEdit`: read-only users can open the calculator and inspect the breakdown but cannot save (and the `RequireEditor` middleware on `PUT /matches/:id` enforces it server-side too).

The match view page (`/matches/view`) swaps the edit icon from `Edit2` to `ClipboardEdit` (lucide) when the match has `calculator_kind`, signalling that the calculator UI is what opens. Both icons link to the same `/matches/edit?id=…` route.

### Reused UI components

Calculator UI pieces live in `nextjs/components/calculators/<kind>/`:

- `scoring.tsx` — pure scoring functions and types (`calcRoundScore`, `playerTotal`, `GameState`, …);
- `storage.ts` — normalized shape + `toStorage` / `fromStorage`;
- `game-table.tsx` / `scoring-table.tsx` — presentational grid;
- `edit-cell-dialog.tsx` / `edit-dialog.tsx` — cell editor (with a `readOnly` prop for history mode).

Both the live calculator pages and the history-mode editors import from here.

### Offline mode is intentionally excluded

`calculator_data` is forwarded only on the online path of `submitMatch`. A calculator-originated match queued offline (no network) is still queued and synced, but without `calculator_data` — matching the pre-feature behaviour where the breakdown never left `localStorage`. Adding full offline parity for `calculator_data` is deferred until needed.

## Consequences

- Adding a new calculator: register a kind in `pkg/calculator` (+ a v1 schema), add a storage module + UI components, and wire the kind into `/matches/edit`. Everything else is additive.
- Evolving an existing calculator's data shape: ship `<kind>.v(n+1).json`, bump `CurrentVersion`, register a migrator. Startup data migration handles existing rows; a malformed migrator fails the boot.
- The idcodec middleware stays generic — it never learns calculator-specific paths; correctness comes from the storage-shape convention.
- A read-only user opening a calculator-backed match sees the breakdown but cannot save. The generic `/matches/edit` remains available for matches without `calculator_kind` and for editing date / roster (those are not editable in history mode — accepted trade-off).
