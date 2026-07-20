-- Migration 037: Persist intermediate calculator state alongside a match.
--
-- When a match is created through a game calculator (Skull King, It's a
-- Wonderful World, …) the round/cell-by-cell breakdown that produced the final
-- per-player `score` is stored here so the match can be re-opened in the same
-- calculator (history mode) and re-edited. Matches not created via a calculator
-- leave all three columns NULL.
--
-- See ADR-09 for the rationale (normalized storage shape, JSON-schema validation
-- in the Go handler keyed by `calculator_kind`, startup data migrations).

ALTER TABLE matches
    ADD COLUMN calculator_kind            TEXT NULL,
    ADD COLUMN calculator_schema_version  INT  NULL,
    ADD COLUMN calculator_data            JSONB NULL;

-- kind ⇔ data ⇔ schema_version must always agree: either all three are set
-- (calculator-backed match) or all three are NULL (plain match).
ALTER TABLE matches
    ADD CONSTRAINT matches_calculator_kind_consistency CHECK (
        (calculator_kind IS NULL AND calculator_data IS NULL AND calculator_schema_version IS NULL)
        OR
        (calculator_kind IS NOT NULL AND calculator_data IS NOT NULL AND calculator_schema_version IS NOT NULL)
    );

-- Cheap way to enumerate / filter calculator-backed matches without scanning
-- the whole table. Partial index keeps the row count small.
CREATE INDEX matches_has_calculator_data_idx
    ON matches (id) WHERE calculator_kind IS NOT NULL;
