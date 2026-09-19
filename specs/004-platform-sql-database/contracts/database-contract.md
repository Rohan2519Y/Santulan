# Database Contract: Platform SQL Database

> **Superseded in part (2026-09-19).** The requester directed that the database be strictly the design in `docs/SQL-Database-Schema.md` and that the older feature-002 tables be removed. This document describes the original plan, which added things the doc does not contain (integrity triggers, `erase_student()`, an `app_readonly` role, append-only audit privileges, bypass/helper functions, extra indexes) and kept the feature-002 tables. **Those additions were not built.** What was built is recorded in `tasks.md` and the "Scope revision" section of `spec.md`.

**Branch**: `004-platform-sql-database` | **Date**: 2026-09-19 | **Plan**: [plan.md](../plan.md) | **Data model**: [data-model.md](../data-model.md)

This feature has no HTTP surface. Its "interface" is what the database promises to the code that uses it: the migration files, the per-transaction settings that drive tenant isolation, the roles and what each may do, the policy matrix, the functions, and the error codes callers should expect. Column-level definitions are in `docs/SQL-Database-Schema.md`.

## 1. Migrations

Applied in filename order by `backend/scripts/migrate.js` (`npm run db:migrate`), each in its own transaction, recorded in `_migrations`. Re-running applies nothing.

| File | Contents | Depends on |
|------|----------|------------|
| `003_platform_schema.sql` | 7 enum types, 22 tables, constraints, indexes (doc's + 9 added), the three doc fixes | 002 |
| `004_platform_integrity_triggers.sql` | `enforce_profile_role()` + 3 triggers; `parent_link_cleanup()` + 1 trigger; `erase_student(uuid)` | 003 |
| `005_platform_tenant_isolation.sql` | `app_school_id()`, `app_bypass()`; `ENABLE` + `FORCE ROW LEVEL SECURITY` and one policy on each of the 20 school-scoped tables | 003, 004 |

`npm run db:migrate` then runs `grant-runtime-role.js`, which applies the grants in §3 (idempotent, safe every time).

## 2. Session settings (the isolation contract)

Set **inside a transaction, as its first statement**, with `set_config(name, value, true)` (= `SET LOCAL`: connection-scoped, auto-reset on commit/rollback, safe under pooling).

| Setting | Value | Effect |
|---------|-------|--------|
| `app.current_school_id` | school UUID as text | Rows whose school is this one become visible/writable |
| `app.bypass_rls` | `'true'` | Platform scope: all schools visible. Same setting migration 002 already uses |
| *(neither set, or empty)* | — | **Fail closed**: `app_school_id()` is NULL, every comparison is NULL, zero rows visible, writes refused (FR-017) |

**Source of the value**: the school id comes from the authenticated account's own record — never from a request parameter or body (doc §4). The platform setting is set only by code paths that hold an explicit platform capability, and every such use writes an `audit_events` row (FR-018).

**Helper API** — `backend/src/shared/utils/rls.js` (add two functions beside the existing ones; `setAdminBypass` is reused as the platform scope):

| Function | Behavior |
|----------|----------|
| `setSchoolScope(tx, schoolId)` | `set_config('app.current_school_id', schoolId ?? '', true)` |
| `currentSchoolScope(tx)` | Reads it back; missing → `null`, never a wildcard |
| `setAdminBypass(tx)` *(existing)* | `set_config('app.bypass_rls','true', true)` |

**Known limit (by design, same as 002)**: the bypass setting is a trust boundary inside the application. Any code holding the runtime connection could set it. The database-enforced hardening path is a separate `BYPASSRLS` role for platform work (doc §4); the policies below work unchanged with one. Not built here (plan → Complexity Tracking).

## 3. Roles and privileges

| Role | Connects for | Sees | Can change |
|------|--------------|------|------------|
| Owner (`DATABASE_URL`, e.g. `postgres`) | migrations, retention, test fixtures | Everything (superuser bypasses RLS) | Everything |
| `app_runtime` (`RUNTIME_DATABASE_URL`, `NOSUPERUSER NOBYPASSRLS`) | the running app | Only rows allowed by policy (§4) | `ALL` on tables **except** `UPDATE`/`DELETE` on `audit_events` (append-only, research §9) |
| `app_readonly` (new, `NOSUPERUSER NOBYPASSRLS`) | reporting/read-only tools | Policy-filtered rows; on `accounts` **only the non-secret columns** | Nothing |

- Isolation is only ever real for non-superuser roles; **tests must assert through `app_runtime`/`app_readonly`**, never the owner.
- `app_readonly`: `SELECT` on `accounts` is granted by an explicit column list = all columns except `password_hash`, `reset_token_hash` (research §5). The list is computed from the catalog on each `db:migrate`.
- Provisioned in `docker/init-app-role.sql` (new database) or once by hand for an existing one (quickstart step 2).

## 4. RLS policy matrix

One `FOR ALL` policy per table, same expression for `USING` and `WITH CHECK`, all ORed with `app_bypass()`. `FORCE ROW LEVEL SECURITY` on every table listed.

| Table | Visible/writable when | Shape |
|-------|----------------------|-------|
| `schools` | `school_id = app_school_id()` | Direct |
| `accounts` | `school_id = app_school_id()` | Direct |
| `school_assignments` | `school_id = app_school_id()` | Direct |
| `escalation_events` | `school_id = app_school_id()` | Direct |
| `consent_records` | `school_id = app_school_id()` | Direct |
| `scp_consents` | `school_id = app_school_id()` | Direct |
| `queue_signals` | `school_id = app_school_id()` | Direct |
| `class_guidance_state` | `school_id = app_school_id()` | Direct |
| `group_sessions` | `school_id = app_school_id()` | Direct |
| `audit_events` | `actor_school_id = app_school_id()` (NULL-school platform rows: platform scope only) | Direct |
| `student_profiles`, `staff_profiles`, `parent_profiles`, `capability_grants`, `protocol_orientations`, `module_completions` | `EXISTS (SELECT 1 FROM accounts a WHERE a.account_id = <account_id>)` | Via account |
| `scp_sessions`, `scp_assents`, `counsellor_notes`, `protocol_route_events` | `EXISTS (SELECT 1 FROM accounts a WHERE a.account_id = <student_account_id>)` | Via account |
| `protocols`, `content_modules` | *(no RLS — global catalogs)* | None |

The `EXISTS` subquery is evaluated under `accounts`' own policy, so the *via account* tables inherit isolation without repeating the rule. Verified on PostgreSQL 18.6 (research §4).

## 5. Functions

| Function | Kind | Contract |
|----------|------|----------|
| `app_school_id()` | `STABLE`, SQL | `uuid` of `app.current_school_id`, or NULL if unset/empty |
| `app_bypass()` | `STABLE`, SQL | `true` only when `app.bypass_rls = 'true'`; otherwise `false` |
| `enforce_profile_role()` | trigger, `BEFORE INSERT OR UPDATE` on the 3 profile tables | Raises `check_violation` if the owning account's role does not match the profile kind |
| `parent_link_cleanup()` | trigger, `AFTER DELETE` on `accounts` | Removes `OLD.account_id` from every `parent_profiles.linked_student_account_ids` |
| `erase_student(p_account_id uuid)` | function, `SECURITY INVOKER` | Deletes all student-scoped rows and parent-list entries; then deletes the account, or — if retained records still reference it — anonymises it in place (`status='deleted'`, `deleted_at=now()`, personal fields cleared, credentials unusable). Returns `'deleted'` or `'anonymised'`. Idempotent; erasing an already-erased id returns `'anonymised'`/no-op without error |

## 6. Errors callers should expect

Standard PostgreSQL SQLSTATEs, so callers can map them to the existing `HttpError` codes.

| Situation | SQLSTATE | Example |
|-----------|----------|---------|
| Duplicate on a unique rule | `23505` | second active principal; duplicate email, mobile, `login_id`; second assent for a session; duplicate orientation/completion |
| Check rule broken | `23514` | school-user without a school; escalation level outside 3–5; `fields` on a non-update grant; profile on wrong role; invalid review status |
| Reference to something that doesn't exist / delete blocked | `23503` | dangling `school_id`; hard-deleting an account that authored notes |
| Not allowed to see or write that row / privilege missing | `42501` | writing another school's row (`new row violates row-level security policy`); `app_readonly` reading `password_hash`; `app_runtime` updating `audit_events` |

Note: a `SELECT` that RLS filters returns **zero rows, not an error** — code must not treat "0 rows" as "does not exist" when deciding to create something (a duplicate-key error may follow instead).

## 7. Invariants the test suite asserts

| # | Invariant | Spec |
|---|-----------|------|
| I-1 | Migrated `public` schema equals the doc's DDL for the 22 tables, except the 3 documented fixes | SC-002, FR-001 |
| I-2 | Applying migrations twice changes nothing; existing 17 tables and 002 tests are unaffected | SC-003, SC-004, FR-002/003 |
| I-3 | Two schools, every one of the 20 scoped tables: scope A sees 0 of B's rows with and without a school filter; no setting sees 0 rows | SC-005, FR-016/017 |
| I-4 | Every invalid input in SC-006's list is refused with the SQLSTATE in §6 | SC-006 |
| I-5 | After `erase_student()`, no row in any table references the student except the retained account stub when audit rows exist; parents' lists no longer contain the id | SC-007, FR-038/039 |
| I-6 | `app_readonly` cannot read `password_hash`/`reset_token_hash`; `app_runtime` cannot update/delete `audit_events` | SC-008, FR-019 |
| I-7 | 100,000 sessions: latest-per-checkpoint lookup and a school's open escalations each < 1 s | SC-009 |
| I-8 | No table `assessments`, `pulse_checkins`, `chat_messages`, `helplines`, `rate_limits`; no retired band names in any enum | FR-040 |

## 8. Sign-in (added 2026-09-19; the only application interface built on this database)

**Platform-scope role** - `app_platform`: `LOGIN NOSUPERUSER BYPASSRLS`, connection string `PLATFORM_DATABASE_URL`. Privileges: `SELECT` on `accounts`, `student_profiles`, `staff_profiles`; `UPDATE (last_login_at)` on `accounts`; nothing else. Used only by the login lookup (`backend/src/shared/platformDb.js`).

**`POST /api/v1/auth/login`**

| | |
|---|---|
| Request | `{ "loginId": "student001", "password": "..." }` **or** `{ "email": "...", "password": "..." }` (one of `loginId`/`email` required) |
| 200 | `{ "token": "<JWT, 12 h>", "user": { "id", "email", "name", "role", "schoolId", "loginId" } }` |
| Token claims | `sub` (account id), `role` (`student`, `superuser`, ...), `email`, `schoolId` (null for platform accounts) |
| 401 `UNAUTHENTICATED` | wrong password, unknown login, account not `active`, or no password - one identical message, `Invalid login or password` |
| 400 `VALIDATION_ERROR` | neither `loginId` nor `email`, bad email, missing password |

Lookup rules: `loginId` -> `student_profiles.login_id`; `email` -> `accounts.email` or `staff_profiles.work_email` (case-insensitive); exactly one match or treated as unknown. A successful sign-in sets `accounts.last_login_at`.

**Demo accounts** (`npm run db:seed:platform`, development only): school `Santulan Demo School`; admin `admin@santulan.local` (role `superuser`, no school); student `student001` / `student@santulan.local` (role `student`); password `ChangeMe123!` for both.

**Frontend mapping**: `superuser` -> admin screen, `student` -> student screen; other roles authenticate but have no screen yet.

**Route guards**: `/api/v1/assessments/*` requires role `student`; `/api/v1/admin/assessments/*` requires `superuser` (403 `FORBIDDEN` otherwise). The assessment tables behind them were restored by migration `007` (see data-model.md section 6), so both work: admin import `201`, student profile/consent/attempt `201`.
