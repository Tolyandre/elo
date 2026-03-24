-- Dev seed data. DO NOT apply to production.

-- Default club
INSERT INTO clubs (id, name) VALUES (1, 'Default Club')
ON CONFLICT (id) DO NOTHING;

-- User for mock-oauth2 login (sub matches mock-oauth2/main.go handleUserinfo)
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

-- match_scores: global_elo_pay/earn track global Elo deltas; game_elo_* track per-game Elo.
-- Both use the same values here since all matches are the same game (Skull King)
-- and all players start at 1000 Elo.
INSERT INTO match_scores (match_id, player_id, score, global_elo_pay, global_elo_earn, game_elo_pay, game_elo_earn, game_new_elo) VALUES
    (200, 100, 120.0, -10.666666666666666, 24.0,                 -10.666666666666666, 24.0,                 1013.3333333333334),
    (200, 101,  80.0, -10.666666666666666,  8.0,                 -10.666666666666666,  8.0,                  997.3333333333334),
    (200, 102,  60.0, -10.666666666666666,  0.0,                 -10.666666666666666,  0.0,                  989.3333333333334),
    (201, 100,  70.0, -11.2799310082602,    0.0,                 -11.2799310082602,    0.0,                 1002.0534023250732),
    (201, 101, 130.0, -10.544013908482446, 21.333333333333332,   -10.544013908482446, 21.333333333333332,   1008.1226527581842),
    (201, 102, 100.0, -10.176055083257353, 10.666666666666666,   -10.176055083257353, 10.666666666666666,    989.8239449167427)
ON CONFLICT (match_id, player_id) DO NOTHING;

-- player_ratings: global Elo after each match (source_type='match')
INSERT INTO player_ratings (date, player_id, rating, source_type, match_id)
SELECT m.date, ms.player_id,
    CASE (ms.match_id, ms.player_id)
        WHEN (200, 100) THEN 1013.3333333333334
        WHEN (200, 101) THEN  997.3333333333334
        WHEN (200, 102) THEN  989.3333333333334
        WHEN (201, 100) THEN 1002.0534023250732
        WHEN (201, 101) THEN 1008.1226527581842
        WHEN (201, 102) THEN  989.8239449167427
    END,
    'match', ms.match_id
FROM match_scores ms
JOIN matches m ON m.id = ms.match_id
WHERE ms.match_id IN (200, 201)
ON CONFLICT (match_id, player_id) WHERE match_id IS NOT NULL DO NOTHING;


-- Advance sequences so new inserts don't collide with seed IDs
SELECT setval('players_id_seq', GREATEST(200, (SELECT MAX(id) FROM players)));
SELECT setval('games_id_seq',   GREATEST(100, (SELECT MAX(id) FROM games)));
SELECT setval('matches_id_seq', GREATEST(300, (SELECT MAX(id) FROM matches)));
SELECT setval('clubs_id_seq',   GREATEST(10,  (SELECT MAX(id) FROM clubs)));
SELECT setval('player_ratings_id_seq', GREATEST(100, (SELECT MAX(id) FROM player_ratings)));
