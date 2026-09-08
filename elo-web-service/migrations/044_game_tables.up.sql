-- Generalize Skull King live tables into game tables (ADR-16):
-- skull_king_tables → game_tables, keyed by the game being played.
--
-- game_id references the well-known games.id constants pinned in code
-- (pkg/elo/game_ids.go): Skull King 00000000-0000-0000-0000-000000000188,
-- It's a Wonderful World 00000000-0000-0000-0000-000000000009. No FK on
-- purpose — the ids are app-level constants and every environment must carry
-- the rows anyway, but tests bootstrap only the games they need.
--
-- version is the optimistic-lock counter for game_state updates: host state
-- patches must carry the version they were based on; the server rejects
-- stale writes instead of silently erasing other players' input.
ALTER TABLE skull_king_tables RENAME TO game_tables;

ALTER INDEX skull_king_tables_expires_at_idx RENAME TO game_tables_expires_at_idx;

ALTER TABLE game_tables
    ADD COLUMN game_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000188',
    ADD COLUMN version BIGINT NOT NULL DEFAULT 1;
