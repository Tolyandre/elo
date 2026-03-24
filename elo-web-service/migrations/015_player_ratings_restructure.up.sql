-- 1a. Make game_elo columns NOT NULL (all values confirmed non-null)
ALTER TABLE match_scores
    ALTER COLUMN game_elo_pay  SET NOT NULL,
    ALTER COLUMN game_elo_earn SET NOT NULL,
    ALTER COLUMN game_new_elo  SET NOT NULL;

-- 1b. Drop and recreate player_ratings with new schema (table is currently empty)
DROP TABLE player_ratings;

CREATE TABLE player_ratings (
    id          SERIAL                   NOT NULL PRIMARY KEY,
    date        TIMESTAMP WITH TIME ZONE NOT NULL,
    player_id   INT                      NOT NULL,
    rating      FLOAT                    NOT NULL,
    source_type TEXT                     NOT NULL DEFAULT 'match',
    match_id    INT                      NULL,
    FOREIGN KEY (player_id)           REFERENCES players(id),
    FOREIGN KEY (match_id, player_id) REFERENCES match_scores(match_id, player_id)
        ON DELETE CASCADE
);

-- Partial unique index enables ON CONFLICT upserts for match-sourced rows
CREATE UNIQUE INDEX player_ratings_match_unique
    ON player_ratings (match_id, player_id)
    WHERE match_id IS NOT NULL;

-- 1c. Backfill global Elo history from match_scores into player_ratings
INSERT INTO player_ratings (date, player_id, rating, source_type, match_id)
SELECT m.date, ms.player_id, ms.global_new_elo, 'match', ms.match_id
FROM match_scores ms
JOIN matches m ON m.id = ms.match_id
ORDER BY m.date, m.id;

-- 1d. Remove global_new_elo from match_scores (now tracked in player_ratings)
ALTER TABLE match_scores DROP COLUMN global_new_elo;
