-- Cluster-level roles for the canonical `santulan` schema (BUILD 01 / BUILD 09; specs/005-v3-1-canonical-alignment).
--
-- The default POSTGRES_USER (docker-compose.yml) is a Postgres superuser, which ALWAYS bypasses row-level security
-- regardless of FORCE ROW LEVEL SECURITY. The Node app must therefore connect as a non-superuser role for the
-- policies to be enforced; migrations still run as the superuser/table owner (DATABASE_URL), while the app connects as
-- app_runtime (RUNTIME_DATABASE_URL).
--
-- app_runtime      web API login role: NOSUPERUSER NOBYPASSRLS, never the table owner.
-- santulan_worker  NOLOGIN controlled write path; app_runtime may SET ROLE to it but does not inherit its privileges
--                  (granted by scripts/santulan-grant-roles.js).
-- There is deliberately NO role that bypasses RLS (BUILD 09: the runtime must not hold BYPASSRLS).
CREATE ROLE app_runtime LOGIN PASSWORD 'app_runtime_dev_password' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE santulan_worker NOLOGIN NOBYPASSRLS;
GRANT ALL PRIVILEGES ON DATABASE santulandb TO app_runtime;
