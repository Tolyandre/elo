-- Dev seed data. DO NOT apply to production.

-- Default club
INSERT INTO clubs (id, name) VALUES (1, 'Default Club')
ON CONFLICT (id) DO NOTHING;

-- User for Dex login (userID matches dex/config.dev.yaml staticPasswords[0].userID)
INSERT INTO users (allow_editing, google_oauth_user_id, google_oauth_user_name)
VALUES (true, 'dev-user-001', 'Dev User')
ON CONFLICT (google_oauth_user_id) DO UPDATE
    SET allow_editing = EXCLUDED.allow_editing,
        google_oauth_user_name = EXCLUDED.google_oauth_user_name;

-- Test players
INSERT INTO players (id, name) VALUES (100, 'Alice'), (101, 'Bob'), (102, 'Carol')
ON CONFLICT (id) DO NOTHING;

INSERT INTO player_club_membership (club_id, player_id) VALUES (1,100),(1,101),(1,102)
ON CONFLICT (club_id, player_id) DO NOTHING;

-- Test matches
INSERT INTO games (id, name) VALUES (50, 'Skull King') ON CONFLICT (id) DO NOTHING;

INSERT INTO matches (id, date, game_id) VALUES
    (200, NOW() - INTERVAL '7 days', 50),
    (201, NOW() - INTERVAL '3 days', 50)
ON CONFLICT (id) DO NOTHING;

INSERT INTO match_scores (match_id, player_id, score) VALUES
    (200,100,120),(200,101,80),(200,102,60),
    (201,100,70),(201,101,130),(201,102,100)
ON CONFLICT (match_id, player_id) DO NOTHING;

-- Advance sequences so new inserts don't collide with seed IDs
SELECT setval('players_id_seq', GREATEST(200, (SELECT MAX(id) FROM players)));
SELECT setval('games_id_seq',   GREATEST(100, (SELECT MAX(id) FROM games)));
SELECT setval('matches_id_seq', GREATEST(300, (SELECT MAX(id) FROM matches)));
SELECT setval('clubs_id_seq',   GREATEST(10,  (SELECT MAX(id) FROM clubs)));
