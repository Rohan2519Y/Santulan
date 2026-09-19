# Quickstart & Validation Guide: Platform SQL Database

> **Superseded in part (2026-09-19).** The requester directed that the database be strictly the design in `docs/SQL-Database-Schema.md` and that the older feature-002 tables be removed. This document describes the original plan, which added things the doc does not contain (integrity triggers, `erase_student()`, an `app_readonly` role, append-only audit privileges, bypass/helper functions, extra indexes) and kept the feature-002 tables. **Those additions were not built.** What was built is recorded in `tasks.md` and the "Scope revision" section of `spec.md`.

**Branch**: `004-platform-sql-database` | **Date**: 2026-09-19 | **Contract**: [contracts/database-contract.md](contracts/database-contract.md) | **Data model**: [data-model.md](data-model.md)

Proves the feature end to end on a machine that already runs the project. It is a run/validation guide — the migration bodies, helper code and tests are written during implementation (`/speckit-tasks` → `/speckit-implement`).

## Prerequisites

- PostgreSQL ≥ 13 reachable at `backend/.env`'s `DATABASE_URL` (owner, e.g. `postgres`) with the existing database `santulandb` already migrated through `002`. Checked during planning: local PostgreSQL 18.6, 17 tables, `app_runtime` present, no `app_readonly`.
- `RUNTIME_DATABASE_URL` pointing at `app_runtime` (already in `.env`).
- `npm install` done in `backend/`.

All commands run from `backend/` in PowerShell.

## 1. Record the baseline (proves FR-003 / SC-004 later)

```powershell
npm test
```

Note how many tests pass. Existing tests need the admin seed (`npm run db:seed`) — run it first if `admin@santulan.local` is missing.

## 2. Create the reporting role once (existing database only)

A new docker database gets this from `docker/init-app-role.sql`; an existing one needs it by hand. Requires a role with `CREATEROLE` (the owner `postgres` has it).

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -d santulandb -c "CREATE ROLE app_readonly LOGIN PASSWORD 'app_readonly_dev_password' NOSUPERUSER NOBYPASSRLS; GRANT CONNECT ON DATABASE santulandb TO app_readonly; GRANT USAGE ON SCHEMA public TO app_readonly;"
```

(`psql` prompts for the `postgres` password, or set `$env:PGPASSWORD` first. The `DATABASE_URL` in `.env` can't be passed directly because of its `?schema=public` suffix.)

If this is skipped, `db:migrate` still succeeds and prints a warning; only the role tests fail, with a message naming this step.

## 3. Apply the database (Story 1)

```powershell
npm run db:migrate
```

Expected: `Applying migration: 003_platform_schema.sql`, `004_platform_integrity_triggers.sql`, `005_platform_tenant_isolation.sql`, `Applied 3 migration(s).`, then the grant message. Then run it again:

```powershell
npm run db:migrate
```

Expected: `No pending migrations - database is up to date.` and no other output (SC-003).

## 4. Run the database test suite

```powershell
npm test -- tests/database
```

Expected: all pass. Each test runs in a rolled-back transaction, so the database has no leftover rows afterwards.

## 5. Re-run the whole suite (regression)

```powershell
npm test
```

Expected: the same tests pass as in step 1, plus the new ones (SC-004).

## Scenario walkthroughs (map to spec user stories)

| Story | What to check | Where it is asserted | Success criteria |
|-------|---------------|----------------------|------------------|
| US1 Stand up the database | 22 new tables exist and match the doc except the 3 documented fixes; second migrate is a no-op; existing tables untouched; removed-feature tables absent | `structure.test.js` | SC-001, SC-002, SC-003, SC-004 |
| US2 School isolation | Two schools, every scoped table: acting for A returns 0 of B's rows with and without a school filter; no school set returns 0 rows; writing B's row is refused; platform scope sees both | `isolation.test.js` | SC-005 |
| US3 Schools, people, roles | Parent account created `pending` with no password activates in place; second active principal refused; revoked assignment kept; school-user without school refused; profile on wrong role refused | `integrity-identity.test.js` | SC-006 |
| US4 Consent & SCP | Two consent kinds stored separately; one assent per session; sealed answers accepted; latest session per checkpoint | `integrity-consent-scp.test.js`, `performance.test.js` | SC-006, SC-009 |
| US5 Safeguarding | Severity outside 3–5 refused; one guidance state per class; queue signal carries a school | `integrity-safeguarding.test.js` | SC-006 |
| US6 Protocols & content | Duplicate orientation/completion refused; invalid review status refused; empty school list = all schools | `integrity-protocols-content.test.js` | SC-006 |
| US7 Audit | Audit row carries actor/role/target/outcome/time; `app_runtime` cannot update or delete it | `audit.test.js` | SC-008, SC-010 |
| Erasure | `erase_student()` leaves nothing; parent's linked list loses the id; an account that authored notes cannot be hard-deleted | `erasure.test.js` | SC-007 |

## Manual spot checks (optional, ~2 minutes)

Table count and confirmation nothing old changed:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -d santulandb -c "SELECT count(*) FILTER (WHERE relkind='r') AS tables FROM pg_class WHERE relnamespace='public'::regnamespace;"
```

Expected: `39` (the 17 existing tables — 16 assessment tables plus the `_migrations` tracker — plus the 22 new ones). The 22 new tables are `schools`, `accounts`, `student_profiles`, `staff_profiles`, `parent_profiles`, `school_assignments`, `capability_grants`, `escalation_events`, `counsellor_notes`, `consent_records`, `scp_consents`, `scp_sessions`, `scp_assents`, `protocols`, `protocol_orientations`, `protocol_route_events`, `queue_signals`, `class_guidance_state`, `content_modules`, `module_completions`, `group_sessions`, `audit_events`.

Fail-closed isolation, as the restricted role (no school set → zero rows even with data present):

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -d santulandb -c "BEGIN; SET LOCAL ROLE app_runtime; SELECT count(*) FROM accounts; ROLLBACK;"
```

Expected: `0`.

Reporting role cannot read credentials:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -d santulandb -c "BEGIN; SET LOCAL ROLE app_readonly; SELECT password_hash FROM accounts; ROLLBACK;"
```

Expected: `ERROR: permission denied for table accounts` (SQLSTATE `42501`).

## Rolling back

Migrations are additive and there is no down-migration script. To remove the feature from a **development** database, drop the 22 tables, the 7 enum types and the functions from `data-model.md`, and delete rows `003…`, `004…`, `005…` from `_migrations`. Do not do this on a database holding real data.

## 6. Sign in as the demo admin and student (added 2026-09-19)

One-time, for an existing local database: create the login-lookup role (cluster-level, so not a migration), then migrate and seed.

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -d santulandb -c "CREATE ROLE app_platform LOGIN PASSWORD 'app_platform_dev_password' NOSUPERUSER BYPASSRLS; GRANT CONNECT ON DATABASE santulandb TO app_platform; GRANT USAGE ON SCHEMA public TO app_platform;"
npm run db:migrate          # also grants app_platform its least-privilege access
npm run db:seed:platform    # demo school + admin + student (safe to re-run)
npm run db:seed             # assessment content: response scale, 2 item pools (346 items), 392 interpretation rules
```

`PLATFORM_DATABASE_URL` must be set in `backend/.env` (see `.env.example`). **Restart the backend** after pulling these changes - an already-running server still has the old login code.

| | Login | Password |
|---|---|---|
| Admin | `admin@santulan.local` | `ChangeMe123!` |
| Student | `student001` (or `student@santulan.local`) | `ChangeMe123!` |

Check it (adjust the port):

```powershell
curl.exe -s -X POST http://localhost:8000/api/v1/auth/login -H "Content-Type: application/json" -d "{\"loginId\":\"student001\",\"password\":\"ChangeMe123!\"}"
```

Expected: `200` with a `token` and `user.role` = `student`; a wrong password returns `401 Invalid login or password`. Automated: `npx jest tests/contract/auth` (12 tests). The assessment tables are back (migration `007`); load the item pools and scale with `npm run db:seed`, then the assessment screens work.
