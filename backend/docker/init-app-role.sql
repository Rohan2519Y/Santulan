-- The default POSTGRES_USER (docker-compose.yml) is a Postgres superuser,
-- which ALWAYS bypasses row-level security regardless of FORCE ROW LEVEL
-- SECURITY (T053). The Node app must connect as a non-superuser role for the
-- responses RLS policy to actually be enforced; migrations still run as the
-- superuser/table-owner (DATABASE_URL), while the app connects as this
-- restricted role (RUNTIME_DATABASE_URL).
CREATE ROLE app_runtime LOGIN PASSWORD 'app_runtime_dev_password' NOSUPERUSER NOBYPASSRLS;
GRANT ALL PRIVILEGES ON DATABASE santulan_assessment TO app_runtime;
GRANT ALL PRIVILEGES ON SCHEMA public TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO app_runtime;
