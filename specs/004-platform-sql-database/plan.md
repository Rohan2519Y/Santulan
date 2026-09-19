# Implementation Plan: Platform SQL Database (004)

> **Superseded in part (2026-09-19).** The requester directed that the database be strictly the design in `docs/SQL-Database-Schema.md` and that the older feature-002 tables be removed. This document describes the original plan, which added things the doc does not contain (integrity triggers, `erase_student()`, an `app_readonly` role, append-only audit privileges, bypass/helper functions, extra indexes) and kept the feature-002 tables. **Those additions were not built.** What was built is recorded in `tasks.md` and the "Scope revision" section of `spec.md`.

**Branch**: `004-platform-sql-database` | **Date**: 2026-09-19 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/004-platform-sql-database/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command; its definition describes the execution workflow.

## Summary

Deliver the 22-table relational schema defined in `docs/SQL-Database-Schema.md` as hand-written SQL migrations run by the project's existing migration runner, added **alongside** the 17 existing tables — 16 capability-assessment tables plus the `_migrations` tracker (no changes to them). Three migrations: (1) types, tables, indexes — the doc's DDL plus three documented fixes where its diagram and SQL disagree; (2) small integrity triggers the spec requires that plain constraints cannot express; (3) tenant isolation — row-level security on every school-owned and student-scoped table, keyed on a per-transaction school setting that fails closed. Supporting changes are small: extend the existing grant script (a reporting role that cannot read credential columns; an append-only audit trail), add two helpers next to the existing RLS helper, and add a database-level test suite that runs in rolled-back transactions. No API, no UI, no data migration.

## Technical Context

**Language/Version**: SQL (PostgreSQL ≥ 13 — `gen_random_uuid()` is built in from 13, so no `pgcrypto`) for the deliverable; Node.js 20 (`backend/Dockerfile` is `node:20-alpine`) for the runner, helpers and tests. Dev database in this repo is PostgreSQL 18.6 (local) / 16 (docker-compose).

**Primary Dependencies**: None new. `pg ^8.13.1` (existing runner and tests), `dotenv`, Jest 29. The DDL in the schema doc was executed against the local PostgreSQL 18.6 inside a rolled-back transaction during planning: 9 of 9 SQL blocks load, producing exactly the 22 tables (research §2).

**Storage**: PostgreSQL — same database as the existing assessment tables (`DATABASE_URL` for migrations as owner; `RUNTIME_DATABASE_URL` for the app as `app_runtime`, `NOSUPERUSER NOBYPASSRLS`).

**Testing**: Jest (`--runInBand`, existing config) with a new `backend/tests/database/` suite. Every test runs inside `BEGIN … ROLLBACK` on the owner connection and switches to the restricted role with `SET LOCAL ROLE`, so tests leave no rows behind and need no cleanup (research §10). Existing suites must stay green (SC-004).

**Target Platform**: Server-side PostgreSQL; local Windows dev and Linux/docker/production.

**Project Type**: Backend data layer only — migrations, grants, one shared helper, tests. No new HTTP surface.

**Performance Goals**: SC-009 — with 100,000 SCP sessions, "latest session per student per checkpoint" and "a school's open escalations" each under 1 second. SC-001 — full setup under 5 minutes.

**Constraints**: FR-002/003 idempotent and additive (runner records applied files in `_migrations`; each file is one transaction). FR-016/017 RLS must fail closed (no school set → no rows). Superusers always bypass RLS, so isolation is only ever tested and enforced through `app_runtime`.

**Scale/Scope**: 22 tables, 7 new enums alongside the 19 existing ones (new names are lower-snake `*_enum`, no clash with the existing quoted CamelCase enums), ~22 secondary indexes (the doc's 13 plus 9 added — research §8), 2 trigger functions, 1 erasure function (`erase_student`), 2 helper SQL functions, 20 RLS policies (10 tables scoped directly by school, 10 through the owning account; `protocols` and `content_modules` are global catalogs with no RLS). Pilot volume: a handful of schools, thousands of students.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled placeholder template — no principles, constraints, or governance rules have been ratified. **No gates apply.** The plan follows the repo's existing conventions instead: raw-SQL migrations applied by `scripts/migrate.js` (no ORM), restricted `app_runtime` role with `FORCE ROW LEVEL SECURITY` (migration 002), transaction-local GUC scoping (`src/shared/utils/rls.js`), Jest + real database tests. **Post-design re-check**: the design added no new constraints beyond those conventions. Gate remains PASS / nothing to track.

## Project Structure

### Documentation (this feature)

```text
specs/004-platform-sql-database/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   └── database-contract.md   # migrations, session settings, roles, RLS policy matrix, helper API
├── checklists/
│   └── requirements.md  # From /speckit-specify
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root → backend only)

```text
backend/
├── migrations/
│   ├── 001_init_capability_assessment.sql      # existing — untouched
│   ├── 002_responses_rls.sql                   # existing — untouched
│   ├── 003_platform_schema.sql                 # NEW: enums, 22 tables, indexes (+3 doc fixes)
│   ├── 004_platform_integrity_triggers.sql     # NEW: profile-role check, parent-link cleanup, erase_student()
│   └── 005_platform_tenant_isolation.sql       # NEW: app_school_id()/app_bypass(), ENABLE+FORCE RLS, policies
├── scripts/
│   ├── migrate.js                              # existing — unchanged (already idempotent, per-file txn)
│   └── grant-runtime-role.js                   # EXTEND: app_readonly column-level grants; audit append-only
├── docker/
│   └── init-app-role.sql                       # EXTEND: create app_readonly role
├── src/shared/utils/
│   └── rls.js                                  # EXTEND: setSchoolScope(), currentSchoolScope() (existing setAdminBypass is reused for platform scope)
└── tests/database/                             # NEW
    ├── harness.js                              # rolled-back txn + SET LOCAL ROLE + fixture builders
    ├── structure.test.js                       # 22 tables / doc-reference diff / no removed-feature tables (SC-002, FR-040)
    ├── integrity-identity.test.js              # identity/role/assignment/grant rules (SC-006)
    ├── integrity-consent-scp.test.js           # consent, assent, SCP sessions (SC-006)
    ├── integrity-safeguarding.test.js          # escalations, notes, queue, class guidance (SC-006)
    ├── integrity-protocols-content.test.js     # protocols, orientations, modules, group sessions (SC-006)
    ├── audit.test.js                           # audit completeness, append-only, school-scoped reads (SC-008, SC-010)
    ├── isolation.test.js                       # two-school isolation incl. no-filter and no-GUC (SC-005)
    ├── erasure.test.js                         # student erase leaves nothing; staff account can't be hard-removed (SC-007)
    ├── roles.test.js                           # app_readonly cannot read credentials (SC-008)
    └── performance.test.js                     # 100k-session lookups under 1 s (SC-009)
```

**Structure Decision**: Backend-only, following the existing `backend/migrations` + `scripts` + `tests` layout. The schema is split into three migration files by concern (structure / integrity / isolation) so each is reviewable on its own and each is atomic; ordering after `002` keeps the existing chain intact. The doc's DDL is not copied into the spec artifacts — `docs/SQL-Database-Schema.md` stays the single field-level source, and [data-model.md](data-model.md) records only what the plan adds or changes.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No constitution violations. Two deliberate deviations from the schema document are recorded here because a reader comparing against it will notice them:

| Deviation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Platform (cross-school) access uses a transaction-local bypass setting, not a separate `BYPASSRLS` role (doc §4) | The repo already does this (`app.bypass_rls` in migration 002 / `rls.js`); one pool, one role, and the login lookup (which happens before a school is known) needs the same route. A `BYPASSRLS` role also keeps working with these policies if added later | A second role means a second connection pool and role provisioning in every environment; managed hosts often forbid creating `BYPASSRLS` roles |
| Column-level `GRANT` of non-secret columns to `app_readonly`, not the doc's `REVOKE SELECT (password_hash, …)` | Verified on PostgreSQL 18.6: a column `REVOKE` has no effect when the role holds table-level `SELECT` — the role could still read `password_hash` | Following the doc literally would silently fail FR-019 / SC-008 |

## Addendum - sign-in (added 2026-09-19, after the scope revision)

The requester asked for one admin and one student and for login to be rewritten. Added, all outside the schema itself:

- **Seed**: `backend/seeders/platform.seeder.js` (`npm run db:seed:platform`) - idempotent demo school, admin, student.
- **Platform-scope role**: `app_platform` (`LOGIN NOSUPERUSER BYPASSRLS`), the doc's section 4 mechanism, because login runs before a school is known and `accounts` has row-level security. Config `PLATFORM_DATABASE_URL`; pool in `backend/src/shared/platformDb.js`; least-privilege grants added to `backend/scripts/grant-runtime-role.js`; provisioned in `backend/docker/init-app-role.sql`.
- **Login**: `backend/src/modules/auth/auth.routes.js` rewritten for `accounts` / `student_profiles` / `staff_profiles`; `backend/src/shared/middleware/auth.js` exposes `schoolId`.
- **Frontend**: `LoginPage.jsx` and `assessmentApi.js` (student ID or email; role mapping).
- **Tests**: `backend/tests/contract/auth/login.test.js` (12).
- **Assessment module**: not rebuilt, but its tables were restored (see the next addendum).

## Addendum - assessment tables restored (added 2026-09-19)

The admin import failed with `relation "response_scales" does not exist`. The assessment module needs its own tables, which the doc's schema does not have (no item bank, attempts, scoring or reports). Migration `007_restore_assessment_tables.sql` puts back 15 tables and 18 enum types beside the doc's 22, changing only the three columns that referenced the removed `users` table so they reference `accounts`. `users` is not restored. Also: the assessment seeder no longer seeds users; `tests/helpers/testUser.js` creates accounts; `structure.test.js` asserts 22 + 15 + `_migrations`. Result: 18 suites / 82 tests pass, and the admin import and student flow work through the running service.
