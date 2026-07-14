-- Migration 036: Replace SERIAL int ids with UUID (ULID-backed) for all tables.
-- Up-only. Breaking change: existing JWTs become invalid; clients must send `id` on create.
--
-- Backfill strategy: existing rows get a deterministic UUID encoding their old int id,
-- preserving the ordering invariant from ADR-01 §22 (equal-date rows ordered by id).
-- The mapping places the big-endian int in the least-significant 4 bytes with all higher
-- bytes zero, so old rows sort before any new client-generated ULID (whose first bytes
-- are non-zero) and preserve their relative int ordering.

-- Helper: deterministic int → UUID mapping (monotonic, sorts before real ULIDs).
CREATE OR REPLACE FUNCTION int_to_uuid(n INTEGER) RETURNS UUID AS $$
    SELECT ('00000000-0000-0000-0000-0000' || lpad(to_hex(n), 8, '0'))::UUID
$$ LANGUAGE SQL IMMUTABLE STRICT;

-- Helper: convert INT[] to UUID[] element-by-element (cannot use subquery in USING).
-- COALESCE handles empty arrays: array_agg() over 0 rows returns NULL, not '{}'.
-- Not STRICT: nullable columns (e.g. game_ids) may pass NULL, which must map to NULL.
CREATE OR REPLACE FUNCTION int_array_to_uuid_array(arr INTEGER[]) RETURNS UUID[] AS $$
    SELECT COALESCE(array_agg(int_to_uuid(x)), '{}'::uuid[]) FROM unnest(arr) AS x
$$ LANGUAGE SQL IMMUTABLE;

-- ─── Drop all foreign-key constraints ──────────────────────────────────────────
DO $$ DECLARE r RECORD;
BEGIN
    FOR r IN (
        SELECT conname, conrelid::regclass AS tbl
        FROM pg_constraint
        WHERE contype = 'f' AND conrelid IN (
            'player_club_membership'::regclass, 'matches'::regclass, 'users'::regclass,
            'match_scores'::regclass, 'tournament_player_membership'::regclass,
            'match_tournament'::regclass, 'markets'::regclass,
            'market_match_winner_params'::regclass, 'market_win_streak_params'::regclass,
            'bets'::regclass, 'skull_king_tables'::regclass, 'corrections'::regclass,
            'global_arena_settlement'::regclass, 'game_arena_settlement'::regclass
        )
    )
    LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
    END LOOP;
END $$;

-- ─── Drop idempotency_key columns (and their unique indices) ───────────────────
ALTER TABLE games    DROP COLUMN idempotency_key;
ALTER TABLE players  DROP COLUMN idempotency_key;
ALTER TABLE matches  DROP COLUMN idempotency_key;

-- ─── Drop SERIAL DEFAULTs before type change (nextval cannot cast to UUID) ───
ALTER TABLE clubs                       ALTER COLUMN id DROP DEFAULT;
ALTER TABLE games                       ALTER COLUMN id DROP DEFAULT;
ALTER TABLE players                     ALTER COLUMN id DROP DEFAULT;
ALTER TABLE matches                     ALTER COLUMN id DROP DEFAULT;
ALTER TABLE users                       ALTER COLUMN id DROP DEFAULT;
ALTER TABLE tournaments                 ALTER COLUMN id DROP DEFAULT;
ALTER TABLE markets                     ALTER COLUMN id DROP DEFAULT;
ALTER TABLE bets                        ALTER COLUMN id DROP DEFAULT;
ALTER TABLE corrections                 ALTER COLUMN id DROP DEFAULT;
ALTER TABLE global_arena_settlement     ALTER COLUMN id DROP DEFAULT;
ALTER TABLE game_arena_settlement       ALTER COLUMN id DROP DEFAULT;

-- ─── Preserve legacy SERIAL int id for JWT fallback ──────────────────────────
-- Existing JWT tokens carry the old SERIAL int user id as the "sub" claim (e.g.
-- "1"). After users.id becomes UUID below, those tokens can no longer resolve a
-- user. We capture the old int into legacy_int_id NOW (while id is still
-- INTEGER) so GetUserByID can fall back to it until all tokens rotate. New users
-- created post-migration have legacy_int_id = NULL (their JWTs carry UUIDs).
-- See ADR-08. Removable once the JWT TTL expires for all sessions.
ALTER TABLE users ADD COLUMN legacy_int_id INTEGER;
UPDATE users SET legacy_int_id = id;
CREATE UNIQUE INDEX users_legacy_int_id_idx ON users (legacy_int_id);

-- ─── Alter primary-key id columns to UUID ────────────────────────────────────
ALTER TABLE clubs                       ALTER COLUMN id TYPE UUID USING int_to_uuid(id);
ALTER TABLE games                       ALTER COLUMN id TYPE UUID USING int_to_uuid(id);
ALTER TABLE players                     ALTER COLUMN id TYPE UUID USING int_to_uuid(id);
ALTER TABLE matches                     ALTER COLUMN id TYPE UUID USING int_to_uuid(id);
ALTER TABLE users                       ALTER COLUMN id TYPE UUID USING int_to_uuid(id);
ALTER TABLE tournaments                 ALTER COLUMN id TYPE UUID USING int_to_uuid(id);
ALTER TABLE markets                     ALTER COLUMN id TYPE UUID USING int_to_uuid(id);
ALTER TABLE bets                        ALTER COLUMN id TYPE UUID USING int_to_uuid(id);
ALTER TABLE corrections                 ALTER COLUMN id TYPE UUID USING int_to_uuid(id);
ALTER TABLE global_arena_settlement     ALTER COLUMN id TYPE UUID USING int_to_uuid(id);
ALTER TABLE game_arena_settlement       ALTER COLUMN id TYPE UUID USING int_to_uuid(id);
-- skull_king_tables.id is already UUID; no change needed.

-- ─── Alter foreign-key columns to UUID ───────────────────────────────────────
ALTER TABLE player_club_membership  ALTER COLUMN club_id   TYPE UUID USING int_to_uuid(club_id);
ALTER TABLE player_club_membership  ALTER COLUMN player_id TYPE UUID USING int_to_uuid(player_id);

ALTER TABLE matches                  ALTER COLUMN game_id  TYPE UUID USING int_to_uuid(game_id);

ALTER TABLE users                    ALTER COLUMN player_id TYPE UUID USING int_to_uuid(player_id);

ALTER TABLE match_scores             ALTER COLUMN match_id  TYPE UUID USING int_to_uuid(match_id);
ALTER TABLE match_scores             ALTER COLUMN player_id TYPE UUID USING int_to_uuid(player_id);

ALTER TABLE tournament_player_membership ALTER COLUMN tournament_id TYPE UUID USING int_to_uuid(tournament_id);
ALTER TABLE tournament_player_membership ALTER COLUMN player_id     TYPE UUID USING int_to_uuid(player_id);

ALTER TABLE match_tournament         ALTER COLUMN match_id      TYPE UUID USING int_to_uuid(match_id);
ALTER TABLE match_tournament         ALTER COLUMN tournament_id TYPE UUID USING int_to_uuid(tournament_id);

ALTER TABLE markets                  ALTER COLUMN created_by          TYPE UUID USING int_to_uuid(created_by);
ALTER TABLE markets                  ALTER COLUMN resolution_match_id TYPE UUID USING int_to_uuid(resolution_match_id);

ALTER TABLE market_match_winner_params ALTER COLUMN market_id        TYPE UUID USING int_to_uuid(market_id);
ALTER TABLE market_match_winner_params ALTER COLUMN target_player_id TYPE UUID USING int_to_uuid(target_player_id);

ALTER TABLE market_win_streak_params  ALTER COLUMN market_id        TYPE UUID USING int_to_uuid(market_id);
ALTER TABLE market_win_streak_params  ALTER COLUMN target_player_id TYPE UUID USING int_to_uuid(target_player_id);

ALTER TABLE bets                     ALTER COLUMN market_id TYPE UUID USING int_to_uuid(market_id);
ALTER TABLE bets                     ALTER COLUMN player_id TYPE UUID USING int_to_uuid(player_id);

ALTER TABLE skull_king_tables        ALTER COLUMN host_user_id TYPE UUID USING int_to_uuid(host_user_id);

ALTER TABLE corrections              ALTER COLUMN player_id TYPE UUID USING int_to_uuid(player_id);

ALTER TABLE global_arena_settlement  ALTER COLUMN player_id     TYPE UUID USING int_to_uuid(player_id);
ALTER TABLE global_arena_settlement  ALTER COLUMN match_id      TYPE UUID USING int_to_uuid(match_id);
ALTER TABLE global_arena_settlement  ALTER COLUMN market_id     TYPE UUID USING int_to_uuid(market_id);
ALTER TABLE global_arena_settlement  ALTER COLUMN correction_id TYPE UUID USING int_to_uuid(correction_id);

ALTER TABLE game_arena_settlement    ALTER COLUMN game_id   TYPE UUID USING int_to_uuid(game_id);
ALTER TABLE game_arena_settlement    ALTER COLUMN player_id TYPE UUID USING int_to_uuid(player_id);
ALTER TABLE game_arena_settlement    ALTER COLUMN match_id  TYPE UUID USING int_to_uuid(match_id);

-- ─── Alter INT[] array columns to UUID[] ─────────────────────────────────────
-- Drop DEFAULTs first: the '{}' literal is typed as INT[] and cannot cast to UUID[].
ALTER TABLE market_match_winner_params ALTER COLUMN required_player_ids DROP DEFAULT;
ALTER TABLE market_match_winner_params ALTER COLUMN game_ids DROP DEFAULT;
ALTER TABLE market_win_streak_params  ALTER COLUMN game_ids DROP DEFAULT;
ALTER TABLE skull_king_tables          ALTER COLUMN connected_player_ids DROP DEFAULT;

ALTER TABLE market_match_winner_params
    ALTER COLUMN required_player_ids TYPE UUID[] USING int_array_to_uuid_array(required_player_ids);
ALTER TABLE market_match_winner_params
    ALTER COLUMN game_ids TYPE UUID[] USING int_array_to_uuid_array(game_ids);

ALTER TABLE market_win_streak_params
    ALTER COLUMN game_ids TYPE UUID[] USING int_array_to_uuid_array(game_ids);

ALTER TABLE skull_king_tables
    ALTER COLUMN connected_player_ids TYPE UUID[] USING int_array_to_uuid_array(connected_player_ids);

-- Refresh array defaults (type changed from INT[] to UUID[]).
ALTER TABLE market_match_winner_params ALTER COLUMN required_player_ids SET DEFAULT '{}';
ALTER TABLE market_match_winner_params ALTER COLUMN game_ids SET DEFAULT '{}';
ALTER TABLE market_win_streak_params  ALTER COLUMN game_ids SET DEFAULT '{}';
ALTER TABLE skull_king_tables          ALTER COLUMN connected_player_ids SET DEFAULT '{}';

-- ─── Drop orphaned SERIAL sequences ───────────────────────────────────────────
DROP SEQUENCE IF EXISTS clubs_id_seq;
DROP SEQUENCE IF EXISTS games_id_seq;
DROP SEQUENCE IF EXISTS players_id_seq;
DROP SEQUENCE IF EXISTS matches_id_seq;
DROP SEQUENCE IF EXISTS users_id_seq;
DROP SEQUENCE IF EXISTS tournaments_id_seq;
DROP SEQUENCE IF EXISTS markets_id_seq;
DROP SEQUENCE IF EXISTS bets_id_seq;
DROP SEQUENCE IF EXISTS corrections_id_seq;
DROP SEQUENCE IF EXISTS global_arena_settlement_id_seq;
DROP SEQUENCE IF EXISTS game_arena_settlement_id_seq;

-- ─── Recreate foreign-key constraints ─────────────────────────────────────────
ALTER TABLE player_club_membership
    ADD CONSTRAINT player_club_membership_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
    ADD CONSTRAINT player_club_membership_club_id_fkey   FOREIGN KEY (club_id)   REFERENCES clubs(id);

ALTER TABLE matches
    ADD CONSTRAINT matches_game_id_fkey FOREIGN KEY (game_id) REFERENCES games(id);

ALTER TABLE users
    ADD CONSTRAINT users_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE SET NULL;

ALTER TABLE match_scores
    ADD CONSTRAINT match_scores_match_id_fkey  FOREIGN KEY (match_id)  REFERENCES matches(id),
    ADD CONSTRAINT match_scores_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id);

ALTER TABLE tournament_player_membership
    ADD CONSTRAINT tournament_player_membership_player_id_fkey     FOREIGN KEY (player_id)     REFERENCES players(id) ON DELETE CASCADE,
    ADD CONSTRAINT tournament_player_membership_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES tournaments(id);

ALTER TABLE match_tournament
    ADD CONSTRAINT match_tournament_match_id_fkey      FOREIGN KEY (match_id)      REFERENCES matches(id) ON DELETE CASCADE,
    ADD CONSTRAINT match_tournament_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES tournaments(id);

ALTER TABLE markets
    ADD CONSTRAINT markets_created_by_fkey          FOREIGN KEY (created_by)          REFERENCES users(id),
    ADD CONSTRAINT markets_resolution_match_id_fkey FOREIGN KEY (resolution_match_id) REFERENCES matches(id) ON DELETE SET NULL;

ALTER TABLE market_match_winner_params
    ADD CONSTRAINT market_match_winner_params_market_id_fkey        FOREIGN KEY (market_id)        REFERENCES markets(id) ON DELETE CASCADE,
    ADD CONSTRAINT market_match_winner_params_target_player_id_fkey FOREIGN KEY (target_player_id) REFERENCES players(id);

ALTER TABLE market_win_streak_params
    ADD CONSTRAINT market_win_streak_params_market_id_fkey        FOREIGN KEY (market_id)        REFERENCES markets(id) ON DELETE CASCADE,
    ADD CONSTRAINT market_win_streak_params_target_player_id_fkey FOREIGN KEY (target_player_id) REFERENCES players(id);

ALTER TABLE bets
    ADD CONSTRAINT bets_market_id_fkey FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE,
    ADD CONSTRAINT bets_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id);

ALTER TABLE skull_king_tables
    ADD CONSTRAINT skull_king_tables_host_user_id_fkey FOREIGN KEY (host_user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE corrections
    ADD CONSTRAINT corrections_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id);

ALTER TABLE global_arena_settlement
    ADD CONSTRAINT global_arena_settlement_player_id_fkey     FOREIGN KEY (player_id)     REFERENCES players(id),
    ADD CONSTRAINT global_arena_settlement_match_id_fkey      FOREIGN KEY (match_id)      REFERENCES matches(id),
    ADD CONSTRAINT global_arena_settlement_market_id_fkey     FOREIGN KEY (market_id)     REFERENCES markets(id),
    ADD CONSTRAINT global_arena_settlement_correction_id_fkey FOREIGN KEY (correction_id) REFERENCES corrections(id);

ALTER TABLE game_arena_settlement
    ADD CONSTRAINT game_arena_settlement_game_id_fkey   FOREIGN KEY (game_id)   REFERENCES games(id),
    ADD CONSTRAINT game_arena_settlement_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id),
    ADD CONSTRAINT game_arena_settlement_match_id_fkey  FOREIGN KEY (match_id)  REFERENCES matches(id);

-- ─── Cleanup helper ───────────────────────────────────────────────────────────
DROP FUNCTION int_array_to_uuid_array(INTEGER[]);
DROP FUNCTION int_to_uuid(INTEGER);
