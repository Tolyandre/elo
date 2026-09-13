-- Game tags: a shared vocabulary of labels attached to games (many-to-many).
-- Ids are client-generated ULIDs stored as UUID (ADR-01 §22, ADR-06), same as
-- clubs/games: no default, inserts must supply one.

CREATE TABLE tags (
    id   UUID PRIMARY KEY,
    name TEXT NOT NULL,
    CONSTRAINT tags_name_unique UNIQUE (name)
);

CREATE TABLE game_tag (
    game_id UUID NOT NULL,
    tag_id  UUID NOT NULL,
    PRIMARY KEY (game_id, tag_id),
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id)  REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX game_tag_tag_idx ON game_tag (tag_id);

-- Tags are audited like clubs (created/deleted), so widen the entity CHECK.
ALTER TABLE audit_log DROP CONSTRAINT audit_log_entity_type_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_entity_type_check
    CHECK (entity_type IN ('match', 'game', 'player', 'club', 'tag'));
