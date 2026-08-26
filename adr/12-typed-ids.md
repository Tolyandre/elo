# Typed identifiers (replacing the idcodec middleware)

## Problem

ADR-07 introduced short Base58 ids on the wire, converted at the HTTP
boundary by two gin middlewares that walked raw JSON and rewrote the values
under keys named `id` / `*_id` / `*_ids` (plus the keys of the `score` map).
The convention was enforced only by comments and tests, and agentic code kept
breaking it in two ways:

- **Miss:** an id-bearing field named without the `_id` suffix (e.g. the
  markets API originally used `outcome`) was silently skipped, so a short id
  reached the handler unchanged and the query failed with "row not found"
  far away from the cause.
- **False positive:** a non-id field whose name happened to end in `_id`
  (IAWW's `row_id` with values like `"research"`, which is valid Base58) was
  decoded into a bogus UUID and corrupted (ADR-09).

Both failures were runtime-only. We wanted the mistake to be a compile error
on the Go side, a type error on the TypeScript side, and a build failure when
the OpenAPI spec forgets the convention.

## Decision

Keep the two representations, but make the conversion **structural** (driven
by types and the API contract) instead of **nominal** (driven by JSON key
names). Delete the middleware entirely.

- **`pkg/id`** is the single home of the concept:
  - `ID` — canonical UUID string, used by Go services, sqlc models and
    Postgres. Its `MarshalJSON` emits the Base58 wire form and its
    `UnmarshalJSON` accepts either form (tolerant inbound keeps legacy
    canonical links working), so every struct field typed `ID` converts
    regardless of its name.
  - `Base58ID` — the wire form, used at the HTTP boundary and in the
    TypeScript client.
  - `Scan`/`Value` make `ID` a transparent pgx value; the sqlc override maps
    `uuid` columns (and `uuid[]`) to it, so the whole DB layer is typed.
- **OpenAPI is the single declaration point.** Every id-bearing property,
  array and nullable id references one shared schema, `Base58ID`
  (renamed from the misleading `ULID`). `x-go-type` maps it to `id.ID` in the
  oapi-codegen output; the openapi-typescript Node API transform (see
  `nextjs/scripts/generate-api.mts`) maps it to a branded
  `Base58ID` string type in the client. Path/query parameters stay plain
  `type: string` — they carry the wire form and are parsed explicitly by
  handlers via `id.ParseTolerant` (helper `api.parseIDParam`), because a
  lying canonical-typed parameter would compile and still ship a short id
  into a query.
- **`internal/openapilint`** turns the convention into a build failure:
  id-named properties must reference `Base58ID`, references to `Base58ID`
  must sit on id-shaped names (prevents typing non-ids as ids — the ADR-09
  corruption class), and id-named parameters must stay plain strings. Runs as
  part of `go test ./...`.

### The two structural holes

The type trick cannot reach two places, and each got an explicit mechanism:

1. **JSON object keys** — `encoding/json` never calls custom marshalers for
   map keys, so `map[id.ID]V` would leak canonical UUIDs on marshal and skip
   conversion on parse. The `score` maps use `api.IDMap[V]`
   (`map[id.ID]V` with hand-written hooks that convert the keys), wired via
   `x-go-type` on the two `score` properties.
2. **Freeform documents** — `calculator_data` is schema-less at the OpenAPI
   layer. Its embedded JSON Schemas (ADR-09) now mark id properties with
   `"x-entity-id": true`, and `calculator.CanonicalizeIDs` /
   `calculator.ShortenIDs` walk the document against the schema on
   ingest/egress. Unlike the old middleware this is name-independent inside
   the doc (`row` stays a non-id) and fails loudly on non-string id values.

The Skull King table `game_state` is a typed Go struct (`SkullKingPlayer.ID`,
`FallbackGameId` are `id.ID`), so its ids convert through the same JSON
hooks. SSE payloads and other raw gin responses (markets prices, `/auth/me`)
encode ids by hand via `ID.Base58()` — they never passed through the JSON
DTO layer even before.

## What replaced each middleware behavior

| idcodec middleware | Replacement |
| --- | --- |
| Decode path/query params in place | `api.parseIDParam` at each handler (invalid ⇒ zero id ⇒ existing 404 path) |
| Walk request bodies, rewrite `*_id` values | `id.ID.UnmarshalJSON` on typed DTO fields; `IDMap` for score keys; schema walk for `calculator_data` |
| Buffer JSON responses, rewrite ids | `id.ID.MarshalJSON` on the way out (no buffering, no Content-Length rewrite, no panic-recovery workaround) |
| Tolerant canonical inbound / short outbound | unchanged (`id.ParseTolerant` / `ID.Base58`) |
| `score` map key special case | `api.IDMap[V]` |

## Consequences

- Adding a new id field: reference `#/Base58ID` in the spec (the lint fails
  the build otherwise) and regenerate. The name of the property no longer
  matters for correctness — `fallbackGameId` converts like `host_user_id`.
- Malformed body ids now fail at request parse time with a 400 instead of a
  row-not-found deep in a query. Any Base58-decodable string still decodes
  (unavoidable — that set is exactly what the old middleware accepted).
- TypeScript ids are branded: a plain `string` cannot flow into an id slot
  without `toBase58ID`/`newId`/`encodeId`. This required patching
  `openapi-typescript-helpers` (pnpm patch, `nextjs/patches/`) whose
  `Readable`/`Writable` recursion object-ified branded strings; worth
  upstreaming.
- The Go DTO structs hold canonical values while the OpenAPI schema
  documents the Base58 wire form — the middleware-era invariant, now
  documented here instead of being implicit in a middleware.
- Storing Base58 in Postgres was rejected (native uuid columns, index
  locality, migration cost); per-entity brands (PlayerID vs GameID) were
  deferred as unnecessary friction for now.

## Notes

- The union fillers generated by oapi-codegen round-trip values through JSON,
  so id fields passing through `Market_Params` conversions are re-encoded —
  idempotent for real ids, but unit-test fixtures must use uuid-shaped ids.
- `nextjs/scripts/generate-api.mts` replaces the openapi-typescript CLI
  (the CLI has no custom-type hook).
- Supersedes the "Boundary transformation (not a custom type)" section of
  ADR-07; that ADR's encoding choice (Base58, tolerant inbound) stands.
