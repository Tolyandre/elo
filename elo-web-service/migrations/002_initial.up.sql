CREATE TABLE IF NOT EXISTS players (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    geologist_name TEXT NULL,
    google_sheet_column INT NULL
);

CREATE TABLE IF NOT EXISTS player_club_membership (
    club_id INT NOT NULL,
    player_id INT NOT NULL,
    PRIMARY KEY (club_id, player_id),
    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
    FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS games (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
    id SERIAL PRIMARY KEY,
    date TIMESTAMP WITH TIME ZONE NOT NULL,
    game_id INT NOT NULL,
    google_sheet_row INT NULL,
    FOREIGN KEY (game_id) REFERENCES games(id)
);

CREATE TABLE IF NOT EXISTS match_scores (
    match_id INT NOT NULL,
    player_id INT NOT NULL,
    score FLOAT NOT NULL,
    PRIMARY KEY (match_id, player_id),
    FOREIGN KEY (match_id) REFERENCES matches(id),
    FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS player_ratings (
    date TIMESTAMP WITH TIME ZONE NOT NULL,
    player_id INT NOT NULL,
    rating FLOAT NOT NULL,
    PRIMARY KEY (date, player_id),
    FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS users (
    id SERIAL NOT NULL,
    allow_editing BOOLEAN NOT NULL,
    google_oauth_user_id TEXT NOT NULL UNIQUE,
    google_oauth_user_name TEXT NOT NULL,
    PRIMARY KEY (id)
);