-- Clone the production database into the stage database.
-- Run on the host where both databases live, AFTER the stage NixOS module has
-- created the "elo-web-service-stage" role and database (peer auth, no password).

-- 1. Terminate all connections to both databases (TEMPLATE requires no sessions on the source)
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname IN ('elo-web-service', 'elo-web-service-stage')
  AND pid <> pg_backend_pid();

-- 2. Drop stage DB and clone from production
DROP DATABASE IF EXISTS "elo-web-service-stage";
CREATE DATABASE "elo-web-service-stage" TEMPLATE "elo-web-service";

-- 3. Make elo-web-service-stage the owner of the stage database
-- (ownership grants implicit membership in pg_database_owner, which owns the public schema in PG15+)
ALTER DATABASE "elo-web-service-stage" OWNER TO "elo-web-service-stage";

-- 4. Reassign ownership of all objects from the prod role to the stage role
\c "elo-web-service-stage"
REASSIGN OWNED BY "elo-web-service" TO "elo-web-service-stage";
