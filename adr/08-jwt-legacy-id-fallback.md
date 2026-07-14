# JWT legacy id fallback

## Problem

ADR-06 converted the `users.id` primary key from `SERIAL` (int) to `UUID`. Existing JWT tokens — still present in users' browser cookies — carry the old int id as the `sub` claim (e.g. `"1"`), because pre-migration `CreateJwt` stored `fmt.Sprintf("%d", userID)` where `userID` was an `int32`.

After migration 036, `users.id` is a UUID column. When `DeserializeUser` extracts `"1"` from an old token and passes it to `GetUserByID` → `GetUser` (`WHERE id = $1` on a UUID column), Postgres rejects it:

```
ERROR: invalid input syntax for type uuid: "1" (SQLSTATE 22P02)
```

Every authenticated route (`RequireEditor`, `RequirePlayerID`, `/auth/me`) goes through `GetUserByID`, so old-token users see a 500 on every request until they re-login through Google OAuth (which issues a fresh UUID-based token).

The migration header acknowledged this: *"Breaking change: existing JWTs become invalid."* Rather than force all users to re-authenticate at deploy time, we add a temporary fallback.

## Decision

Add a nullable `legacy_int_id` column to `users` that preserves the old SERIAL int id. Fall back to it in `GetUserByID` when the JWT `sub` is not a valid UUID.

### Schema

In migration `036_client_ulid_ids.up.sql`, **before** `users.id` is changed to UUID (while `id` is still `INTEGER`):

```sql
ALTER TABLE users ADD COLUMN legacy_int_id INTEGER;
UPDATE users SET legacy_int_id = id;  -- capture old int while id is still INTEGER
CREATE UNIQUE INDEX users_legacy_int_id_idx ON users (legacy_int_id);
```

- Existing users: `legacy_int_id = <old int>` (e.g. `1`).
- New users (created post-migration via `CreateUser`): `legacy_int_id = NULL` — the INSERT omits the column. Their JWTs already carry UUIDs, so they never need the fallback.
- The column is nullable and the unique index allows multiple NULLs (Postgres default), so multiple new users with `NULL` don't conflict.

### Fallback logic

`GetUserByID` (`pkg/elo/users.go`) tries the UUID lookup first; if the id isn't a UUID, it parses it as an int and queries by `legacy_int_id`:

```
GetUserByID(id):
  if uuid.Parse(id) succeeds:
    return GetUser(id)              # normal post-migration path
  if strconv.ParseInt(id) succeeds:
    return GetUserByLegacyIntID(id) # old JWT token fallback
  return error
```

This is localized to the single method that all auth paths use, so `RequireEditor`, `RequirePlayerID`, and `/auth/me` all benefit without per-call-site changes.

### Why a column instead of normalizing the JWT `sub`?

The `int_to_uuid` mapping (`00000000-0000-0000-0000-` + zero-padded hex) could be reimplemented in Go and applied in `ValidateToken`. But a DB column is more robust: the mapping lives in one source of truth (the migration that created it), the column documents the migration history, and the fallback is testable against real data. The `int_to_uuid` SQL function is dropped at the end of migration 036, so reimplementing it in Go would duplicate logic that no longer exists anywhere.

## Consequences

- Old JWT tokens work until they expire or are rotated. Users are not forced to re-authenticate at deploy time.
- `GetUserByID` does two lookups for old-token users (UUID parse fails, then legacy-int query) — negligible overhead, and only for the transitional period.
- New users are unaffected: their `legacy_int_id` is NULL and their JWTs carry UUIDs.

## Removal

Once all old JWT tokens have expired (after the JWT TTL — currently `CookieTtlSeconds`, the cookie lifetime — elapses post-deploy), this fallback is dead code and should be removed:

1. Drop the `legacy_int_id` column and its index.
2. Remove `GetUserByLegacyIntID` from `users.sql` and regenerate sqlc.
3. Simplify `GetUserByID` back to a single `GetUser` call.

This is tracked as a follow-up, not done now.
