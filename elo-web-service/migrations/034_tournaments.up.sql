-- Tournaments ("кемпы"): a named, date-bounded event grouping players many-to-many.
-- A match may belong to several tournaments. Saving a tournament-tagged match
-- auto-enrols its players into the tournament. See adr/04-tournaments.md.

CREATE TABLE tournaments (
    id         SERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    start_date TIMESTAMP WITH TIME ZONE NOT NULL,
    end_date   TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT tournaments_name_unique UNIQUE (name)
);

CREATE TABLE tournament_player_membership (
    tournament_id INT NOT NULL,
    player_id     INT NOT NULL,
    PRIMARY KEY (tournament_id, player_id),
    -- player_id cascades (mirrors clubs); tournament_id does NOT, so a tournament
    -- with members cannot be deleted (also enforced explicitly in the service).
    FOREIGN KEY (player_id)     REFERENCES players(id)     ON DELETE CASCADE,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id)
);

CREATE TABLE match_tournament (
    match_id      INT NOT NULL,
    tournament_id INT NOT NULL,
    PRIMARY KEY (match_id, tournament_id),
    FOREIGN KEY (match_id)      REFERENCES matches(id)     ON DELETE CASCADE,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id)
);

-- Demo tournament for the 2026 Chelyabinsk camp + its members + back-filled matches.
-- utc+5 == the +05 offset. Members are all players whose name starts with "(Кэмп)".
WITH t AS (
    INSERT INTO tournaments (name, start_date, end_date)
    VALUES ('Челябинский игровой кэмп 2026',
            '2026-06-15 00:00:00+05', '2026-06-21 23:59:00+05')
    RETURNING id
), members AS (
    INSERT INTO tournament_player_membership (tournament_id, player_id)
    SELECT t.id, p.id FROM t, players p WHERE p.name LIKE '(Кэмп)%'
    RETURNING tournament_id, player_id
)
INSERT INTO match_tournament (match_id, tournament_id)
SELECT DISTINCT m.id, t.id
FROM t
JOIN matches m ON m.date >= '2026-06-15 00:00:00+05' AND m.date <= '2026-06-21 23:59:00+05'
JOIN match_scores ms ON ms.match_id = m.id
JOIN members mem ON mem.tournament_id = t.id AND mem.player_id = ms.player_id;
