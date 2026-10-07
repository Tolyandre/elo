-- Tenants (ADR-36): a tenant is a separate entity — a community with its own
-- main arena and openness settings — containing one or many clubs. A club
-- stays pure player grouping (ADR-05) plus its membership stint history; a
-- club belongs to at most one tenant (clubs.tenant_id, NULL = plain group),
-- and tenant membership is derived: an active stint in any club of the
-- tenant.
--
-- The well-known tenant «Синие люди» (00000000-0000-0000-0000-000000000101,
-- BlueMenTenantID in pkg/elo/tenant_ids.go) is created here and gets the two
-- clubs «Синие люди» (00000000-0000-0000-0000-000000000001, BlueMenClubID)
-- and «Весёлые карточные игры» (00000000-0000-0000-0000-000000000002) — both
-- seeded by 061, the latter with its real production members. The existing
-- global arena (a2ea0000-0000-0000-0000-000000000001) becomes the tenant's
-- main arena — the row and all of its arena_settlements stay put. That tenant
-- id is a backfill-only anchor: pre-tenancy tournaments and markets are tied
-- to it once here, and nothing at runtime may fall back to it — every entity
-- created after tenancy carries its tenant explicitly.
--
-- This phase changes no runtime behavior: tenant arenas (other than the
-- converted global arena, which keeps its unconditional filter) do not yet
-- attract matches — the link-only branch of arena_contains_match covers them
-- with no arena_matches links, so they match nothing until the attribution
-- phase lands.

-- ---------------------------------------------------------------------------
-- The tenants table.
-- ---------------------------------------------------------------------------

CREATE TABLE tenants (
    id                    UUID PRIMARY KEY,
    name                  TEXT NOT NULL,
    arena_membership_mode TEXT NOT NULL,
    tournaments_openness  TEXT NOT NULL,
    CONSTRAINT tenants_name_unique UNIQUE (name)
);

ALTER TABLE tenants
    ADD CONSTRAINT tenants_arena_membership_mode_check
        CHECK (arena_membership_mode IN ('any_member', 'members_only')),
    ADD CONSTRAINT tenants_tournaments_openness_check
        CHECK (tournaments_openness IN ('members_only', 'open'));

-- Tenant lifecycle events are audited (ADR-14); widen the entity enum.
ALTER TABLE audit_log DROP CONSTRAINT audit_log_entity_type_check;
ALTER TABLE audit_log
    ADD CONSTRAINT audit_log_entity_type_check
        CHECK (entity_type IN ('match', 'game', 'player', 'club', 'tag', 'arena', 'tournament', 'tenant'));

-- The original community. any_member: matches with at least one member of
-- any of its clubs count (friends playing along accumulate rating and are
-- listed); open tournaments: today's behavior. Member-less historical
-- matches deliberately leave the rating at the next recalculation (ADR-36).
INSERT INTO tenants (id, name, arena_membership_mode, tournaments_openness)
VALUES ('00000000-0000-0000-0000-000000000101', 'Синие люди', 'any_member', 'open');

-- ---------------------------------------------------------------------------
-- Clubs relate to a tenant. A club keeps pure grouping semantics; tenant_id
-- NULL is a plain group. Both clubs come from the 061 seed («Весёлые
-- карточные игры» already exists in production with its real members); a
-- missing club in the migrated data is a hard error, not a silent skip.
-- ---------------------------------------------------------------------------

ALTER TABLE clubs ADD COLUMN tenant_id UUID NULL REFERENCES tenants(id);
CREATE INDEX clubs_tenant_id_idx ON clubs (tenant_id);

DO $$
BEGIN
    UPDATE clubs SET tenant_id = '00000000-0000-0000-0000-000000000101'
    WHERE name = 'Синие люди';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'migration 068: club «Синие люди» not found';
    END IF;

    UPDATE clubs SET tenant_id = '00000000-0000-0000-0000-000000000101'
    WHERE name = 'Весёлые карточные игры';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'migration 068: club «Весёлые карточные игры» not found';
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Membership history (ADR-36): stints instead of a bare membership set.
-- joined_at '-infinity' backfills existing rows so all of their history
-- counts; left_at NULL marks the active stint. Re-joining opens a new stint
-- row; the partial unique index keeps at most one active stint per (club,
-- player). This stays a club-level concept; tenant membership derives from
-- it.
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
-- The main-arena flavor: arenas.tenant_id anchors a tenant's main arena. The
-- converted global arena is a filter arena WITH tenant_id (2nd disjunct of
-- arenas_camp_filter_agree — its unconditional filter keeps working through
-- the filter branch of arena_contains_match); a fresh tenant arena created
-- later is the new 4th disjunct — filter-less and matched by tenant rules,
-- not by arena_contains_match (whose call sites extend their link-only
-- argument with "(a.tenant_id IS NOT NULL AND a.match_filter_id IS NULL)").
-- ---------------------------------------------------------------------------

ALTER TABLE arenas ADD COLUMN tenant_id UUID NULL REFERENCES tenants(id);

ALTER TABLE arenas DROP CONSTRAINT arenas_camp_filter_agree;
ALTER TABLE arenas
    ADD CONSTRAINT arenas_camp_filter_agree CHECK (
        (camp AND match_filter_id IS NULL AND tournament_id IS NULL AND tenant_id IS NULL)
        OR (NOT camp AND match_filter_id IS NOT NULL AND tournament_id IS NULL)
        OR (NOT camp AND match_filter_id IS NULL AND tournament_id IS NOT NULL)
        OR (NOT camp AND match_filter_id IS NULL AND tournament_id IS NULL AND tenant_id IS NOT NULL)
    ),
    ADD CONSTRAINT arenas_tenant_flavor CHECK (tenant_id IS NULL OR game_id IS NULL);

-- The global arena becomes the main arena of «Синие люди» (backfill anchor,
-- see file header). Keep in sync with pkg/elo/arena.go and
-- pkg/elo/tenant_ids.go.
UPDATE arenas
SET tenant_id = '00000000-0000-0000-0000-000000000101'
WHERE id = 'a2ea0000-0000-0000-0000-000000000001';

-- One main arena per tenant; the partial index also serves GetArenaByTenant.
CREATE UNIQUE INDEX arenas_tenant_id_key ON arenas (tenant_id) WHERE tenant_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Tournaments and markets relate to a tenant (ADR-36). Nullable in this
-- phase — the create paths do not take a tenant yet (and inserts must keep
-- working); the backfill ties every pre-tenancy row to «Синие люди» exactly
-- once. The attribution/settlement phase makes both NOT NULL together with
-- explicit tenant_id on create.
-- ---------------------------------------------------------------------------

ALTER TABLE tournaments ADD COLUMN tenant_id UUID NULL REFERENCES tenants(id);
ALTER TABLE markets      ADD COLUMN tenant_id UUID NULL REFERENCES tenants(id);

UPDATE tournaments SET tenant_id = '00000000-0000-0000-0000-000000000101' WHERE tenant_id IS NULL;
UPDATE markets      SET tenant_id = '00000000-0000-0000-0000-000000000101' WHERE tenant_id IS NULL;

CREATE INDEX tournaments_tenant_id_idx ON tournaments (tenant_id);
CREATE INDEX markets_tenant_id_idx ON markets (tenant_id);
