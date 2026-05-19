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
INSERT INTO players (id, name) VALUES (100, 'Alice'), (101, 'Bob'), (102, 'Carol'), (103, 'Dave')
ON CONFLICT (id) DO NOTHING;

INSERT INTO player_club_membership (club_id, player_id) VALUES (1,100),(1,101),(1,102),(1,103)
ON CONFLICT (club_id, player_id) DO NOTHING;

-- Test matches
INSERT INTO games (id, name) VALUES (50, 'Skull King') ON CONFLICT (id) DO NOTHING;

INSERT INTO matches (id, date, game_id) VALUES
    (200, NOW() - INTERVAL '7 days', 50),
    (201, NOW() - INTERVAL '3 days', 50),
    (202, NOW() - INTERVAL '1 day',  50)
ON CONFLICT (id) DO NOTHING;

-- match_scores: only score, no Elo columns (moved to global_arena_settlement / game_arena_settlement)
INSERT INTO match_scores (match_id, player_id, score) VALUES
    (200, 100, 120.0),
    (200, 101,  80.0),
    (200, 102,  60.0),
    (201, 100,  70.0),
    (201, 101, 130.0),
    (201, 102, 100.0)
ON CONFLICT (match_id, player_id) DO NOTHING;

INSERT INTO match_scores (match_id, player_id, score) VALUES
    (202, 103, 110.0),
    (202, 100,  90.0),
    (202, 101,  70.0),
    (202, 102,  50.0)
ON CONFLICT (match_id, player_id) DO NOTHING;

-- global_arena_settlement: global Elo after each match (discriminator='match').
-- staked = rating_pay (negative), earned = rating_earn (non-negative).
-- new_rating = prev_rating + earned + staked.
INSERT INTO global_arena_settlement (date, player_id, new_rating, discriminator, match_id, staked, earned)
SELECT m.date, ms.player_id,
    CASE (ms.match_id, ms.player_id)
        WHEN (200, 100) THEN 1013.3333333333334
        WHEN (200, 101) THEN  997.3333333333334
        WHEN (200, 102) THEN  989.3333333333334
        WHEN (201, 100) THEN 1002.0534023250732
        WHEN (201, 101) THEN 1008.1226527581842
        WHEN (201, 102) THEN  989.8239449167427
    END,
    'match', ms.match_id,
    CASE (ms.match_id, ms.player_id)
        WHEN (200, 100) THEN -10.666666666666666
        WHEN (200, 101) THEN -10.666666666666666
        WHEN (200, 102) THEN -10.666666666666666
        WHEN (201, 100) THEN -11.2799310082602
        WHEN (201, 101) THEN -10.544013908482446
        WHEN (201, 102) THEN -10.176055083257353
    END,
    CASE (ms.match_id, ms.player_id)
        WHEN (200, 100) THEN 24.0
        WHEN (200, 101) THEN  8.0
        WHEN (200, 102) THEN  0.0
        WHEN (201, 100) THEN  0.0
        WHEN (201, 101) THEN 21.333333333333332
        WHEN (201, 102) THEN 10.666666666666666
    END
FROM match_scores ms
JOIN matches m ON m.id = ms.match_id
WHERE ms.match_id IN (200, 201)
ON CONFLICT (match_id, player_id) WHERE match_id IS NOT NULL DO NOTHING;

-- global_arena_settlement for match 202
INSERT INTO global_arena_settlement (date, player_id, new_rating, discriminator, match_id, staked, earned)
SELECT m.date, ms.player_id,
    CASE (ms.match_id, ms.player_id)
        WHEN (202, 103) THEN 1008.0
        WHEN (202, 100) THEN 1004.6571570250732
        WHEN (202, 101) THEN 1005.2067380581842
        WHEN (202, 102) THEN  982.1361049167427
    END,
    'match', ms.match_id,
    CASE (ms.match_id, ms.player_id)
        WHEN (202, 103) THEN  -8.0
        WHEN (202, 100) THEN  -8.062912
        WHEN (202, 101) THEN  -8.249248
        WHEN (202, 102) THEN  -7.687840
    END,
    CASE (ms.match_id, ms.player_id)
        WHEN (202, 103) THEN 16.0
        WHEN (202, 100) THEN 10.666666666666666
        WHEN (202, 101) THEN  5.333333333333333
        WHEN (202, 102) THEN  0.0
    END
FROM match_scores ms
JOIN matches m ON m.id = ms.match_id
WHERE ms.match_id = 202
ON CONFLICT (match_id, player_id) WHERE match_id IS NOT NULL DO NOTHING;

-- game_arena_settlement: per-game Elo after each match.
-- staked = game_elo_pay (negative), earned = game_elo_earn (non-negative).
-- All matches are Skull King (game_id=50), so game Elo equals global Elo here.
INSERT INTO game_arena_settlement (game_id, player_id, date, new_rating, discriminator, match_id, staked, earned)
SELECT 50, ms.player_id, m.date,
    CASE (ms.match_id, ms.player_id)
        WHEN (200, 100) THEN 1013.3333333333334
        WHEN (200, 101) THEN  997.3333333333334
        WHEN (200, 102) THEN  989.3333333333334
        WHEN (201, 100) THEN 1002.0534023250732
        WHEN (201, 101) THEN 1008.1226527581842
        WHEN (201, 102) THEN  989.8239449167427
    END,
    'match', ms.match_id,
    CASE (ms.match_id, ms.player_id)
        WHEN (200, 100) THEN -10.666666666666666
        WHEN (200, 101) THEN -10.666666666666666
        WHEN (200, 102) THEN -10.666666666666666
        WHEN (201, 100) THEN -11.2799310082602
        WHEN (201, 101) THEN -10.544013908482446
        WHEN (201, 102) THEN -10.176055083257353
    END,
    CASE (ms.match_id, ms.player_id)
        WHEN (200, 100) THEN 24.0
        WHEN (200, 101) THEN  8.0
        WHEN (200, 102) THEN  0.0
        WHEN (201, 100) THEN  0.0
        WHEN (201, 101) THEN 21.333333333333332
        WHEN (201, 102) THEN 10.666666666666666
    END
FROM match_scores ms
JOIN matches m ON m.id = ms.match_id
WHERE ms.match_id IN (200, 201)
ON CONFLICT (match_id, player_id) WHERE match_id IS NOT NULL DO NOTHING;

INSERT INTO game_arena_settlement (game_id, player_id, date, new_rating, discriminator, match_id, staked, earned)
SELECT 50, ms.player_id, m.date,
    CASE (ms.match_id, ms.player_id)
        WHEN (202, 103) THEN 1008.0
        WHEN (202, 100) THEN 1004.6571570250732
        WHEN (202, 101) THEN 1005.2067380581842
        WHEN (202, 102) THEN  982.1361049167427
    END,
    'match', ms.match_id,
    CASE (ms.match_id, ms.player_id)
        WHEN (202, 103) THEN  -8.0
        WHEN (202, 100) THEN  -8.062912
        WHEN (202, 101) THEN  -8.249248
        WHEN (202, 102) THEN  -7.687840
    END,
    CASE (ms.match_id, ms.player_id)
        WHEN (202, 103) THEN 16.0
        WHEN (202, 100) THEN 10.666666666666666
        WHEN (202, 101) THEN  5.333333333333333
        WHEN (202, 102) THEN  0.0
    END
FROM match_scores ms
JOIN matches m ON m.id = ms.match_id
WHERE ms.match_id = 202
ON CONFLICT (match_id, player_id) WHERE match_id IS NOT NULL DO NOTHING;

-- markets: test markets in various statuses
-- First get the dev user's ID for created_by
DO $$
DECLARE
    dev_user_id INT;
BEGIN
    SELECT id INTO dev_user_id FROM users WHERE google_oauth_user_id = 'dev-user-001';

    -- bet_limit for players (formula: K / (1 + 10^((startingElo - playerElo) / D)) with K=32, D=400, startingElo=1000)
    -- bet_limits based on final Elo after match 202
    UPDATE players SET bet_limit = 32.0 / (1.0 + POWER(10.0, (1000.0 - 1004.6571570250732) / 400.0)) WHERE id = 100;
    UPDATE players SET bet_limit = 32.0 / (1.0 + POWER(10.0, (1000.0 - 1005.2067380581842) / 400.0)) WHERE id = 101;
    UPDATE players SET bet_limit = 32.0 / (1.0 + POWER(10.0, (1000.0 - 982.1361049167427)  / 400.0)) WHERE id = 102;
    UPDATE players SET bet_limit = 32.0 / (1.0 + POWER(10.0, (1000.0 - 1008.0)             / 400.0)) WHERE id = 103;

    -- Market 1: open match_winner (Alice beats Bob in Skull King)
    INSERT INTO markets (id, market_type, status, starts_at, closes_at, created_by)
    VALUES (1, 'match_winner', 'open',
            NOW() - INTERVAL '1 day', NOW() + INTERVAL '7 days', dev_user_id)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO market_match_winner_params (market_id, target_player_id, required_player_ids, game_ids)
    VALUES (1, 100, ARRAY[101], ARRAY[50])
    ON CONFLICT (market_id) DO NOTHING;

    -- Market 2: open win_streak (Bob wins 3 times in Skull King, max 1 loss)
    INSERT INTO markets (id, market_type, status, starts_at, closes_at, created_by)
    VALUES (2, 'win_streak', 'open',
            NOW() - INTERVAL '2 days', NOW() + INTERVAL '5 days', dev_user_id)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO market_win_streak_params (market_id, target_player_id, game_ids, wins_required, max_losses)
    VALUES (2, 101, ARRAY[50], 3, 1)
    ON CONFLICT (market_id) DO NOTHING;

    -- Market 3: resolved match_winner (outcome: yes)
    INSERT INTO markets (id, market_type, status, starts_at, closes_at, created_by, resolved_at, resolution_match_id, resolution_outcome)
    VALUES (3, 'match_winner', 'resolved',
            NOW() - INTERVAL '10 days', NOW() - INTERVAL '6 days', dev_user_id, NOW() - INTERVAL '7 days', 200, 'yes')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO market_match_winner_params (market_id, target_player_id, required_player_ids, game_ids)
    VALUES (3, 100, ARRAY[101, 102], ARRAY[50])
    ON CONFLICT (market_id) DO NOTHING;

    -- Market 4: cancelled match_winner (expired without matching match)
    INSERT INTO markets (id, market_type, status, starts_at, closes_at, created_by, resolved_at)
    VALUES (4, 'match_winner', 'cancelled',
            NOW() - INTERVAL '14 days', NOW() - INTERVAL '7 days', dev_user_id, NOW() - INTERVAL '7 days')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO market_match_winner_params (market_id, target_player_id, required_player_ids, game_ids)
    VALUES (4, 102, ARRAY[100], ARRAY[]::int[])
    ON CONFLICT (market_id) DO NOTHING;

    -- Bets on open market 1
    INSERT INTO bets (market_id, player_id, outcome, amount) VALUES
        (1, 100, 'yes', 5.0),
        (1, 101, 'no',  8.0),
        (1, 102, 'yes', 3.0),
        (1, 102, 'yes', 2.0);  -- Carol bets twice on yes

    -- Bets on open market 2
    INSERT INTO bets (market_id, player_id, outcome, amount) VALUES
        (2, 100, 'no',  6.0),
        (2, 101, 'yes', 10.0),
        (2, 102, 'no',  4.0);

    -- Bets + settlement for resolved market 3
    INSERT INTO bets (market_id, player_id, outcome, amount) VALUES
        (3, 100, 'yes', 8.0),
        (3, 101, 'no',  5.0),
        (3, 102, 'no',  7.0);

    -- global_arena_settlement for market 3 (discriminator='market').
    -- Settlement: Alice (yes): earned=20, staked=-8; Bob: earned=0, staked=-5; Carol: earned=0, staked=-7.
    -- new_rating = prev_global_elo + earned + staked
    -- Prev Elo at resolution date (after match 201, before match 202):
    --   Alice=1002.0534, Bob=1008.1226, Carol=989.8239
    INSERT INTO global_arena_settlement (date, player_id, new_rating, discriminator, market_id, staked, earned)
    VALUES
        (NOW() - INTERVAL '7 days', 100,
            1002.0534023250732 + (20.0 - 8.0), 'market', 3, -8.0, 20.0),
        (NOW() - INTERVAL '7 days', 101,
            1008.1226527581842 + (0.0  - 5.0), 'market', 3, -5.0,  0.0),
        (NOW() - INTERVAL '7 days', 102,
            989.8239449167427  + (0.0  - 7.0), 'market', 3, -7.0,  0.0)
    ON CONFLICT (market_id, player_id) WHERE market_id IS NOT NULL DO NOTHING;
END $$;

-- Advance sequences so new inserts don't collide with seed IDs
SELECT setval('players_id_seq', GREATEST(200, (SELECT MAX(id) FROM players)));
SELECT setval('games_id_seq',   GREATEST(100, (SELECT MAX(id) FROM games)));
SELECT setval('matches_id_seq', GREATEST(300, (SELECT MAX(id) FROM matches)));
SELECT setval('clubs_id_seq',   GREATEST(10,  (SELECT MAX(id) FROM clubs)));
SELECT setval('global_arena_settlement_id_seq', GREATEST(100, (SELECT MAX(id) FROM global_arena_settlement)));
SELECT setval('markets_id_seq', GREATEST(10, (SELECT MAX(id) FROM markets)));
SELECT setval('bets_id_seq',    GREATEST(50, (SELECT MAX(id) FROM bets)));
