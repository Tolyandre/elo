-- 1. Terminate all connections to both databases
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname IN ('elo-web-service', 'elo-web-service-test')
  AND pid <> pg_backend_pid();

-- 2. Drop test DB and clone from production
DROP DATABASE IF EXISTS "elo-web-service-test";
CREATE DATABASE "elo-web-service-test" TEMPLATE "elo-web-service";

-- 3. Make elo-web-service-test the owner of the test database
-- (ownership grants implicit membership in pg_database_owner, which owns the public schema in PG15+)
ALTER DATABASE "elo-web-service-test" OWNER TO "elo-web-service-test";

-- 4. Ensure the role can log in with the expected password
ALTER ROLE "elo-web-service-test" WITH LOGIN PASSWORD :'db_password';

-- 5. Reassign ownership of all objects from the prod role to the test role
\c "elo-web-service-test"
REASSIGN OWNED BY "elo-web-service" TO "elo-web-service-test";
