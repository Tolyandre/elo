-- ADR-36 phase 7, refinement 2: game tables belong to a tenant. A table is
-- created under the tenant it is played for (POST /tenants/{id}/tables), the
-- «Сейчас играют» lobby lists only the current tenant's tables, and the
-- seating must relate to the tenant (the same rule the match form applies,
-- enforced server-side at creation). Later joins and submissions stay
-- host-token-guarded only — a live game must never break mid-play.
--
-- Pre-tenancy tables are transient by design (they expire within days), so
-- the backfill simply anchors existing rows to «Синие люди», the community
-- every existing user belongs to (keep in sync with pkg/elo/tenant_ids.go).

ALTER TABLE game_tables
    ADD COLUMN tenant_id UUID NOT NULL
        REFERENCES tenants(id)
        DEFAULT '00000000-0000-0000-0000-000000000101';

-- The lobby query filters by tenant and liveness on every poll.
CREATE INDEX game_tables_tenant_expires_idx ON game_tables (tenant_id, expires_at);
