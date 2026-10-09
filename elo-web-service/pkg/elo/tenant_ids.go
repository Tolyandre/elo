package elo

// BlueMenTenantID is the well-known id of the «Синие люди» tenant (ADR-36) —
// the original community, containing the clubs «Синие люди» and
// «Весёлые карточные игры» (both seeded by migration 061). The tenant row is
// created by schema migration 068 in every environment, which also anchors
// the global arena to it and backfills the tenant_id of pre-tenancy
// tournaments and markets. The id sits outside the 061 club/user range
// (...0001–...0003).
//
// Backfill-only anchor: nothing at runtime may fall back to this id — every
// tournament/market/arena created after tenancy carries its tenant
// explicitly, even when that tenant is «Синие люди».
const blueMenTenantIDUUID = "00000000-0000-0000-0000-000000000101"

var BlueMenTenantID = mustParseID("elo: blue men tenant id", blueMenTenantIDUUID)
