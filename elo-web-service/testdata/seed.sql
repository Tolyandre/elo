-- Dev seed data. DO NOT apply to production.

-- Default club
INSERT INTO clubs (id, name) VALUES ('00000000-0000-0000-0000-000000000001', 'Default Club')
ON CONFLICT (id) DO NOTHING;

-- User for mock-oauth2 login (the mock login page lists users from this table)
-- Uses a different id from the 035_schema user (116214603310517670471) to avoid PK conflict.
INSERT INTO users (id, allow_editing, google_oauth_user_id, google_oauth_user_name)
VALUES ('00000000-0000-0000-0000-000000000002', true, 'dev-user-001', 'Dev User')
ON CONFLICT (google_oauth_user_id) DO UPDATE
    SET allow_editing = EXCLUDED.allow_editing,
        google_oauth_user_name = EXCLUDED.google_oauth_user_name;

-- Test players
INSERT INTO players (id, name) VALUES
    ('00000000-0000-0000-0000-000000000064', 'Alice'),
    ('00000000-0000-0000-0000-000000000065', 'Bob'),
    ('00000000-0000-0000-0000-000000000066', 'Carol'),
    ('00000000-0000-0000-0000-000000000067', 'Dave')
ON CONFLICT (id) DO NOTHING;

INSERT INTO player_club_membership (club_id, player_id) VALUES
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000064'),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000065'),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000066'),
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000067')
ON CONFLICT (club_id, player_id) DO NOTHING;

-- Test matches. Game ids are the well-known constants pinned in
-- pkg/elo/game_ids.go (Skull King 0x188, IAWW 0x9).
INSERT INTO games (id, name) VALUES
    ('00000000-0000-0000-0000-000000000188', 'Skull King'),
    ('00000000-0000-0000-0000-000000000009', 'Этот Безумный Мир')
ON CONFLICT (id) DO NOTHING;

INSERT INTO matches (id, date, game_id) VALUES
    ('00000000-0000-0000-0000-0000000000c8', NOW() - INTERVAL '7 days', '00000000-0000-0000-0000-000000000188'),
    ('00000000-0000-0000-0000-0000000000c9', NOW() - INTERVAL '3 days', '00000000-0000-0000-0000-000000000188'),
    ('00000000-0000-0000-0000-0000000000ca', NOW() - INTERVAL '1 day',  '00000000-0000-0000-0000-000000000188')
ON CONFLICT (id) DO NOTHING;

-- match_scores: only score, no Elo columns (moved to global_arena_settlement / game_arena_settlement)
INSERT INTO match_scores (match_id, player_id, score) VALUES
    ('00000000-0000-0000-0000-0000000000c8', '00000000-0000-0000-0000-000000000064', 120.0),
    ('00000000-0000-0000-0000-0000000000c8', '00000000-0000-0000-0000-000000000065',  80.0),
    ('00000000-0000-0000-0000-0000000000c8', '00000000-0000-0000-0000-000000000066',  60.0),
    ('00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-000000000064',  70.0),
    ('00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-000000000065', 130.0),
    ('00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-000000000066', 100.0)
ON CONFLICT (match_id, player_id) DO NOTHING;

INSERT INTO match_scores (match_id, player_id, score) VALUES
    ('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-000000000067', 110.0),
    ('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-000000000064',  90.0),
    ('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-000000000065',  70.0),
    ('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-000000000066',  50.0)
ON CONFLICT (match_id, player_id) DO NOTHING;

-- global_arena_settlement: global Elo after each match (discriminator='match').
-- Convention: elo_after=rating_after, elo_*=rating_* (dual-track values identical for seeded data), league='amateur'.
WITH base AS (
    SELECT m.date, ms.player_id, ms.match_id,
        CASE (ms.match_id, ms.player_id)
            WHEN ('00000000-0000-0000-0000-0000000000c8'::uuid, '00000000-0000-0000-0000-000000000064'::uuid) THEN 1013.3333333333334
            WHEN ('00000000-0000-0000-0000-0000000000c8'::uuid, '00000000-0000-0000-0000-000000000065'::uuid) THEN  997.3333333333334
            WHEN ('00000000-0000-0000-0000-0000000000c8'::uuid, '00000000-0000-0000-0000-000000000066'::uuid) THEN  989.3333333333334
            WHEN ('00000000-0000-0000-0000-0000000000c9'::uuid, '00000000-0000-0000-0000-000000000064'::uuid) THEN 1002.0534023250732
            WHEN ('00000000-0000-0000-0000-0000000000c9'::uuid, '00000000-0000-0000-0000-000000000065'::uuid) THEN 1008.1226527581842
            WHEN ('00000000-0000-0000-0000-0000000000c9'::uuid, '00000000-0000-0000-0000-000000000066'::uuid) THEN  989.8239449167427
        END AS new_rating,
        CASE (ms.match_id, ms.player_id)
            WHEN ('00000000-0000-0000-0000-0000000000c8'::uuid, '00000000-0000-0000-0000-000000000064'::uuid) THEN -10.666666666666666
            WHEN ('00000000-0000-0000-0000-0000000000c8'::uuid, '00000000-0000-0000-0000-000000000065'::uuid) THEN -10.666666666666666
            WHEN ('00000000-0000-0000-0000-0000000000c8'::uuid, '00000000-0000-0000-0000-000000000066'::uuid) THEN -10.666666666666666
            WHEN ('00000000-0000-0000-0000-0000000000c9'::uuid, '00000000-0000-0000-0000-000000000064'::uuid) THEN -11.2799310082602
            WHEN ('00000000-0000-0000-0000-0000000000c9'::uuid, '00000000-0000-0000-0000-000000000065'::uuid) THEN -10.544013908482446
            WHEN ('00000000-0000-0000-0000-0000000000c9'::uuid, '00000000-0000-0000-0000-000000000066'::uuid) THEN -10.176055083257353
        END AS staked,
        CASE (ms.match_id, ms.player_id)
            WHEN ('00000000-0000-0000-0000-0000000000c8'::uuid, '00000000-0000-0000-0000-000000000064'::uuid) THEN 24.0
            WHEN ('00000000-0000-0000-0000-0000000000c8'::uuid, '00000000-0000-0000-0000-000000000065'::uuid) THEN  8.0
            WHEN ('00000000-0000-0000-0000-0000000000c8'::uuid, '00000000-0000-0000-0000-000000000066'::uuid) THEN  0.0
            WHEN ('00000000-0000-0000-0000-0000000000c9'::uuid, '00000000-0000-0000-0000-000000000064'::uuid) THEN  0.0
            WHEN ('00000000-0000-0000-0000-0000000000c9'::uuid, '00000000-0000-0000-0000-000000000065'::uuid) THEN 21.333333333333332
            WHEN ('00000000-0000-0000-0000-0000000000c9'::uuid, '00000000-0000-0000-0000-000000000066'::uuid) THEN 10.666666666666666
        END AS earned
    FROM match_scores ms JOIN matches m ON m.id = ms.match_id
    WHERE ms.match_id IN ('00000000-0000-0000-0000-0000000000c8'::uuid, '00000000-0000-0000-0000-0000000000c9'::uuid)
)
INSERT INTO global_arena_settlement
    (id, date, player_id, rating_after, elo_after, discriminator, match_id, elo_staked, elo_earned, rating_staked, rating_earned, league)
SELECT gen_random_uuid(), date, player_id, new_rating, new_rating, 'match', match_id, staked, earned, staked, earned, 'amateur'
FROM base
ON CONFLICT (match_id, player_id) WHERE match_id IS NOT NULL DO NOTHING;

-- global_arena_settlement for match 202
WITH base AS (
    SELECT m.date, ms.player_id, ms.match_id,
        CASE (ms.match_id, ms.player_id)
            WHEN ('00000000-0000-0000-0000-0000000000ca'::uuid, '00000000-0000-0000-0000-000000000067'::uuid) THEN 1008.0
            WHEN ('00000000-0000-0000-0000-0000000000ca'::uuid, '00000000-0000-0000-0000-000000000064'::uuid) THEN 1004.6571570250732
            WHEN ('00000000-0000-0000-0000-0000000000ca'::uuid, '00000000-0000-0000-0000-000000000065'::uuid) THEN 1005.2067380581842
            WHEN ('00000000-0000-0000-0000-0000000000ca'::uuid, '00000000-0000-0000-0000-000000000066'::uuid) THEN  982.1361049167427
        END AS new_rating,
        CASE (ms.match_id, ms.player_id)
            WHEN ('00000000-0000-0000-0000-0000000000ca'::uuid, '00000000-0000-0000-0000-000000000067'::uuid) THEN  -8.0
            WHEN ('00000000-0000-0000-0000-0000000000ca'::uuid, '00000000-0000-0000-0000-000000000064'::uuid) THEN  -8.062912
            WHEN ('00000000-0000-0000-0000-0000000000ca'::uuid, '00000000-0000-0000-0000-000000000065'::uuid) THEN  -8.249248
            WHEN ('00000000-0000-0000-0000-0000000000ca'::uuid, '00000000-0000-0000-0000-000000000066'::uuid) THEN  -7.687840
        END AS staked,
        CASE (ms.match_id, ms.player_id)
            WHEN ('00000000-0000-0000-0000-0000000000ca'::uuid, '00000000-0000-0000-0000-000000000067'::uuid) THEN 16.0
            WHEN ('00000000-0000-0000-0000-0000000000ca'::uuid, '00000000-0000-0000-0000-000000000064'::uuid) THEN 10.666666666666666
            WHEN ('00000000-0000-0000-0000-0000000000ca'::uuid, '00000000-0000-0000-0000-000000000065'::uuid) THEN  5.333333333333333
            WHEN ('00000000-0000-0000-0000-0000000000ca'::uuid, '00000000-0000-0000-0000-000000000066'::uuid) THEN  0.0
        END AS earned
    FROM match_scores ms JOIN matches m ON m.id = ms.match_id
    WHERE ms.match_id = '00000000-0000-0000-0000-0000000000ca'::uuid
)
INSERT INTO global_arena_settlement
    (id, date, player_id, rating_after, elo_after, discriminator, match_id, elo_staked, elo_earned, rating_staked, rating_earned, league)
SELECT gen_random_uuid(), date, player_id, new_rating, new_rating, 'match', match_id, staked, earned, staked, earned, 'amateur'
FROM base
ON CONFLICT (match_id, player_id) WHERE match_id IS NOT NULL DO NOTHING;

-- game_arena_settlement: per-game Elo after each match.
-- All matches are Skull King (game_id=0x188), so game Elo equals global Elo here.
WITH base AS (
    SELECT m.date, ms.player_id, ms.match_id,
        CASE (ms.match_id, ms.player_id)
            WHEN ('00000000-0000-0000-0000-0000000000c8'::uuid, '00000000-0000-0000-0000-000000000064'::uuid) THEN 1013.3333333333334
            WHEN ('00000000-0000-0000-0000-0000000000c8'::uuid, '00000000-0000-0000-0000-000000000065'::uuid) THEN  997.3333333333334
            WHEN ('00000000-0000-0000-0000-0000000000c8'::uuid, '00000000-0000-0000-0000-000000000066'::uuid) THEN  989.3333333333334
            WHEN ('00000000-0000-0000-0000-0000000000c9'::uuid, '00000000-0000-0000-0000-000000000064'::uuid) THEN 1002.0534023250732
            WHEN ('00000000-0000-0000-0000-0000000000c9'::uuid, '00000000-0000-0000-0000-000000000065'::uuid) THEN 1008.1226527581842
            WHEN ('00000000-0000-0000-0000-0000000000c9'::uuid, '00000000-0000-0000-0000-000000000066'::uuid) THEN  989.8239449167427
        END AS new_rating,
        CASE (ms.match_id, ms.player_id)
            WHEN ('00000000-0000-0000-0000-0000000000c8'::uuid, '00000000-0000-0000-0000-000000000064'::uuid) THEN -10.666666666666666
            WHEN ('00000000-0000-0000-0000-0000000000c8'::uuid, '00000000-0000-0000-0000-000000000065'::uuid) THEN -10.666666666666666
            WHEN ('00000000-0000-0000-0000-0000000000c8'::uuid, '00000000-0000-0000-0000-000000000066'::uuid) THEN -10.666666666666666
            WHEN ('00000000-0000-0000-0000-0000000000c9'::uuid, '00000000-0000-0000-0000-000000000064'::uuid) THEN -11.2799310082602
            WHEN ('00000000-0000-0000-0000-0000000000c9'::uuid, '00000000-0000-0000-0000-000000000065'::uuid) THEN -10.544013908482446
            WHEN ('00000000-0000-0000-0000-0000000000c9'::uuid, '00000000-0000-0000-0000-000000000066'::uuid) THEN -10.176055083257353
        END AS staked,
        CASE (ms.match_id, ms.player_id)
            WHEN ('00000000-0000-0000-0000-0000000000c8'::uuid, '00000000-0000-0000-0000-000000000064'::uuid) THEN 24.0
            WHEN ('00000000-0000-0000-0000-0000000000c8'::uuid, '00000000-0000-0000-0000-000000000065'::uuid) THEN  8.0
            WHEN ('00000000-0000-0000-0000-0000000000c8'::uuid, '00000000-0000-0000-0000-000000000066'::uuid) THEN  0.0
            WHEN ('00000000-0000-0000-0000-0000000000c9'::uuid, '00000000-0000-0000-0000-000000000064'::uuid) THEN  0.0
            WHEN ('00000000-0000-0000-0000-0000000000c9'::uuid, '00000000-0000-0000-0000-000000000065'::uuid) THEN 21.333333333333332
            WHEN ('00000000-0000-0000-0000-0000000000c9'::uuid, '00000000-0000-0000-0000-000000000066'::uuid) THEN 10.666666666666666
        END AS earned
    FROM match_scores ms JOIN matches m ON m.id = ms.match_id
    WHERE ms.match_id IN ('00000000-0000-0000-0000-0000000000c8'::uuid, '00000000-0000-0000-0000-0000000000c9'::uuid)
)
INSERT INTO game_arena_settlement
    (id, game_id, player_id, date, rating_after, elo_after, discriminator, match_id, elo_staked, elo_earned, rating_staked, rating_earned, league)
SELECT gen_random_uuid(), '00000000-0000-0000-0000-000000000188'::uuid, player_id, date, new_rating, new_rating, 'match', match_id, staked, earned, staked, earned, 'amateur'
FROM base
ON CONFLICT (match_id, player_id) WHERE match_id IS NOT NULL DO NOTHING;

WITH base AS (
    SELECT m.date, ms.player_id, ms.match_id,
        CASE (ms.match_id, ms.player_id)
            WHEN ('00000000-0000-0000-0000-0000000000ca'::uuid, '00000000-0000-0000-0000-000000000067'::uuid) THEN 1008.0
            WHEN ('00000000-0000-0000-0000-0000000000ca'::uuid, '00000000-0000-0000-0000-000000000064'::uuid) THEN 1004.6571570250732
            WHEN ('00000000-0000-0000-0000-0000000000ca'::uuid, '00000000-0000-0000-0000-000000000065'::uuid) THEN 1005.2067380581842
            WHEN ('00000000-0000-0000-0000-0000000000ca'::uuid, '00000000-0000-0000-0000-000000000066'::uuid) THEN  982.1361049167427
        END AS new_rating,
        CASE (ms.match_id, ms.player_id)
            WHEN ('00000000-0000-0000-0000-0000000000ca'::uuid, '00000000-0000-0000-0000-000000000067'::uuid) THEN  -8.0
            WHEN ('00000000-0000-0000-0000-0000000000ca'::uuid, '00000000-0000-0000-0000-000000000064'::uuid) THEN  -8.062912
            WHEN ('00000000-0000-0000-0000-0000000000ca'::uuid, '00000000-0000-0000-0000-000000000065'::uuid) THEN  -8.249248
            WHEN ('00000000-0000-0000-0000-0000000000ca'::uuid, '00000000-0000-0000-0000-000000000066'::uuid) THEN  -7.687840
        END AS staked,
        CASE (ms.match_id, ms.player_id)
            WHEN ('00000000-0000-0000-0000-0000000000ca'::uuid, '00000000-0000-0000-0000-000000000067'::uuid) THEN 16.0
            WHEN ('00000000-0000-0000-0000-0000000000ca'::uuid, '00000000-0000-0000-0000-000000000064'::uuid) THEN 10.666666666666666
            WHEN ('00000000-0000-0000-0000-0000000000ca'::uuid, '00000000-0000-0000-0000-000000000065'::uuid) THEN  5.333333333333333
            WHEN ('00000000-0000-0000-0000-0000000000ca'::uuid, '00000000-0000-0000-0000-000000000066'::uuid) THEN  0.0
        END AS earned
    FROM match_scores ms JOIN matches m ON m.id = ms.match_id
    WHERE ms.match_id = '00000000-0000-0000-0000-0000000000ca'::uuid
)
INSERT INTO game_arena_settlement
    (id, game_id, player_id, date, rating_after, elo_after, discriminator, match_id, elo_staked, elo_earned, rating_staked, rating_earned, league)
SELECT gen_random_uuid(), '00000000-0000-0000-0000-000000000188'::uuid, player_id, date, new_rating, new_rating, 'match', match_id, staked, earned, staked, earned, 'amateur'
FROM base
ON CONFLICT (match_id, player_id) WHERE match_id IS NOT NULL DO NOTHING;

-- markets: test markets in various statuses (n-outcome model, ADR-11).
-- market_outcomes.q mirrors the outstanding shares of the seeded bets below
-- (the AMM invariant). Outcome ids are fixed so the seed is idempotent.
-- First get the dev user's ID for created_by
DO $$
DECLARE
    dev_user_id UUID;
BEGIN
    SELECT id INTO dev_user_id FROM users WHERE google_oauth_user_id = 'dev-user-001';

    -- bet_limit for players (formula: K / (1 + 10^((startingElo - playerElo) / D)) with K=32, D=400, startingElo=1000)
    -- bet_limits based on final Elo after match 202
    UPDATE players SET bet_limit = 32.0 / (1.0 + POWER(10.0, (1000.0 - 1004.6571570250732) / 400.0)) WHERE id = '00000000-0000-0000-0000-000000000064'::uuid;
    UPDATE players SET bet_limit = 32.0 / (1.0 + POWER(10.0, (1000.0 - 1005.2067380581842) / 400.0)) WHERE id = '00000000-0000-0000-0000-000000000065'::uuid;
    UPDATE players SET bet_limit = 32.0 / (1.0 + POWER(10.0, (1000.0 - 982.1361049167427)  / 400.0)) WHERE id = '00000000-0000-0000-0000-000000000066'::uuid;
    UPDATE players SET bet_limit = 32.0 / (1.0 + POWER(10.0, (1000.0 - 1008.0)             / 400.0)) WHERE id = '00000000-0000-0000-0000-000000000067'::uuid;

    -- Market 1: open match_winner (Alice or Bob wins in Skull King)
    INSERT INTO markets (id, market_type, status, starts_at, closes_at, created_by)
    VALUES ('00000000-0000-0000-0000-000000000001', 'match_winner', 'open',
            NOW() - INTERVAL '1 day', NOW() + INTERVAL '7 days', dev_user_id)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO market_match_winner_params (market_id, target_player_ids, allow_other_players, game_ids)
    VALUES ('00000000-0000-0000-0000-000000000001',
            ARRAY['00000000-0000-0000-0000-000000000064'::uuid, '00000000-0000-0000-0000-000000000065'::uuid],
            TRUE, ARRAY['00000000-0000-0000-0000-000000000188'::uuid])
    ON CONFLICT (market_id) DO NOTHING;

    INSERT INTO market_outcomes (id, market_id, kind, player_id, q) VALUES
        ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000001', 'player', '00000000-0000-0000-0000-000000000064', 10),
        ('00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000000001', 'player', '00000000-0000-0000-0000-000000000065', 0),
        ('00000000-0000-0000-0000-000000000403', '00000000-0000-0000-0000-000000000001', 'other',  NULL, 8)
    ON CONFLICT (id) DO NOTHING;

    -- Bets on open market 1 (shares-driven: cost is the elo the AMM charged).
    -- Alice and Carol bet on Alice's outcome; Bob bets against her on 'other'.
    INSERT INTO bets (id, market_id, player_id, outcome, cost, shares) VALUES
        ('00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000064'::uuid, '00000000-0000-0000-0000-000000000401', 5.0, 5),
        ('00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000065'::uuid, '00000000-0000-0000-0000-000000000403', 8.0, 8),
        ('00000000-0000-0000-0000-000000000503', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000066'::uuid, '00000000-0000-0000-0000-000000000401', 3.0, 3),
        ('00000000-0000-0000-0000-000000000504', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000066'::uuid, '00000000-0000-0000-0000-000000000401', 2.0, 2)  -- Carol bets twice on Alice
    ON CONFLICT (id) DO NOTHING;

    -- Market 2: open win_streak (Bob wins 3 times in Skull King, max 1 loss)
    INSERT INTO markets (id, market_type, status, starts_at, closes_at, created_by)
    VALUES ('00000000-0000-0000-0000-000000000002', 'win_streak', 'open',
            NOW() - INTERVAL '2 days', NOW() + INTERVAL '5 days', dev_user_id)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO market_win_streak_params (market_id, target_player_id, game_ids, wins_required, max_losses)
    VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000065'::uuid,
            ARRAY['00000000-0000-0000-0000-000000000188'::uuid], 3, 1)
    ON CONFLICT (market_id) DO NOTHING;

    INSERT INTO market_outcomes (id, market_id, kind, player_id, q) VALUES
        ('00000000-0000-0000-0000-000000000411', '00000000-0000-0000-0000-000000000002', 'yes', NULL, 10),
        ('00000000-0000-0000-0000-000000000412', '00000000-0000-0000-0000-000000000002', 'no',  NULL, 10)
    ON CONFLICT (id) DO NOTHING;

    -- Bets on open market 2
    INSERT INTO bets (id, market_id, player_id, outcome, cost, shares) VALUES
        ('00000000-0000-0000-0000-000000000505', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000064'::uuid, '00000000-0000-0000-0000-000000000412',  6.0, 6),
        ('00000000-0000-0000-0000-000000000506', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000065'::uuid, '00000000-0000-0000-0000-000000000411', 10.0, 10),
        ('00000000-0000-0000-0000-000000000507', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000066'::uuid, '00000000-0000-0000-0000-000000000412',  4.0, 4)
    ON CONFLICT (id) DO NOTHING;

    -- Market 3: resolved match_winner (Alice won match 200 sole: 120 vs 80/60).
    -- Window pinned to the resolution match date — the invariant resolved
    -- match_winner markets satisfy since ADR-11 — so a recalculation re-links
    -- exactly match 200 and reproduces the settlement rows below.
    -- resolution_outcome is set below, after the outcome rows exist (circular FK).
    INSERT INTO markets (id, market_type, status, starts_at, closes_at, created_by, resolved_at, resolution_match_id)
    VALUES ('00000000-0000-0000-0000-000000000003', 'match_winner', 'resolved',
            (SELECT date FROM matches WHERE id = '00000000-0000-0000-0000-0000000000c8'::uuid),
            (SELECT date FROM matches WHERE id = '00000000-0000-0000-0000-0000000000c8'::uuid),
            dev_user_id, NOW() - INTERVAL '7 days',
            '00000000-0000-0000-0000-0000000000c8'::uuid)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO market_match_winner_params (market_id, target_player_ids, allow_other_players, game_ids)
    VALUES ('00000000-0000-0000-0000-000000000003',
            ARRAY['00000000-0000-0000-0000-000000000064'::uuid, '00000000-0000-0000-0000-000000000065'::uuid, '00000000-0000-0000-0000-000000000066'::uuid],
            TRUE, ARRAY['00000000-0000-0000-0000-000000000188'::uuid])
    ON CONFLICT (market_id) DO NOTHING;

    INSERT INTO market_outcomes (id, market_id, kind, player_id, q) VALUES
        ('00000000-0000-0000-0000-000000000421', '00000000-0000-0000-0000-000000000003', 'player', '00000000-0000-0000-0000-000000000064', 20),
        ('00000000-0000-0000-0000-000000000422', '00000000-0000-0000-0000-000000000003', 'player', '00000000-0000-0000-0000-000000000065', 0),
        ('00000000-0000-0000-0000-000000000423', '00000000-0000-0000-0000-000000000003', 'player', '00000000-0000-0000-0000-000000000066', 0),
        ('00000000-0000-0000-0000-000000000424', '00000000-0000-0000-0000-000000000003', 'other',  NULL, 12)
    ON CONFLICT (id) DO NOTHING;

    UPDATE markets SET resolution_outcome = '00000000-0000-0000-0000-000000000421'
    WHERE id = '00000000-0000-0000-0000-000000000003';

    -- Bets on resolved market 3: Alice's 20 winning shares pay 20 (matching the
    -- settlement rows below); the losing bets sit on 'other'.
    INSERT INTO bets (id, market_id, player_id, outcome, cost, shares) VALUES
        ('00000000-0000-0000-0000-000000000508', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000064'::uuid, '00000000-0000-0000-0000-000000000421', 8.0, 20),
        ('00000000-0000-0000-0000-000000000509', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000065'::uuid, '00000000-0000-0000-0000-000000000424', 5.0, 5),
        ('00000000-0000-0000-0000-00000000050a', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000066'::uuid, '00000000-0000-0000-0000-000000000424', 7.0, 7)
    ON CONFLICT (id) DO NOTHING;

    -- Market 4: cancelled match_winner (expired without matching match)
    INSERT INTO markets (id, market_type, status, starts_at, closes_at, created_by, resolved_at)
    VALUES ('00000000-0000-0000-0000-000000000004', 'match_winner', 'cancelled',
            NOW() - INTERVAL '14 days', NOW() - INTERVAL '7 days', dev_user_id, NOW() - INTERVAL '7 days')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO market_match_winner_params (market_id, target_player_ids, allow_other_players, game_ids)
    VALUES ('00000000-0000-0000-0000-000000000004',
            ARRAY['00000000-0000-0000-0000-000000000066'::uuid, '00000000-0000-0000-0000-000000000064'::uuid],
            TRUE, ARRAY[]::uuid[])
    ON CONFLICT (market_id) DO NOTHING;

    INSERT INTO market_outcomes (id, market_id, kind, player_id, q) VALUES
        ('00000000-0000-0000-0000-000000000431', '00000000-0000-0000-0000-000000000004', 'player', '00000000-0000-0000-0000-000000000066', 0),
        ('00000000-0000-0000-0000-000000000432', '00000000-0000-0000-0000-000000000004', 'player', '00000000-0000-0000-0000-000000000064', 0),
        ('00000000-0000-0000-0000-000000000433', '00000000-0000-0000-0000-000000000004', 'other',  NULL, 0)
    ON CONFLICT (id) DO NOTHING;

    -- global_arena_settlement for market 3 (discriminator='market').
    -- Settlement: Alice (won): earned=20, staked=-8; Bob: earned=0, staked=-5; Carol: earned=0, staked=-7.
    -- Prev Elo at resolution date (after match 201, before match 202):
    --   Alice=1002.0534, Bob=1008.1226, Carol=989.8239
    INSERT INTO global_arena_settlement
        (id, date, player_id, rating_after, elo_after, discriminator, market_id,
         elo_staked, elo_earned, rating_staked, rating_earned, league)
    VALUES
        (gen_random_uuid(), NOW() - INTERVAL '7 days', '00000000-0000-0000-0000-000000000064'::uuid,
            1002.0534023250732 + (20.0 - 8.0),
            1002.0534023250732 + (20.0 - 8.0),
            'market', '00000000-0000-0000-0000-000000000003'::uuid, -8.0, 20.0, -8.0, 20.0, 'amateur'),
        (gen_random_uuid(), NOW() - INTERVAL '7 days', '00000000-0000-0000-0000-000000000065'::uuid,
            1008.1226527581842 + (0.0  - 5.0),
            1008.1226527581842 + (0.0  - 5.0),
            'market', '00000000-0000-0000-0000-000000000003'::uuid, -5.0,  0.0, -5.0,  0.0, 'amateur'),
        (gen_random_uuid(), NOW() - INTERVAL '7 days', '00000000-0000-0000-0000-000000000066'::uuid,
            989.8239449167427  + (0.0  - 7.0),
            989.8239449167427  + (0.0  - 7.0),
            'market', '00000000-0000-0000-0000-000000000003'::uuid, -7.0,  0.0, -7.0,  0.0, 'amateur')
    ON CONFLICT (market_id, player_id, discriminator) WHERE market_id IS NOT NULL DO NOTHING;
END $$;
