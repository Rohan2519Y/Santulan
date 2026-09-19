# Research: Platform SQL Database

> **Superseded in part (2026-09-19).** The requester directed that the database be strictly the design in `docs/SQL-Database-Schema.md` and that the older feature-002 tables be removed. This document describes the original plan, which added things the doc does not contain (integrity triggers, `erase_student()`, an `app_readonly` role, append-only audit privileges, bypass/helper functions, extra indexes) and kept the feature-002 tables. **Those additions were not built.** What was built is recorded in `tasks.md` and the "Scope revision" section of `spec.md`.

**Branch**: `004-platform-sql-database` | **Date**: 2026-09-19 | **Plan**: [plan.md](plan.md)

Engineering decisions that resolve the open questions in the [plan](plan.md). Business rules live in [spec.md](spec.md); field-level definitions live in `docs/SQL-Database-Schema.md`. Claims marked **(verified)** were executed against the local PostgreSQL 18.6 during planning inside a rolled-back transaction — nothing was persisted (the database still has its original 17 tables).

## 1. Delivery mechanism: three migration files on the existing runner

- **Decision**: Add `003_platform_schema.sql`, `004_platform_integrity_triggers.sql`, `005_platform_tenant_isolation.sql` to `backend/migrations/`. Use `scripts/migrate.js` unchanged.
- **Rationale**: The runner already records each applied file in `_migrations` (so a second run does nothing — FR-002, SC-003) and wraps each file in its own transaction (so an interrupted run leaves either a whole file applied or none of it — the "interrupted setup" edge case). Splitting by concern keeps each file reviewable and lets a failure in isolation policy not roll back the table structure. Files are additive only; nothing in 001/002 is edited (FR-003).
- **Alternatives considered**: One large file (harder to review, coarser failure unit); `CREATE … IF NOT EXISTS` everywhere (hides drift instead of detecting it; the `_migrations` tracker already gives idempotence); adopting an ORM/migration tool (the repo deliberately dropped its ORM — see 001 header comment).

## 2. Schema document fidelity (verified)

- **Decision**: Use the doc's DDL as the base, verbatim in column names/types/constraints.
- **Evidence**: All 9 ```` ```sql ```` blocks in the doc executed without error on PostgreSQL 18.6, in doc order, inside one transaction; table count went from 17 to 39 (= 17 + 22); rollback returned it to 17. No name collision with existing tables or enums.
- **Rationale**: The doc is the user's stated source ("I want that database"); a verified-loadable base removes the largest risk of the plan.
- **Alternatives considered**: Re-deriving the schema from the ERD (higher drift risk, no upside).

## 3. Three doc inconsistencies — resolve toward the ERD's stated intent

The doc's Mermaid ERD and its DDL disagree in three places (confirmed by inspecting the loaded tables: `queue_signals` has no `school_id`; `accounts` has no `deleted_at`; `scp_assents.session_id` is not unique). Already recorded as spec Assumptions; this is how they are built:

| # | ERD says | DDL has | Build |
|---|----------|---------|-------|
| 1 | `queue_signals.school_id` FK ("denormalized - added") | missing | Add `school_id UUID NOT NULL REFERENCES schools ON DELETE CASCADE` + index. Needed for RLS (§4) |
| 2 | `accounts.deleted_at` ("soft-delete / erasure") | missing (status `'deleted'` exists) | Add `deleted_at TIMESTAMPTZ` |
| 3 | `scp_assents.session_id` **UK** ("one assent per session") | plain FK | Add `UNIQUE (session_id)` |

Anything else that looks like a discrepancy is a deliberate doc decision (e.g. `class_guidance_state UNIQUE (school_id, class_label)` — one guidance state per class, mirrored in spec US5 scenario 4).

## 4. Tenant isolation: per-transaction settings, fail-closed policies (verified)

- **Decision**: Two tiny `STABLE` SQL functions — `app_school_id()` returns `NULLIF(current_setting('app.current_school_id', true), '')::uuid`; `app_bypass()` returns true only when `app.bypass_rls = 'true'`. Every policy is `USING (<scope> OR app_bypass())` with the same `WITH CHECK`. Tables get `ENABLE` **and** `FORCE ROW LEVEL SECURITY` (same as 002). Setting is applied with `set_config(..., true)` (= `SET LOCAL`) as the first statement of a transaction, exactly as `rls.js` does today.
- **Two scoping shapes**:
  1. *Direct* — tables with their own school reference: `school_id = app_school_id()` (`schools` itself uses `school_id`; `audit_events` uses `actor_school_id`, so platform-wide rows with a NULL school are invisible to school staff).
  2. *Through the owning account* — tables about a student/person with no school column: `EXISTS (SELECT 1 FROM accounts a WHERE a.account_id = <this.account col>)`. Because the subquery is itself subject to `accounts`' policy, it inherits isolation with no duplicated logic. Full matrix in [contracts/database-contract.md](contracts/database-contract.md).
- **Evidence (verified)** with a non-superuser `NOBYPASSRLS` role: no setting → 0 rows in `accounts` and 0 in `counsellor_notes`; setting school A → only A's 2 accounts and 1 of 2 counsellor notes (the one whose student is in A); an `INSERT` of an account for school B while scoped to A → "new row violates row-level security policy".
- **Login path**: RLS on `accounts` means a credential lookup by email *before* a school is known returns nothing. Authentication (a later feature) must run its lookup under the platform scope, narrowly. Not built here; recorded so it is not a surprise.
- **Deviation from doc §4** — the doc says platform access uses a separate `BYPASSRLS` role; this plan uses the transaction-local bypass setting the repo already uses (migration 002, `rls.js`). A `BYPASSRLS` role still works with these policies. See Complexity Tracking in the plan.
- **Known limit, stated plainly**: a transaction-local setting is only a trust boundary *inside the application* — any code holding the runtime connection could set `app.bypass_rls`. That is true of 002 today and is the trade-off of not using a `BYPASSRLS` role. It defends against the failure the doc names (a query that forgets its `WHERE school_id`), not against hostile code on the connection.
- **Global catalogs** (`protocols`, `content_modules`) are not school-owned → no RLS; who may write them is application authorization (`capability_grants`). Recorded as a known limit, not a gap in the spec (FR-016 is about school-owned areas).
- **Alternatives considered**: Duplicating `school_id` onto every student-scoped table (denormalization the doc spent six passes removing); `SECURITY DEFINER` policy functions (bypass the inheritance that makes the `EXISTS` shape safe); database-per-tenant (doc §7 explicitly defers it).

## 5. Hiding credential columns from a reporting role (verified — the doc's statement is wrong)

- **Decision**: Create role `app_readonly`; grant it `SELECT` on `accounts` **by explicit column list** excluding `password_hash` and `reset_token_hash`, and table-level `SELECT` on the other 21 platform tables only — never on the feature-002 tables (`users` has its own `password_hash`). The column list is computed from the catalog in `grant-runtime-role.js` (all columns minus the secret list) so a later added column is picked up on the next `db:migrate`.
- **Evidence (verified)**: granting table-level `SELECT` then running the doc's `REVOKE SELECT (password_hash, reset_token_hash) ON accounts` leaves `has_column_privilege(…, 'password_hash', 'SELECT')` = **true**. Granting `SELECT (<non-secret columns>)` instead gives `password_hash` = **false**, `email` = **true**.
- **Rationale**: FR-019 / SC-008. PostgreSQL column privileges are additive to table privileges; a column `REVOKE` cannot subtract from a table grant.
- **Where**: `grant-runtime-role.js` already re-runs after every migrate and is idempotent; that is the right home. Role creation itself needs `CREATEROLE`, so it goes in `docker/init-app-role.sql` and (for the existing local database) one documented command in the quickstart; the script warns, as it already does for `app_runtime`, when the role is missing.
- **Alternatives considered**: A view without the secret columns (extra objects to keep in sync); moving credentials to their own table (the doc merged them on purpose — pass two).

## 6. Erasure, cascades, and the parent's linked-student list

- **Foreign-key behavior is taken from the doc's DDL** (matrix in [data-model.md](data-model.md)): everything that describes a *student* cascades from that student's `accounts` row; everything that names an account as an *author/actor* (`counsellor_account_id`, `practitioner_account_id`, `assigned_by`, `granted_by`, `voided_by`, `acknowledged_by`, `resolved_by`, `published_by`, `audit_events.actor_account_id`) is `NO ACTION`.
  - Effect on **FR-038**: erasing a student removes profile, consents, assents, sessions, escalations, notes, queue signals, route events, completions, orientations.
  - Effect on **FR-039**: an account that authored retained records physically cannot be deleted — the database refuses it — so the supported path is `status = 'deleted'` + `deleted_at` (§3 #2). No extra mechanism needed.
  - A school cannot be deleted while it has accounts (`accounts.school_id` is `NO ACTION`); schools are deactivated via `status`, not removed.
- **Gap found**: a parent's `linked_student_account_ids` array is not a foreign key, so erasing a student leaves that student's id sitting in the parent's array — a leftover record of the student, which would fail SC-007.
- **Decision**: An `AFTER DELETE ON accounts` trigger removes the deleted id from any `parent_profiles.linked_student_account_ids` (uses the existing GIN index). It runs as the invoking user, so the erasure must run under the school scope or the platform scope — both already see the parent (same school by construction). This keeps the doc's one-table parent design and closes the gap without adding a join table.
- **Second gap found — FR-038 vs FR-039 collide when a student appears in the audit trail.** `audit_events.actor_account_id` is `NO ACTION` (correctly — FR-039 says audit-referenced accounts stay). If a student ever appears as an actor (e.g. an audited assent), a plain `DELETE FROM accounts` is refused and cascades never fire, so the student's sessions, notes, etc. would remain — failing FR-038 and SC-007.
- **Decision**: One function `erase_student(p_account_id uuid)` (migration 004) is *the* erasure path. It (1) deletes the student-scoped rows explicitly (same set the cascades cover), (2) strips the id from parents' linked lists, (3) tries to delete the `accounts` row; if the database refuses because retained records reference it, (4) falls back to anonymising the row in place — `status='deleted'`, `deleted_at=now()`, name replaced, `email`/`mobile`/`phone` cleared, credentials replaced with an unusable value (the `password_required_unless_pending` check forbids NULL outside `pending`). Result either way: nothing about the student remains except the account stub that the audit trail must keep pointing at. The function is `SECURITY INVOKER`, so it runs under the caller's school or platform scope like everything else.
- **Rationale**: Makes "erase" deterministic instead of "depends on whether an audit row exists", and gives the tests one thing to call. It does not weaken the doc's design — the FKs are unchanged.
- **Alternatives considered**: Making `audit_events.actor_account_id` `ON DELETE SET NULL` (column is `NOT NULL` in the doc; loses who acted); anonymise-only (leaves student data rows behind).
- **Not added**: a validate-on-write trigger for array elements. The spec accepts that limitation (Assumptions; doc "Pass four"); it stays an application check. Listed here as the easy upgrade if wanted later.
- **Alternatives considered**: Application-only cleanup (fails silently when a code path forgets — the exact class of bug this schema exists to remove); reintroducing `parent_child_relationships` (contradicts the spec's accepted design).

## 7. Profile tables must match the account's role

- **Decision**: One trigger function `enforce_profile_role()`, attached `BEFORE INSERT OR UPDATE` to `student_profiles`, `staff_profiles`, `parent_profiles`, checks `accounts.role` (student → student; parent → parent; counsellor/principal/teacher/support → staff) and raises otherwise. FR-009/010/011 say role-specific detail "MUST NOT appear on" other roles.
- **Rationale**: A trigger adds no column, so the tables stay exactly as the doc defines them (SC-002 stays a clean diff). A composite `(account_id, role)` foreign key would need a duplicated `role` column on each profile table.
- **Alternatives considered**: Composite FK (changes the documented columns); application-only (unenforced).

## 8. Indexes beyond the doc

- **Decision**: Keep every index the doc lists, add: (a) the two composite indexes the doc itself names in §5 — `scp_sessions (student_account_id, checkpoint, completed_at DESC)` and `escalation_events (school_id, status, created_at DESC)` (status column added to the doc's suggested pair because SC-009 is about *open* escalations); (b) foreign-key indexes on the student-cascade paths that the doc leaves unindexed — `escalation_events`, `consent_records`, `scp_consents`, `scp_assents`, `queue_signals`, `protocol_route_events` on `student_account_id`, plus `queue_signals(school_id)`.
- **Rationale**: Without (b), erasing one student sequentially scans each of those tables (FR-038 / SC-007 at scale) and the RLS `EXISTS` lookups join through them. Without (a), SC-009 relies on a scan. All are ordinary b-tree indexes; total cost is small at pilot volume.
- **Not added**: `audit_events` partitioning (doc §5 defers it until volume justifies it; so does the spec's Volume assumption).

## 9. Audit trail: append-only for the app role

- **Decision**: In `grant-runtime-role.js`, after the existing blanket `GRANT ALL`, `REVOKE UPDATE, DELETE ON audit_events FROM app_runtime`. The table owner (migrations, retention jobs) can still delete.
- **Rationale**: Spec US7 calls for a *trustworthy* trail; an application bug or injection should not be able to rewrite history. Cheap and reversible. The script must re-apply the revoke every run because its blanket `GRANT ALL` would otherwise undo it.
- **Alternatives considered**: A trigger blocking UPDATE/DELETE (also blocks the owner's legitimate retention deletes); doing nothing (spec-compliant but weaker).

## 10. How to test a database whose main promise is "even a sloppy query can't leak"

- **Decision**: Tests in `backend/tests/database/` open one owner connection per test, `BEGIN`, build fixtures as the owner (superuser bypasses RLS — correct for seeding), then `SET LOCAL ROLE app_runtime` (or `app_readonly`) for the assertions, and always `ROLLBACK`. No residue in the dev database, no cleanup code, and isolation is exercised as the *real* restricted role — the only way RLS can be meaningfully tested, since a superuser connection would pass every test trivially.
- **Structure check (SC-002)**: rather than a hand-maintained expected list, the test loads the doc's own SQL blocks into a scratch schema inside the same transaction and diffs table/column/type/nullability against the migrated `public` tables for the 22 names. The only allowed differences are the three deliberate fixes in §3. When the doc changes, the test fails until the migration is updated.
- **Removed-feature check (FR-040)**: assert none of `assessments`, `pulse_checkins`, `chat_messages`, `helplines`, `rate_limits` exist, and no enum label contains a retired classification band (`Thriving`, `Steady`, `Building`, `Struggling`, `In Crisis`). (The existing `assessment_attempts` / `assessment_versions` tables belong to feature 002 and are not "assessments".)
- **Performance (SC-009)**: generate 100,000 sessions with `generate_series` inside the rolled-back transaction, `ANALYZE`, run the two queries, assert under 1 s wall-clock.
- **Alternatives considered**: Mocked DB (proves nothing about RLS); a throwaway database per run (slower, needs `CREATEDB`, unnecessary given rollback).

## 11. Pre-existing environment issues noticed (not fixed here)

- `docker-compose.yml` creates database `santulan_assessment` on host port 5433, but `docker/init-app-role.sql` runs `GRANT … ON DATABASE santulandb` and `.env`/`.env.example` point at `santulandb` on 5432. As written the docker init script most likely errors on a missing database, so the docker path probably does not produce `app_runtime`. **Not verified** — Docker was not run. The local PostgreSQL (port 5432, `santulandb`, `app_runtime` present) is what works today and is what the quickstart uses. Recommended to fix separately; this feature only appends the `app_readonly` role to that script.
- Working tree already contains uncommitted comment-only edits to `backend/scripts/migrate.js`, `backend/Dockerfile`, and specs 001/002; this plan does not touch them.

## 12. Identifier types

- **Decision**: New tables use `UUID` keys as the doc specifies; existing 002 tables use `TEXT` ids. No foreign keys cross between the two sets, so the difference is harmless and no conversion is needed. Unifying identity (`users` vs `accounts`) is a separate later decision (spec Assumptions).

## 13. Login lookup on a platform-scope connection (added 2026-09-19)

- **Decision**: The login endpoint looks accounts up through a separate pool that connects as `app_platform` - `LOGIN NOSUPERUSER BYPASSRLS` - with only `SELECT` on `accounts`, `student_profiles`, `staff_profiles` and `UPDATE (last_login_at)` on `accounts`.
- **Rationale**: `accounts` has row-level security keyed on the school (schema doc section 4), and a sign-in happens *before* any school is known, so the ordinary `app_runtime` connection sees zero accounts (asserted in `login.test.js`). The doc's answer is "a separate role that bypasses RLS" for platform-scope connections - this is exactly that, scoped to one job. It resolves the earlier "login path" concern (research section 4) without adding a bypass setting or functions the doc does not have.
- **Also**: identical 401 for wrong password and unknown login, with a bcrypt comparison against a dummy hash when no account matches so timing does not distinguish them; only `active` accounts with a password may sign in; an ambiguous email (matches more than one account) is treated as unknown.
- **Alternatives considered**: signing in on the owner/superuser connection (over-privileged for a request path); a `SECURITY DEFINER` lookup function (not in the doc); disabling RLS on `accounts` (defeats section 4).
- **Cluster-level**: roles are not part of a database's migrations, so the role is provisioned by the Docker init script for a new database and once by hand for an existing one; `grant-runtime-role.js` warns rather than fails if it is missing.

## 14. Restoring the assessment tables with the fewest changes (added 2026-09-19)

- **Decision**: New migration `007` recreates the feature-002 tables (15) and enums (18) from `001`/`002`, unchanged except: no `users` table and no `UserRole` enum, and three columns retyped to UUID with foreign keys to `accounts(account_id)` - `participant_profiles.user_id`, `quality_flags.reviewed_by`, `content_import_records.imported_by`. The 002 row-level-security policy on `responses` is re-applied.
- **Rationale**: The module never reads `users` (only its old seeder and test helper did), so nothing else has to change; sign-in tokens already carry `accounts.account_id` as `sub`, so pointing the three foreign keys at `accounts` makes the module work with the new login. No column is added anywhere; none of the doc's 22 tables changes.
- **Why not the doc's tables**: they contain no question bank, attempts, per-item responses, scoring results, interpretation rules or reports. `scp_sessions` is the nearest thing but cannot hold the item pools or report content. Rebuilding the module on them would need new tables anyway.
- **Alternatives considered**: keep a `users` table and mirror every account into it (two sources of truth); re-create `users` and leave the module unchanged (login would then have to check two tables); rebuild the module on the doc's SCP tables (large, needs product decisions on item storage and scoring).
- **Data**: structure only. Reference content returns via `npm run db:seed`. Rows created by earlier test runs (92 test users, attempts, responses) are not restored; the pre-drop backup still holds them.
- **Cost of the reversal**: the database is no longer "only the doc's tables". `structure.test.js` now asserts the exact set (22 + 15 + `_migrations`) so drift is still caught.
