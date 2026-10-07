package elo

// BlueMenTenantClubID is the well-known id of the «Синие люди» tenant club —
// the original community (ADR-36). The row is seeded by schema migration 061
// in every environment and converted to a tenant by 068, which also anchors
// the global arena to it and backfills the club_id of pre-tenancy tournaments
// and markets. Keep the SQL literals of the same value in sync (the 061 seed,
// migration 068, and testdata/seed.sql).
//
// Backfill-only anchor: nothing at runtime may fall back to this id — every
// tournament/market/arena created after tenancy carries its club explicitly,
// even when that club is «Синие люди».
const blueMenTenantClubIDUUID = "00000000-0000-0000-0000-000000000001"

var BlueMenTenantClubID = mustParseID("elo: blue men tenant club id", blueMenTenantClubIDUUID)
