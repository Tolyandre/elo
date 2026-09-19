-- The elimination family is no longer a creation-time choice (ADR-26): the
-- shape picker offers both families' plans and the chosen plan's family is
-- stamped onto the tournament at start. NULL until then.
ALTER TABLE tournaments ALTER COLUMN elimination DROP NOT NULL;
