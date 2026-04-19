CREATE TABLE skull_king_tables (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    host_user_id          INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_state            JSONB       NOT NULL,
    connected_player_ids  INTEGER[]   NOT NULL DEFAULT '{}',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at            TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 day'
);

CREATE INDEX skull_king_tables_expires_at_idx ON skull_king_tables (expires_at);
