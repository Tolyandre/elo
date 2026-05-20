CREATE TABLE corrections (
    id            SERIAL PRIMARY KEY,
    player_id     INT  NOT NULL REFERENCES players(id),
    discriminator TEXT NOT NULL CHECK (discriminator IN ('correction')),
    diff          FLOAT NOT NULL,
    date          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX corrections_date_idx ON corrections (date);

ALTER TABLE global_arena_settlement
    ADD COLUMN correction_id INT NULL REFERENCES corrections(id);

ALTER TABLE global_arena_settlement
    DROP CONSTRAINT global_arena_settlement_discriminator_check;
ALTER TABLE global_arena_settlement
    ADD CONSTRAINT global_arena_settlement_discriminator_check
    CHECK (discriminator IN ('match', 'market', 'correction'));

CREATE UNIQUE INDEX global_arena_settlement_correction_unique
    ON global_arena_settlement (correction_id, player_id)
    WHERE correction_id IS NOT NULL;
