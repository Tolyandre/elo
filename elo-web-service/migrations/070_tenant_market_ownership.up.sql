-- Tournaments and markets belong to a tenant (ADR-36, phase 3). The columns
-- exist since 068 (backfilled to «Синие люди») and the create paths now
-- require the tenant explicitly (POST /tenants/{id}/tournaments,
-- POST /tenants/{id}/markets), so ownership becomes NOT NULL. Migrations run
-- before the service starts, so no NULL rows can appear between 068 and 070.
ALTER TABLE tournaments ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE markets      ALTER COLUMN tenant_id SET NOT NULL;

-- Market settlement rows are unique per (arena, market, player, role), and a
-- market settles exactly once into its tenant's main arena — market_id alone
-- identifies its rows. This index backs the arena-less settlement reads
-- (GetSettlementDetails, GetMarketGuarantorPayouts).
CREATE INDEX arena_settlements_market_id_idx
    ON arena_settlements (market_id) WHERE market_id IS NOT NULL;
