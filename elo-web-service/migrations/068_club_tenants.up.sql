-- Club tenants (ADR-36): a club is either a group (ADR-05 display grouping,
-- unchanged) or a tenant — a community with its own main arena, openness
-- settings and membership history.
--
-- The well-known club «Синие люди» (00000000-0000-0000-0000-000000000001,
-- seeded by 061, BlueMenTenantClubID in pkg/elo/club_ids.go) converts here,
-- and the existing global arena (a2ea0000-0000-0000-0000-000000000001)
-- becomes its main arena — the row and all of its arena_settlements stay
-- put. That id is a backfill-only anchor: pre-tenancy tournaments and
-- markets are tied to it once here, and nothing at runtime may fall back to
-- it — every entity created after tenancy carries its club explicitly.
--
-- This phase changes no runtime behavior: club arenas (other than the
-- converted global arena, which keeps its unconditional filter) do not yet
-- attract matches — the link-only branch of arena_contains_match covers them
-- with no arena_matches links, so they match nothing until the attribution
-- phase lands.

-- ---------------------------------------------------------------------------
-- Club kinds and tenant settings.
-- ---------------------------------------------------------------------------

ALTER TABLE clubs
    ADD COLUMN kind TEXT NOT NULL DEFAULT 'group',
    ADD COLUMN arena_membership_mode TEXT NULL,
    ADD COLUMN tournaments_openness TEXT NULL;

ALTER TABLE clubs
    ADD CONSTRAINT clubs_kind_check CHECK (kind IN ('group', 'tenant')),
    ADD CONSTRAINT clubs_arena_membership_mode_check
        CHECK (arena_membership_mode IN ('any_member', 'members_only')),
    ADD CONSTRAINT clubs_tournaments_openness_check
        CHECK (tournaments_openness IN ('members_only', 'open')),
    -- A group carries no tenant settings; a tenant carries both.
    ADD CONSTRAINT clubs_tenant_settings_agree CHECK (
        (kind = 'group' AND arena_membership_mode IS NULL AND tournaments_openness IS NULL)
        OR (kind = 'tenant' AND arena_membership_mode IS NOT NULL AND tournaments_openness IS NOT NULL)
    );

-- The original community becomes a tenant. any_member: matches with at least
-- one member count (guests accumulate rating and are listed); open
-- tournaments: today's behavior. Member-less historical matches deliberately
-- leave the rating at the next recalculation (ADR-36).
UPDATE clubs
SET kind = 'tenant', arena_membership_mode = 'any_member', tournaments_openness = 'open'
WHERE id = '00000000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------------------
-- Membership history (ADR-36): stints instead of a bare membership set.
-- joined_at '-infinity' backfills existing rows so all of their history
-- counts; left_at NULL marks the active stint. Re-joining opens a new stint
-- row; the partial unique index keeps at most one active stint per (club,
-- player).
-- ---------------------------------------------------------------------------

ALTER TABLE player_club_membership
    ADD COLUMN joined_at TIMESTAMPTZ NOT NULL DEFAULT '-infinity',
    ADD COLUMN left_at TIMESTAMPTZ NULL;

ALTER TABLE player_club_membership DROP CONSTRAINT player_club_membership_pkey;
ALTER TABLE player_club_membership
    ADD PRIMARY KEY (club_id, player_id, joined_at),
    ADD CONSTRAINT player_club_membership_stint_dates
        CHECK (left_at IS NULL OR left_at > joined_at);

CREATE UNIQUE INDEX player_club_membership_active_uniq
    ON player_club_membership (club_id, player_id) WHERE left_at IS NULL;

-- ---------------------------------------------------------------------------
-- The main-arena flavor: arenas.club_id anchors a tenant's main arena. The
-- converted global arena is a filter arena WITH club_id (2nd disjunct of
-- arenas_camp_filter_agree — its unconditional filter keeps working through
-- the filter branch of arena_contains_match); a fresh tenant arena created
-- later is the new 4th disjunct — filter-less and matched by club rules, not
-- by arena_contains_match (whose call sites extend their link-only argument
-- with "(a.club_id IS NOT NULL AND a.match_filter_id IS NULL)").
-- ---------------------------------------------------------------------------

ALTER TABLE arenas ADD COLUMN club_id UUID NULL REFERENCES clubs(id);

ALTER TABLE arenas DROP CONSTRAINT arenas_camp_filter_agree;
ALTER TABLE arenas
    ADD CONSTRAINT arenas_camp_filter_agree CHECK (
        (camp AND match_filter_id IS NULL AND tournament_id IS NULL AND club_id IS NULL)
        OR (NOT camp AND match_filter_id IS NOT NULL AND tournament_id IS NULL)
        OR (NOT camp AND match_filter_id IS NULL AND tournament_id IS NOT NULL)
        OR (NOT camp AND match_filter_id IS NULL AND tournament_id IS NULL AND club_id IS NOT NULL)
    ),
    ADD CONSTRAINT arenas_club_flavor CHECK (club_id IS NULL OR game_id IS NULL);

-- The global arena becomes the main arena of «Синие люди» (backfill anchor,
-- see file header). Keep in sync with pkg/elo/arena.go and pkg/elo/club_ids.go.
UPDATE arenas
SET club_id = '00000000-0000-0000-0000-000000000001'
WHERE id = 'a2ea0000-0000-0000-0000-000000000001';

-- One main arena per tenant club; the partial index also serves GetArenaByClub.
CREATE UNIQUE INDEX arenas_club_id_key ON arenas (club_id) WHERE club_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Tournaments and markets relate to a club (ADR-36). Nullable in this phase —
-- the create paths do not take a club yet (and inserts must keep working);
-- the backfill ties every pre-tenancy row to «Синие люди» exactly once. The
-- attribution/settlement phase makes both NOT NULL together with explicit
-- club_id on create.
-- ---------------------------------------------------------------------------

ALTER TABLE tournaments ADD COLUMN club_id UUID NULL REFERENCES clubs(id);
ALTER TABLE markets      ADD COLUMN club_id UUID NULL REFERENCES clubs(id);

UPDATE tournaments SET club_id = '00000000-0000-0000-0000-000000000001' WHERE club_id IS NULL;
UPDATE markets      SET club_id = '00000000-0000-0000-0000-000000000001' WHERE club_id IS NULL;

CREATE INDEX tournaments_club_id_idx ON tournaments (club_id);
CREATE INDEX markets_club_id_idx ON markets (club_id);
