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

INSERT INTO public.tags (id,"name") VALUES
	 ('01a09d03-b49e-7799-ada3-6ffa44981686'::uuid,'Евро'),
	 ('01a09d04-cff6-7ef1-be97-267e89b470b1'::uuid,'Взятки и избавление от карт'),
	 ('01a09d04-e2a3-772c-97fa-59ac147df7be'::uuid,'Кланк');
