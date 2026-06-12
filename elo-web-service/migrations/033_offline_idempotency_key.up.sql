-- Idempotency keys for offline-created entities. A client that creates a match,
-- player or game while offline retries the POST after reconnecting; the unique
-- key lets the server return the already-created row instead of a duplicate.
ALTER TABLE matches ADD COLUMN idempotency_key UUID NULL;
ALTER TABLE players ADD COLUMN idempotency_key UUID NULL;
ALTER TABLE games   ADD COLUMN idempotency_key UUID NULL;

CREATE UNIQUE INDEX matches_idempotency_key_unique ON matches (idempotency_key);
CREATE UNIQUE INDEX players_idempotency_key_unique ON players (idempotency_key);
CREATE UNIQUE INDEX games_idempotency_key_unique   ON games (idempotency_key);
