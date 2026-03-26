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


-- outcome_markets: test markets in various statuses
-- First get the dev user's ID for created_by
DO $$
DECLARE
    dev_user_id INT;
BEGIN
    SELECT id INTO dev_user_id FROM users WHERE google_oauth_user_id = 'dev-user-001';

    -- bet_limit for players (formula: K / (1 + 10^((startingElo - playerElo) / D)) with K=32, D=400, startingElo=1000)
    UPDATE players SET bet_limit = 32.0 / (1.0 + POWER(10.0, (1000.0 - 1002.0534023250732) / 400.0)) WHERE id = 100;
    UPDATE players SET bet_limit = 32.0 / (1.0 + POWER(10.0, (1000.0 - 1008.1226527581842) / 400.0)) WHERE id = 101;
    UPDATE players SET bet_limit = 32.0 / (1.0 + POWER(10.0, (1000.0 - 989.8239449167427)  / 400.0)) WHERE id = 102;

    -- Market 1: open match_winner (Alice beats Bob in Skull King)
    INSERT INTO outcome_markets (id, market_type, status, starts_at, closes_at, created_by)
    VALUES (1, 'match_winner', 'open',
            NOW() - INTERVAL '1 day', NOW() + INTERVAL '7 days', dev_user_id)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO outcome_market_match_winner_params (market_id, target_player_id, required_player_ids, game_id)
    VALUES (1, 100, ARRAY[101], 50)
    ON CONFLICT (market_id) DO NOTHING;

    -- Market 2: open win_streak (Bob wins 3 times in Skull King, max 1 loss)
    INSERT INTO outcome_markets (id, market_type, status, starts_at, closes_at, created_by)
    VALUES (2, 'win_streak', 'open',
            NOW() - INTERVAL '2 days', NOW() + INTERVAL '5 days', dev_user_id)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO outcome_market_win_streak_params (market_id, target_player_id, game_id, wins_required, max_losses)
    VALUES (2, 101, 50, 3, 1)
    ON CONFLICT (market_id) DO NOTHING;

    -- Market 3: resolved_yes match_winner
    INSERT INTO outcome_markets (id, market_type, status, starts_at, closes_at, created_by, resolved_at, resolution_match_id)
    VALUES (3, 'match_winner', 'resolved_yes',
            NOW() - INTERVAL '10 days', NOW() - INTERVAL '6 days', dev_user_id, NOW() - INTERVAL '7 days', 200)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO outcome_market_match_winner_params (market_id, target_player_id, required_player_ids, game_id)
    VALUES (3, 100, ARRAY[101, 102], 50)
    ON CONFLICT (market_id) DO NOTHING;

    -- Market 4: cancelled match_winner (expired without matching match)
    INSERT INTO outcome_markets (id, market_type, status, starts_at, closes_at, created_by, resolved_at)
    VALUES (4, 'match_winner', 'cancelled',
            NOW() - INTERVAL '14 days', NOW() - INTERVAL '7 days', dev_user_id, NOW() - INTERVAL '7 days')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO outcome_market_match_winner_params (market_id, target_player_id, required_player_ids, game_id)
    VALUES (4, 102, ARRAY[100], NULL)
    ON CONFLICT (market_id) DO NOTHING;

    -- Bets on open market 1
    INSERT INTO outcome_bets (market_id, player_id, outcome, amount) VALUES
        (1, 100, 'yes', 5.0),
        (1, 101, 'no',  8.0),
        (1, 102, 'yes', 3.0),
        (1, 102, 'yes', 2.0);  -- Carol bets twice on yes

    -- Bets on open market 2
    INSERT INTO outcome_bets (market_id, player_id, outcome, amount) VALUES
        (2, 100, 'no',  6.0),
        (2, 101, 'yes', 10.0),
        (2, 102, 'no',  4.0);

    -- Bets + settlement for resolved market 3
    INSERT INTO outcome_bets (market_id, player_id, outcome, amount) VALUES
        (3, 100, 'yes', 8.0),
        (3, 101, 'no',  5.0),
        (3, 102, 'no',  7.0);

    -- Settlement details for market 3 (Alice won: total_pool=20, yes_pool=8)
    -- Alice (yes): earned = (8/8)*20 = 20
    -- Bob (no):    earned = 0
    -- Carol (no):  earned = 0
    INSERT INTO bet_settlement_details (market_id, player_id, staked, earned) VALUES
        (3, 100, 8.0, 20.0),
        (3, 101, 5.0,  0.0),
        (3, 102, 7.0,  0.0)
    ON CONFLICT (market_id, player_id) DO NOTHING;

    -- player_ratings for market 3 settlement
    INSERT INTO player_ratings (date, player_id, rating, source_type, market_id)
    VALUES
        (NOW() - INTERVAL '7 days', 100,
            1002.0534023250732 + (20.0 - 8.0), 'bet_settlement', 3),
        (NOW() - INTERVAL '7 days', 101,
            1008.1226527581842 + (0.0  - 5.0), 'bet_settlement', 3),
        (NOW() - INTERVAL '7 days', 102,
            989.8239449167427  + (0.0  - 7.0), 'bet_settlement', 3)
    ON CONFLICT (market_id, player_id) WHERE market_id IS NOT NULL DO NOTHING;
END $$;

-- Advance sequences so new inserts don't collide with seed IDs
SELECT setval('players_id_seq', GREATEST(200, (SELECT MAX(id) FROM players)));
SELECT setval('games_id_seq',   GREATEST(100, (SELECT MAX(id) FROM games)));
SELECT setval('matches_id_seq', GREATEST(300, (SELECT MAX(id) FROM matches)));
SELECT setval('clubs_id_seq',   GREATEST(10,  (SELECT MAX(id) FROM clubs)));
SELECT setval('player_ratings_id_seq', GREATEST(100, (SELECT MAX(id) FROM player_ratings)));
SELECT setval('outcome_markets_id_seq', GREATEST(10, (SELECT MAX(id) FROM outcome_markets)));
SELECT setval('outcome_bets_id_seq',    GREATEST(50, (SELECT MAX(id) FROM outcome_bets)));
