> SUPERSEDED FOR STORAGE by feature 006 (PostgreSQL removed 2026-09-20); behavioural rules still apply

# Research: v3.1 Canonical Alignment (005)

**Branch**: `005-v3-1-canonical-alignment` | **Date**: 2026-09-19 | **Plan**: [plan.md](plan.md)

Phase 0 resolves every open technical question in the plan. Product/governance questions stay in the spec (D-01…D-07); the technical decisions found here are numbered **D-08…D-17** and carry a default so `tasks.md` can be generated. Each item: **Decision · Rationale · Alternatives**.

---

## R-01 — Where the canonical SQL comes from

**Decision**: Author the migrations from the BUILD 01 contract text (`§4` conventions, `§6` tables, `§7` functions/constraints, `§8` indexes, `§9` RLS, `§10` seeds) and the BUILD 03–08 "database changes" tables. Keep BUILD 01's file boundaries (`001…011`) as separate migrations so each can be checked against the contract section it came from; append BUILD 03/04, 05/06 and 07/08 hardening as three later files. Every constraint, trigger and function carries a comment naming its contract section or finding ID.

**Rationale**: The `*_SQL_Package_*.zip` files named in every manifest are not on disk (`spec.md` discrepancy #5). The prose is complete enough for tables, constraints and indexes; function *bodies* are described by behaviour and by the test matrices, so they are written to satisfy those tests.

**Alternatives**: wait for the packages (blocks the feature); copy structures from `image.png`/the ERD workbook (rejected — they diverge from the locked list).

**Risk**: function names such as `build03_resolve_registration`, `build04_consent_gate`, `build07_fire_p5` are taken from the prose; if the packages arrive, diff names and behaviours before the first deployment.

## R-02 — Runner, roles and grants

**Decision**: Keep `backend/scripts/migrate.js` (filename order, one transaction per file, `_migrations` tracking). Roles are cluster-level, so: `docker/init-app-role.sql` gains `santulan_worker` (`NOLOGIN`, `NOBYPASSRLS`); `scripts/santulan-grant-roles.js` grants schema/table/function privileges and makes `app_runtime` a member of `santulan_worker`. The API runs participant reads/writes as `app_runtime` and runs **controlled** writes (registration, consent verify, scoring, reports, exports) with `SET LOCAL ROLE santulan_worker` plus the matching actor scope. `PUBLIC` is revoked from every `SECURITY DEFINER` function. `app_runtime` is not the table owner and has no `BYPASSRLS`; the legacy `app_platform` `BYPASSRLS` role is **never** used against `santulan.*`.

**Rationale**: BUILD 05 grants `submit_attempt(uuid,text)` to `santulan_worker`; BUILD 09 forbids `BYPASSRLS`/owner access for the runtime role. `app_runtime` already exists as `NOSUPERUSER NOBYPASSRLS`.

**Alternatives**: a second login role with its own pool (more connections, no benefit at pilot scale); running everything as owner (fails SEC-12).

## R-03 — Transaction context variable names (D-10)

**Decision**: Implement BUILD 01 §4.1 names: `app.actor_scope` ∈ `PARTICIPANT | INSTITUTION_ADMIN | RESEARCH_OPERATOR | SUPER_ADMIN | SYSTEM`, plus `app.participant_id`, `app.admin_user_id`, `app.institution_id`, all set with `set_config(name, value, true)` (= `SET LOCAL`) as the first statements of a transaction, from server-authenticated state only. One helper (`withCanonicalTx`) is the only place that sets them, so a rename is a one-file change.

**Rationale**: BUILD 09 writes `app.actor_type` and `SERVICE`; BUILD 01 writes `app.actor_scope` and `SYSTEM`. The BUILD 09 SQL (`090`) is absent, so the older, fully specified names win; RLS policy text is written against a small `santulan.ctx_*()` function layer, which absorbs either naming.

**Alternatives**: accept both names in the helper functions (rejected — ambiguity is a security smell).

## R-04 — Registration and export idempotency without a new table (D-09)

**Decision**: Persist the `Idempotency-Key` outcome in the **existing** append-only `audit_logs`: on the successful create, the same transaction writes `REGISTRATION_CREATED` with `correlation_id = sha256(key)` and `new_state = {payload_hash, participant_id, route, track}` (no PII, no raw key). A replay looks up that row: same payload hash → return the original participant (200); different hash → 409. The same pattern covers `POST /research-exports`. Response saves and submits already have canonical keys (`responses.idempotency_key`, `response_events.metadata`).

**Rationale**: BUILD 03 §10 requires persistence "at the API/platform layer" and forbids a shadow table without change control; `audit_logs` is canonical, immutable and already written on registration, so the lookup is durable across restarts and instances. An in-memory map would break on restart.

**Alternatives**: a `platform_support.idempotency_keys` table in another schema (clean, but a change-control question and against the strict-per-docs rule — kept as the documented fallback); Redis (not in the stack).

**Risk**: audit rows become a lookup source; a covering index is already in the contract (`idx_audit_logs_target`), and `correlation_id` lookups are added in the BUILD 08 hardening migration only if profiling shows a need (an "extra index" needs the user's approval per the strict rule).

## R-05 — Catalog source, identifiers and hashes (D-08)

**Decision**: Generate normalized CSVs (`adolescent_items_v3_1.csv`, `emergingadult_items_v3_1.csv`, `assessment_catalog_v3_1.csv`, `canonical_subdomain_reference_v3_1.csv`) from the BUILD 02 workbook sheets `03_ADOL_CANONICAL`, `04_EA_CANONICAL`, `01_ASSESSMENT_CATALOG` and the 72-row subdomain reference (`06_SUBDOMAIN_COVERAGE`). Assessment-version UUIDs and every hash in the workbook (per-item `item_content_hash`, `content_hash`, `source_file_hash`) are stored **verbatim**. `items.item_id` is a deterministic UUIDv5 over `assessment_version_id:item_code` under a documented namespace, because the BUILD 01 seed UUIDs are only in the missing SQL package.

**Rationale**: Verified experimentally — the version UUIDs are UUIDv5 (variant nibble `5`) but no obvious namespace/name reproduces them, and no simple field concatenation reproduces `item_content_hash`. Hashes are therefore treated as *provided data*: reconciliation proves counts, coverage, legality, text equality and hash **presence/format**, and compares hashes only against the workbook, not by recomputation. Reproducibility of `item_id` comes from the derivation rule, recorded in the receipt.

**Alternatives**: read the v3_0 pools and remap in code (supported only as a cross-check — the diff to v3.1 is exactly 4 rows per form, asserted by a test); recompute hashes with a guessed rule (rejected — a wrong guess would look authoritative).

## R-06 — Enumerated value sets (D-11)

**Decision**: The contract names each enum but lists values only where prose states them. Use the values stated in BUILD 01–09 (participation route, tracks, consent types/relationships/status, attempt statuses, evidence states, Q01–Q09, P1–P5, report states, export states, admin roles) and, for the few unstated sets (e.g. `quality_severity`, `quality_disposition`, `progression_level`, `growth_plan_status`, `institution_type/status`), the **minimal** set the prose implies (e.g. `CRITICAL` is required; `UNREVIEWED` is the default disposition; `Foundation/Practice/Transfer`). Each such value is marked `-- ASSUMED (D-11)` in the migration and listed in `data-model.md`; adding a value later is a forward migration.

**Rationale**: Avoids inventing behaviour while letting tests and code compile. Nothing here changes a table's shape.

**Alternatives**: `TEXT` + `CHECK` (loses the contract's enum names).

## R-07 — Identity, OTP and credential lifecycle (D-14, D-16 superseded by D-17)

**Context change (2026-09-20)**: the legacy `accounts` table no longer exists. The canonical schema stores only `participants.auth_provider` + `auth_provider_subject_id` and `admin_users.auth_provider` + `auth_provider_subject_id` — no password, OTP, name or email (BUILD 03, Constitution VIII).

**Decision**:
- An `IdentityProvider` adapter (`requestOtp`, `verifyOtp`, `authenticate(santulanId, password)`, `setPassword`, `issueTemporaryCredential`, `revoke`) maps whatever the provider authenticates to a `(provider, subject)` pair; a small lookup (as `SYSTEM`) resolves `participant_id` / `admin_user_id` and the JWT carries them plus the role.
- *OPEN OTP*: the dev adapter logs the code to the server console, never stores it, and enforces expiry, single use and rate limits; production supplies the managed provider.
- *Institutional credentials and admin passwords*: **decision D-17 (approved 2026-09-20).** The managed provider owns them in production. For development the adapter needs a credential store; the default is a **dev-only table outside the canonical schema** (not one of the 28, not created without the requester's approval). Until approved, US4 credential tasks are blocked and tests use tokens minted by `tests/santulan/helpers/tokens.js`.
- Roster PII (name, gender, city…) is used transiently for validation and the credential file; only `Reg. Number → external_student_id`, age, cohort and institution are stored canonically.

**Alternatives**: password columns on `participants`/`admin_users` (violates BUILD 03 and Constitution VIII); re-creating `accounts` (contradicts the requester's removal of the old schema).

## R-08 — API surface and coexistence

**Decision**: One new router (`santulan.routes.js`) mounted at `/api/v1` with the BUILD paths (`/auth/*`, `/registrations/*`, `/participants/age-declaration`, `/consents/*`, `/attempts/*`, `/reports/*`, `/growth-plans/*`, `/admin/*`, `/research-exports/*`, `/internal/*`). Legacy `/api/v1/assessments/*` and `/api/v1/admin/assessments/*` stay. Database failures are mapped from SQLSTATE / constraint names to the contract's HTTP codes (422 validation, 409 conflict/idempotency, 404/403 scope, 503 catalog drift) in one mapper. Zod schemas use `.strict()` (unknown keys — including score fields — are contract errors, not ignored).

**Rationale**: Path collisions are avoided without versioning gymnastics; `additionalProperties=false` is the contract's mechanism for B05-030/B06-002.

**Alternatives**: `/api/v2` (no benefit — the legacy module is mounted under a distinct sub-path).

## R-09 — Streaming research export (D-12)

**Decision**: Generate the workbook with a streaming writer (`exceljs` `stream.xlsx.WorkbookWriter`) writing to a temp file, then move it to protected storage. Row source is a server-side cursor over the research-safe views. `ITEM_RESPONSES_nn` sheets are opened dynamically: a sheet is committed and the next opened when it reaches 1,048,575 data rows (header consumes row 1). Cell text beginning `= + - @` (and tab/CR) is prefixed to neutralise formulas; sheet names are fixed constants; long metadata is truncated with a marker. Ready is set only after the file is closed and moved; any exception sets Failed and deletes the partial file. Download uses a short-lived, authenticated, audited handler (file path never returned to the client).

**Rationale**: 2,220,000 rows × ~10 columns is ~22 M cells; SheetJS holds the whole workbook in memory. Partition arithmetic (`ceil(rows/1,048,575)`) is a pure function, unit-tested at the ±1 boundaries and independently of the writer.

**Alternatives**: SheetJS multi-file (workbook must stay one file); CSV parts (violates the canonical workbook); hand-written OOXML zip (more code than a dependency).

**Storage**: local protected directory in dev (`EXPORT_DIR`), object storage adapter for production (configuration; bucket and encryption are ops decisions).

## R-10 — Quality engine framework

**Decision**: A policy-driven runner: `quality_policy` (versioned JSON in configuration, **not** a table) lists enabled detectors, thresholds and outcome rules. With no approved policy the runner enables only what the contract defines deterministically — **Q06** (DB detector) — and records `QUALITY_CHECK_COMPLETED` with outcome `CLEAR` or `INVALID`; Q01–Q05, Q07, Q08 stay inert (release holds) and Q09 is fired only by an externally authorised trigger call that writes `Q09`/`CRITICAL` and moves the attempt to `QUALITY_HOLD`. Flags are inserted idempotently per attempt/domain/code; disposition/review fields are the only mutable columns.

**Rationale**: BUILD 06 forbids inventing thresholds, the Q05 rule, Q08 signals and the Q09 trigger; framework-without-values is the specified deliverable.

**Alternatives**: ship "reasonable" defaults (rejected — precise-looking but unauthorised).

## R-11 — Evidence-state configuration

**Decision**: `evidence_config` (versioned JSON in configuration keyed by `assessment_version_id` × domain) supplies the state; **missing ⇒ S1**. The scorer writes S0 for MS04 and clamps MS03 to S1; it never writes S3–S5 unless `app.allow_advanced_evidence_states = on` is set by the privileged worker for an approved release. Participant-facing services read only what RLS allows (S1 is hidden).

**Rationale**: BUILD 06 §8 — the schema has no per-domain registry; server configuration is the specified mechanism.

## R-12 — Report engine and background work

**Decision**: Report generation is a **worker job** that claims work with a transaction-scoped advisory lock and `FOR UPDATE SKIP LOCKED` on `reports`, renders sections from approved `interpretation_rules` / `development_actions` (only rows with `status` approved / `active`), persists all snapshots and then calls the DB `complete` function that moves report and attempt to `REPORT_READY`. No approved rule ⇒ the section is not created and the domain shows the neutral state (no fabricated prose). Jobs run in-process from `src/jobs/workers/` on a poll interval; no queue product is added.

**Rationale**: B07-076/077 (no partial report, single retry) map directly to one-transaction generation + advisory lock. The stack has no queue and the pilot volume does not justify one.

**Alternatives**: BullMQ/Redis (new infrastructure); synchronous generation in the submit request (couples submit latency to scoring and violates the BUILD 05 phase boundary).

## R-13 — Registration throttling (D-13)

**Decision**: A `ThrottleStore` interface with an in-memory sliding-window default keyed by IP and by device fingerprint (a signed device cookie), applied as a middleware separate from OTP throttling on OPEN registration; institutional sign-in and roster import are not behind it (SEC-17).

**Rationale**: Numeric limits are unspecified (B09-AUD-006); in-memory state is acceptable only as the dev default and a shared store is a deployment prerequisite before launch.

## R-14 — Backup and restore drill

**Decision**: A script (`scripts/backup-restore-drill.js` + a Markdown evidence template) runs `pg_dump -Fc` on the source, creates a **clean** database, `pg_restore`s into it, then executes: 28-table count, migration list, constraints/indexes/triggers/policy inventory, synthetic data reconciliation, RLS negative checks under `app_runtime`, and OPEN adult/minor + institutional + report + export smoke journeys. Output is a signed-off evidence file (backup ID, operator, timestamps, PASS/FAIL). The drill can run against local PostgreSQL; **launch evidence must come from staging**.

**Rationale**: BUILD 09 §8 defines the evidence list; RPO/RTO are ops policy, not invented.

## R-15 — Frontend approach

**Decision**: Keep CRA/React 19, CSS Modules and the existing component folder; replace `tokens.css` with the measured palette; add fonts as self-hosted subsets (`font-display: swap`, ≤ ~100 KB, D-07); add the shells (`PublicLayout`, `AppShell`, admin layout) and screens in the order Phase 3 → 9 needs them. The API client gets a `VITE`-style config flag `REACT_APP_API_MODE=canonical|legacy` for the cutover. Client holds no scoring, version choice or eligibility logic. Contrast script and `jest-axe` run in CI; visual review per screen against the samples.

**Rationale**: Nothing in the 003 contracts needs a framework change.

## R-16 — Test strategy and evidence

**Decision**: Four layers under `backend/tests/santulan/`: `database` (rolled-back transactions; invariants, triggers, RLS as `app_runtime`), `contract` (supertest; zod strictness, HTTP mapping, idempotency), `integration` (end-to-end flows and concurrency with real parallel connections), `security` (SEC-01…30 (except SEC-15) that can run locally). Every test title starts with its matrix ID (`T03-004`, `B05-037`, `AT-13`, `SEC-11`), and `tests/santulan/evidence/register.json` is generated from a run to list ID → status → evidence reference; IDs that need staging show `NOT_EXECUTED`. Concurrency tests use separate connections (a single-connection harness cannot prove advisory-lock behaviour), so they commit and clean up explicitly instead of using rollback.

**Rationale**: BUILD 09 rule — "a test without an evidence reference is not PASS".

## R-17 — Concurrency and idempotency mechanics

**Decision**: Rely on the contract's mechanisms and test them: partial unique indexes (`uq_one_nonterminal_attempt_per_participant`, `uq_current_response`, `uq_response_version`, submission-key expression index), a transaction-scoped advisory lock keyed on the idempotency key inside `save_response`, and `FOR UPDATE` on the attempt row in `begin_or_resume_session`, `submit_attempt` and scoring. The application never re-implements these as checks-then-insert.

## R-18 — Where the participation control plane lives (D-15)

**Decision**: The pause/stop/reopen state is **event-sourced in `audit_logs`**: each change inserts one row (`action_type = 'PARTICIPATION_CONTROL'`, `target_entity = 'ASSESSMENT_CONTROL'`, a fixed singleton `target_id`, `previous_state`/`new_state = {state}`, `reason`), and the current state is the latest such row (no row ⇒ `OPEN`, because the version's own `participation_state` already defaults to `CLOSED`). Attempt creation reads it through a small `SECURITY DEFINER` view/function and requires **both** gates open.

**Rationale**: BUILD 08 wants a config-store mutation and an audit write "in one fail-closed operation" and forbids a control table; making the audit row *be* the mutation gives atomicity for free — if the audit insert fails, nothing changed. It uses the existing `idx_audit_logs_target` index.

**Alternatives**: a settings table (a 29th table — rejected); a JSON config file (not multi-instance safe, not audit-atomic); toggling `assessment_versions.participation_state` (the contract explicitly says not to distort a frozen version).

---

## Decision register (technical)

| ID | Decision | Default | Revisit when |
|----|----------|---------|--------------|
| D-08 | Item UUIDs derived (UUIDv5); hashes stored verbatim | as R-05 | SQL package / hash rule obtained |
| D-09 | Idempotency persistence via `audit_logs` | as R-04 | change control approves a platform table |
| D-10 | Context names per BUILD 01 §4.1 | as R-03 | BUILD 09 SQL obtained |
| D-11 | Unstated enum values use the minimal implied set | as R-06 | SQL package obtained |
| D-12 | `exceljs` streaming writer | approve dependency | reviewer objects |
| D-13 | Throttle behind an interface, in-memory default | dev only | before launch (shared store) |
| D-14 | Identity behind an adapter (was: credentials inside `accounts`, now impossible) | as R-07 | D-17 decided |
| D-15 | Control plane event-sourced in `audit_logs` | as R-18 | change control approves a control table |
| D-16 | *(superseded — `accounts` and the legacy `schools` row no longer exist)* | — | — |
| D-17 | Dev credential store for institutional/admin passwords outside the 28 tables | **APPROVED 2026-09-20; implemented** (`dev_identity.credentials`, bcrypt, refuses production) | done |
