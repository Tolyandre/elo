# Short ids (Base58-encoded UUIDs)

## Problem

ADR-06 made every primary key a client-generated UUIDv7 exposed on the wire as the standard 36-character canonical string (e.g. `018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e5f`). That format is verbose and awkward in the places users actually see ids — URLs like `/player?id=018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e5f` — especially on mobile and when sharing links by hand. The canonical form also carries four dashes that add nothing.

We want ids to look like YouTube video ids (`jQzPRYgJw04`): short, readable, and URL-safe, while remaining the same underlying UUIDv7 identifier (so generation, sortability, idempotency, and DB storage are unchanged).

## Decision

Keep UUIDv7 as the identifier; change only its **wire encoding** to **Base58** (Bitcoin alphabet). A 128-bit UUID encodes to ~22 characters.

```
123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz
```

The Bitcoin alphabet omits the four look-alike characters `0`, `O`, `I`, `l`, so ids stay unambiguous when read or typed. Leading zero bytes encode to leading `1`s, so legacy int-backed ids from migration 036 (`00000000-0000-0000-0000-0000000000NN`) round-trip correctly.

- **Wire format (request + response):** Base58 string, ~22 chars (e.g. `CB83kiayfV3yUWvyEQtES`).
- **DB storage:** unchanged — native Postgres `UUID`, canonical form.
- **Internal Go:** canonical UUID strings, exactly as before.
- **Backend input:** tolerant — accepts **either** the short Base58 form **or** the 36-char canonical UUID. Legacy canonical links and clients keep working.
- **Backend output:** always emits the short Base58 form, so any client that echoes a returned id into a URL gets short ids for free.

A full UUID is 128 bits, so no alphabet can beat ~22 characters; the difference between encodings is readability and URL-safety. Base58 was chosen over Base62 (which includes `0/O` and `1/l`), Base64url (which contains `-` and `_`), and Base32 Crockford (26 chars — the real ULID alphabet, longer). Base58 is the most "YouTube-like": shortest practical length with zero ambiguous characters.

### Boundary transformation (not a custom type)

The transformation happens entirely at the HTTP boundary via two gin middlewares (`pkg/api/idcodec_middleware.go`), not via a custom Go type or OpenAPI `format` change. This is because:

- oapi-codegen emits `type ULID = string` (a Go **alias**, which cannot carry methods), and path parameters arrive as plain `string`s — a custom type would require fighting codegen config and adding `string(x)` conversions at every response-construction site.
- Ids appear not just as field values (`id`, `*_id`, `*_ids`) but also as the **keys** of the `score` object map (player ids → score). A type-based approach cannot rewrite map keys.

`DecodeIDsMiddleware` (inbound) rewrites short ids in path params (`id`, `userId`, `playerId`), query params (`*_id`), and JSON request bodies to canonical form before handlers run. `EncodeIDsMiddleware` (outbound) wraps the response writer and rewrites canonical ids in JSON responses to short form. Both are **key-aware**: only values under keys named `id`/`*_id`/`*_ids`, and the keys of `score`, are touched. Opaque values like the `next` pagination cursor (a base64 blob) are left alone.

Non-JSON responses bypass the buffer entirely: SSE streams (`text/event-stream` for Skull-King table state), SVG club icons, and redirects pass through verbatim, and `Flush()`/`Hijack()` are delegated to the underlying writer so streaming keeps working.

### Frontend

The client holds a single representation (short). `nextjs/lib/id.ts` is the only place that knows the encoding: `encodeId(uuidv7())` mints a new id. Received ids are already short (the backend emits short), so no decode is needed on the client. All `router.push`/`<Link href>` sites keep working unchanged — they already treat ids as opaque strings.

## Consequences

- URLs shrink from 36 chars to ~22: `/player?id=CB83kiayfV3yUWvyEQtES`.
- The API contract is unchanged structurally — ids are still `type: string` in OpenAPI. Only the `ULID` schema description is updated.
- Backward compatible: old canonical-form links and request bodies still work (the backend decodes both). New short ids are emitted in responses.
- No migration: DB storage is untouched (canonical UUID).
- Server-generated ids (`uuid.NewV7()` for users, bets, corrections, settlements) stay canonical internally; the response encoder shortens them on the way out.

## Notes

The `next` pagination cursor (`encodeMatchCursor`/`decodeMatchCursor` in `pkg/api/matches.go`) embeds canonical UUIDs inside a base64-encoded JSON blob. It is intentionally not transformed: its key name (`next`) is not id-shaped, and the embedded UUIDs live inside an opaque token that the body walker never opens. `decodeMatchCursor` runs inside the handler (after inbound decode) and sees the canonical UUIDs it encoded, so it needs no change.

Regenerate API code after editing the OpenAPI description: `make generate-api`.
