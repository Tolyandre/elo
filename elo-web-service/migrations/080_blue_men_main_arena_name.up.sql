-- The tenant main arena is named after its tenant (ADR-36): every arena
-- created by the app takes the tenant's name at creation and follows tenant
-- renames (UpdateTenantName, pkg/elo/tenants.go). «Синие люди»'s main arena —
-- the converted global arena — predates tenancy and kept its seed name
-- «Главная» (061); bring it in line with the naming convention. Reads the
-- tenant's current name instead of hard-coding it, and stays a no-op once
-- the names agree.
UPDATE arenas a
SET name = t.name
FROM tenants t
WHERE a.tenant_id = t.id
  AND t.id = '00000000-0000-0000-0000-000000000101'  -- BlueMenTenantID, pkg/elo/tenant_ids.go
  AND a.name <> t.name;
