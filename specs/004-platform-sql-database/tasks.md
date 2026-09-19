---

description: "Feature implementation task list for Platform SQL Database (as executed, strict scope)"
---

# Tasks: Platform SQL Database (004)

**Input**: Design documents from `/specs/004-platform-sql-database/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/database-contract.md, quickstart.md

**Later changes**: sign-in (Phase 12) and the restoration of the assessment module's tables (Phase 13) came after this revision; see them below and `spec.md` -> "Scope revision".

**Scope revision (2026-09-19, during implementation)**: The requester directed that the backend database be **strictly the design in `docs/SQL-Database-Schema.md`** and that the unwanted (older feature-002) tables be removed. This list is the work as executed under that direction. The original plan's additions that the doc does not contain were **dropped**: integrity triggers (`enforce_profile_role`, `parent_link_cleanup`), the `erase_student()` function, the `app_readonly` role and column-level grants, the append-only audit revoke, the `app_school_id()`/`app_bypass()` helper functions and bypass setting, the `setSchoolScope` helper in `rls.js`, the nine extra indexes, and the performance test. See `spec.md` → "Scope revision" for the effect on requirements.

**Tests**: Included; each proves a rule the doc's own DDL defines. All run in rolled-back transactions (`backend/tests/database/harness.js`).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to
- Migrations are never edited after they are applied; corrections are new numbered files.

---

## Phase 1: Setup

- [X] T001 Record the regression baseline before any change: `npm test` → 9 suites / 23 tests passing; saved in `specs/004-platform-sql-database/baseline-tests.txt`
- [X] T002 Verify database prerequisites (PostgreSQL 18.6, 17 tables, `app_runtime` non-superuser, none of the 22 new tables or 7 new enums present); recorded in `specs/004-platform-sql-database/baseline-tests.txt`
- [X] T003 [P] Add `backend/.dockerignore` (a `backend/Dockerfile` exists and had none) and git-ignore `backend/backups/` in `backend/.gitignore`

## Phase 2: Foundational

- [X] T004 Create the test harness `backend/tests/database/harness.js`: `withRolledBackTx`, `asRole('app_runtime')`, `scope()/platform()/clearScope()`, `refused(sql, params, sqlstate)` (savepoint-based), fixture builders for every table, and `docSqlBlocks()` (reads the doc's SQL)
- [X] T005 [P] Add the `test:db` script to `backend/package.json`

## Phase 3: User Story 1 - Stand up the complete platform database (P1) 🎯 MVP

**Goal**: One repeatable step creates the doc's 22 tables with every relationship, allowed-value list and rule.

**Independent Test**: `npm run db:migrate` creates them; a second run does nothing; the structure test finds no difference from the doc's SQL except the three ER-diagram items.

- [X] T006 [P] [US1] Create `backend/tests/database/structure.test.js`: column/type/nullability diff against the doc's SQL loaded into a scratch schema; index and constraint diff (nothing added on top); exactly the doc's 22 tables (+ `_migrations`); exactly the 7 enum types; no removed-feature tables or retired band values; the three ER-diagram items present; migration runner is a no-op
- [X] T007 [US1] Create `backend/migrations/003_platform_schema.sql` from the doc's §3 DDL: 7 enum types, 22 tables, doc indexes; plus the three ER-diagram items the doc's DDL omits — `accounts.deleted_at`, `queue_signals.school_id` (NOT NULL → `schools`, `ON DELETE CASCADE`), `UNIQUE (session_id)` on `scp_assents`
- [X] T008 [US1] Apply `003` (`npm run db:migrate`) and re-run to confirm it is a no-op
- [X] T009 [US1] Remove the nine indexes `003` added beyond the doc, with a forward migration `backend/migrations/004_platform_remove_added_indexes.sql` (`003` was already applied so it was not edited); the strict structure test then passes

**Checkpoint**: Done — the database exists, matches the doc, and is idempotent.

## Phase 4: User Story 3 - Register schools, people and roles (P1)

**Goal**: The identity, assignment and permission rules in the doc's DDL hold.

- [X] T010 [P] [US3] Create `backend/tests/database/integrity-identity.test.js`: pending parent activates in place; school-account/platform-account rules; unique email/mobile/`login_id`/`work_email`; closed enum values; student escalation-level and onboarding-state rules; parent link array (many students per parent, many parents per student); one active principal per school with revoke history kept; permission grants (`fields` only on update, closed resource list, expiry/revocation)
- [X] T011 [P] [US3] Create `backend/tests/database/cascade.test.js`: deleting a student cascades through all 13 student-owned tables; a parent's linked-student list keeps a deleted student's id (the doc's accepted trade-off); an account that authored records cannot be hard-deleted but can be marked deleted; audit actors and referenced protocols/schools cannot be deleted; dangling references refused

## Phase 5: User Story 2 - A school only ever sees its own data (P1)

**Goal**: Row-level security exactly as doc §4 describes, on every table carrying a `school_id`.

- [X] T012 [P] [US2] Create `backend/tests/database/isolation.test.js` (as `app_runtime`): no school set → 0 rows; school A sees only A with and without a filter; cross-school writes refused or affect 0 rows; owner (stand-in for the doc's `BYPASSRLS` platform role) sees all; exactly the 8 school-owned tables carry the `tenant_isolation` policy; global catalogs unaffected
- [X] T013 [US2] Create `backend/migrations/005_platform_tenant_isolation.sql`: `ENABLE ROW LEVEL SECURITY` and policy `tenant_isolation` (`school_id = NULLIF(current_setting('app.current_school_id', true), '')::uuid`) on `accounts`, `school_assignments`, `escalation_events`, `consent_records`, `scp_consents`, `queue_signals`, `class_guidance_state`, `group_sessions`
- [X] T014 [US2] Apply `004` and `005`; run the isolation and structure tests

## Phase 6: User Story 4 - Consent, assent and SCP sessions (P2)

- [X] T015 [P] [US4] Create `backend/tests/database/integrity-consent-scp.test.js`: two consent record types stored separately with withdrawal; SCP session progress, sealed answers, scores and void; no plain-text counterpart to sealed fields; one assent per session (decline stored, cascade on session delete); latest session per checkpoint retrievable

## Phase 7: User Story 5 - Safeguarding and guidance (P2)

- [X] T016 [P] [US5] Create `backend/tests/database/integrity-safeguarding.test.js`: escalation severity 3–5 and status values; acknowledge/resolve tracking; sealed counsellor notes; queue signal school required and optional protocol; one class-guidance state per school and class

## Phase 8: User Story 7 - Audit trail (P2)

- [X] T017 [P] [US7] Create `backend/tests/database/audit.test.js`: a sealed-data-open event is an ordinary audit row with full detail; actor, role and class required; actor and school must exist; platform-wide actions leave the school empty

## Phase 9: User Story 6 - Protocols, content, group sessions (P3)

- [X] T018 [P] [US6] Create `backend/tests/database/integrity-protocols-content.test.js`: protocol code unique, review status values, defaults; orientation once per person and protocol; route events; module targeting (empty school list = all schools); completion once; group sessions with optional module

## Phase 10: Removal of the unwanted tables (explicit request)

- [X] T019 Take a full backup before the irreversible step: `pg_dump` of the whole database to `backend/backups/santulandb-before-legacy-drop-2026-09-19.sql` (git-ignored, 2.5 MB, all 39 tables with data)
- [X] T020 Create `backend/migrations/006_drop_legacy_assessment_tables.sql` dropping the 16 feature-002 tables (`users`, `response_scales`, `assessment_versions`, `items`, `participant_profiles`, `consents`, `assessment_attempts`, `responses`, `response_events`, `quality_flags`, `score_results`, `interpretation_rules`, `reports`, `report_sections`, `content_import_records`, `participation_controls`) and their 19 enum types; apply it
- [X] T021 Update `structure.test.js` so the end state is asserted: exactly the doc's 22 tables plus `_migrations`, exactly the 7 enum types

## Phase 11: Polish & validation

- [X] T022 Fresh-database rebuild: create an empty database, run the whole chain `001`–`006` (6 migrations applied in 1.7 s), run all 47 database tests against it (pass), then drop it
- [X] T023 No-residue check on the real database after all tests: 0 rows across the 22 platform tables
- [X] T024 Run the whole suite and record the effect of T020: database suites 8/8 and 47/47 tests pass; the 9 feature-002 suites (23 tests) fail because their tables were removed as requested (they pass again after Phase 13)

---

## Phase 12: User Story 8 - Admin and student sign in (P2) - added after the first scope revision

**Goal**: One admin and one student exist in the new tables and can sign in through the running service.

**Independent Test**: `npm run db:seed:platform`, start the service, sign in as `student001` and as `admin@santulan.local`; wrong/unknown/inactive logins are refused identically.

- [X] T025 [US8] Create `backend/seeders/platform.seeder.js` (+ `db:seed:platform` script): idempotent demo school, admin (`superuser`, no school, `admin@santulan.local`), student (`school_user`, `student@santulan.local`, `login_id student001`, class 8-A, onboarding `active`) and the student's consent record; default password `ChangeMe123!` stored as a bcrypt hash
- [X] T026 [US8] Create the platform-scope connection role `app_platform` (`LOGIN NOSUPERUSER BYPASSRLS`) in the local database, add it to `backend/docker/init-app-role.sql`, add `PLATFORM_DATABASE_URL` to `backend/.env` and `backend/.env.example`, and `platformDatabaseUrl` to `backend/src/config/index.js` (login must run before a school is known, so it cannot pass RLS on `accounts` - schema doc section 4)
- [X] T027 [US8] Extend `backend/scripts/grant-runtime-role.js` to grant `app_platform` least privilege only: `SELECT` on `accounts`, `student_profiles`, `staff_profiles` and `UPDATE (last_login_at)` on `accounts`; warns (does not fail) if the role is missing
- [X] T028 [P] [US8] Create `backend/src/shared/platformDb.js` (a pool on `PLATFORM_DATABASE_URL` that reuses the camelCase row mapping from `shared/db.js`)
- [X] T029 [US8] Rewrite `backend/src/modules/auth/auth.routes.js` login: accepts `{email | loginId, password}`; looks up `accounts` (student by `student_profiles.login_id` or email; staff also by `staff_profiles.work_email`); only `active` accounts with a password; same 401 for wrong password and unknown login (bcrypt compare against a dummy hash when no account matches); stamps `last_login_at`; token carries `sub`, `role`, `email`, `schoolId`; extend `authenticate` in `backend/src/shared/middleware/auth.js` to expose `schoolId`
- [X] T030 [P] [US8] Create `backend/tests/contract/auth/login.test.js` (12 tests, own accounts created and removed): student by login ID and by email, admin, staff work email, `last_login_at` stamped, identical 401 for wrong/unknown, pending/suspended/locked/deleted refused, validation, and proof that `app_runtime` cannot see accounts while the platform connection can
- [X] T031 [P] [US8] Update the frontend: `frontend/src/pages/LoginPage.jsx` (field "Email or student ID", plain text input) and `frontend/src/services/assessmentApi.js` (`login(identifier, password)` sends `email` or `loginId`; `toAppRole` maps `superuser` to `admin`, `student` to `participant`); the 5 frontend suites / 26 tests still pass
- [X] T032 [US8] Verify against the live service on a spare port (8001): student by login ID and by email, admin by email return 200 with correct role and school claims; wrong password returns 401; `last_login_at` stamped on both accounts; demo data intact (1 school, 2 accounts, 1 student profile, 1 consent record); test server stopped
- [X] T033 [US8] Update the spec artifacts: `spec.md` (Scope revision, US8, FR-041 to FR-046, SC-011 to SC-013, assumptions), `plan.md`, `research.md` (section 13), `contracts/database-contract.md` (section 8), `quickstart.md` (section 6), and this file

- [X] T034 [US8] Fix "Insufficient role for this operation": the assessment routes in `backend/src/routes/v1/assessment.routes.js` still required the old role names (`participant`, `admin`) while login issues the real account roles; guards changed to `student` (participant routes) and `superuser` (admin routes). Verified on a spare port: each role passes its own routes and gets 403 on the other's. Both now reach the next failure - HTTP 500 because `participant_profiles` / `assessment_attempts` no longer exist (removed by 006) - which is the assessment module missing its tables, not a permissions problem (resolved in Phase 13)

---

## Phase 13: Fix the assessment module's missing tables (P2) - added after the sign-in work

**Trigger**: the admin item-pool import failed with `error: relation "response_scales" does not exist` (and the student screens with `participant_profiles` / `assessment_attempts` missing). Direction: fix it; add columns only if needed, with minimum changes.

**Goal**: The assessment module works again for the new admin and student accounts.

**Independent Test**: admin import returns 201; the student can declare a profile, record consents and start an attempt; the 9 assessment suites pass.

- [X] T035 [US8] Diagnose: `users` is referenced only by the old seeder and the test helper (the module never reads it); the module needs its own tables. Confirm no column has to be added: only the three columns that referenced `users` change
- [X] T036 [US8] Create `backend/migrations/007_restore_assessment_tables.sql` (generated from 001 + 002, header explains why): restores 15 tables and 18 enum types; **not** `users` / `UserRole`; `participant_profiles.user_id`, `quality_flags.reviewed_by`, `content_import_records.imported_by` become `UUID` with foreign keys to `accounts(account_id)`; re-applies the 002 row-level-security policy on `responses`. Data is not restored (structure only). Apply it
- [X] T037 [US8] Update `backend/seeders/assessment.seeder.js` to stop seeding `users` (logins come from `db:seed:platform`); run `npm run db:seed` (response scale, 2 item pools = 346 items, 392 interpretation rules)
- [X] T038 [US8] Update `backend/tests/helpers/testUser.js` to create `student` / `superuser` **accounts** (owner connection, because row-level security blocks the app role from `accounts`) and to read the admin from `accounts`
- [X] T039 [US8] Update `backend/tests/database/structure.test.js`: exactly the doc's 22 tables + the module's 15 + `_migrations`; `users` absent; the 7 doc enums + the module's 18; the doc-conformance tests for the 22 tables are unchanged
- [X] T040 [US8] Verify on a spare port (8001): admin import `201` (175 items, no server error); admin submissions `200`; student profile `404 PROFILE_NOT_DECLARED` before declaring, then declare `201`, both consents `201`, attempt start `201` (`IN_PROGRESS`); zero errors in the server log; test rows removed from the demo student afterwards
- [X] T041 [US8] Rebuild from empty through `007` (7 migrations in 2.5 s) and run the 47 database tests there: pass; scratch database dropped
- [X] T042 [US8] Full backend run: 18 suites / 82 tests pass (47 database, 12 login, 23 assessment)
- [X] T043 [US8] Update the spec artifacts: `spec.md` (FR-047 to FR-049, SC-014, FR-003 row, assumptions), `plan.md`, `research.md` (section 14), `data-model.md` (section 6), `contracts/database-contract.md`, `quickstart.md`, and this file

---

## Not done — dropped by direction (strict doc design)

Each of these was planned and is **not** built, because none of it is in `docs/SQL-Database-Schema.md`:

- Profile-role triggers, parent-list cleanup trigger, `erase_student()` (erasure = the doc's foreign-key cascades)
- `app_readonly` reporting role and column-level credential grants; append-only audit privileges
- `app_school_id()` / `app_bypass()` functions and the transaction-level bypass setting; `FORCE ROW LEVEL SECURITY`; RLS on student-scoped tables and `audit_events` (the doc's §4 example applies to school-owned tables carrying `school_id`)
- `setSchoolScope()` in `backend/src/shared/utils/rls.js` (`backend/docker/init-app-role.sql` gained only the doc-endorsed `app_platform` role, T026)
- The 9 extra indexes; the 100,000-row performance test

## Notes

- The doc's own claim that isolation returns "zero rows instead of every school's rows" is honoured by `NULLIF(current_setting(name, true), '')`; the doc's literal `current_setting(name)` would raise an error when no school is set.
- Row-level security never applies to superusers or the table owner. Isolation is enforced for `app_runtime`; the doc's cross-school platform route is a separate `BYPASSRLS` role, which is a database-administration step, not part of these migrations.
