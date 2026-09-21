# Document reconciliation — locked documents that still describe PostgreSQL

**Change record**: CR-006 (`change-record-006.md`) · **Date**: 2026-09-21 · **Constitution**: v3.0.0

The locked source documents under `docs/Santulan 2.0/` were written for PostgreSQL. Feature 006 removed PostgreSQL (2026-09-20). The
documents themselves are **not edited** — they are locked sources. This register lists every passage that still describes the relational
store, what the MongoDB build does instead, and where that is defined. **Behavioural rules in these passages still apply**; only the
storage mechanism changed.

Status values: `TO RECONCILE BEFORE LAUNCH` (the owner must issue reconciled/re-issued text or formally accept this register as the
reconciliation) · `NO CHANGE NEEDED` (the passage states behaviour, not mechanism).

Passages were extracted from the `.docx` files on 2026-09-21 (paragraph text search for PostgreSQL, RLS, `SET LOCAL`, triggers, DDL,
`psql`, `BYPASSRLS`). The section numbers below are the documents' own.

Equivalents are defined in: `data-model.md` (DM), `contracts/database-contract.md` (DC), `plan.md`, `research.md` (R-M…) of this feature.

## 1. BUILD 01 — Canonical Database Contract (PostgreSQL) v3.1

File: `BUILD_01_…/Santulan_BUILD_01_Canonical_Database_Contract_PostgreSQL_v3_1.docx`. The title itself names PostgreSQL.

| # | Passage (section) | MongoDB equivalent | Status |
|---|-------------------|--------------------|--------|
| B01-1 | Title and cover: "PostgreSQL DDL, Migrations, Constraints, Indexes, RLS and Seed Contract"; "PostgreSQL 15+; schema `santulan`" | MongoDB 8.0 replica set; database `santulan`; data model as code in `backend/db/schema/` (DM §1, DC §1) | TO RECONCILE BEFORE LAUNCH |
| B01-2 | §1 "directly implementable PostgreSQL contract"; "Create the canonical schema, types, 28 tables, constraints, triggers, stored procedures, indexes and RLS policies" | 27 collections + 9 views + 50 named indexes + `$jsonSchema`/`$expr` validators + application rules + one least-privilege role. `response_scales` is retired (CR-006-3), hence 27 not 28 (DM §2, §9) | TO RECONCILE BEFORE LAUNCH |
| B01-3 | Cover / §28 "no additional physical tables introduced"; "live PostgreSQL migration execution REQUIRED before merge/deploy" | The canonical set is 27 collections (one retired) plus the non-canonical dev-only `dev_identity_credentials` (CR-006-7). Live execution is required against a **MongoDB replica set** (DC §7) | TO RECONCILE BEFORE LAUNCH |
| B01-4 | §2 "Draft/research content visibility required fail-closed RLS" | Scoped data-access layer: `withScope(scope, …)`; no scope ⇒ empty results / refusal; research content reachable only through the eight `v_research_*` views (DC §5, DM §8) | TO RECONCILE BEFORE LAUNCH |
| B01-5 | §4 "Physical PostgreSQL Conventions"; "RLS plus application-layer scoping using server-set transaction context" | Conventions in DM §1 (UUID string `_id`, explicit nulls, `additionalProperties:false`, `validationAction error`); scope built server-side only (DC §5) | TO RECONCILE BEFORE LAUNCH |
| B01-6 | §4.1 "Required application transaction context": `SET LOCAL app.actor_scope / participant_id / admin_user_id / institution_id` | Frozen immutable scope object `{ actorScope, participantId, adminUserId, institutionId }` built by `store/scope.js` from the verified session; passed explicitly per call, never module state, never from body/query/header (DC §5). The "no client-controlled RLS context" rule (BUILD 01 §17) is kept | TO RECONCILE BEFORE LAUNCH |
| B01-7 | §5.1 Consent: "The attempt-create trigger checks currently active verified consent/assent" | Application-enforced gate at attempt creation, inside the same transaction as the insert (DM §7); consent machine compare-and-set | TO RECONCILE BEFORE LAUNCH |
| B01-8 | §5.3 "Research only; participant RLS hides score" | Participant scope cannot read unreleased scores/sections; there is no participant score endpoint; the chart is read from the released report (DC §5) | TO RECONCILE BEFORE LAUNCH |
| B01-9 | §5.4 / §6.24 "Safeguarding trigger" / `trigger_code` | These name the **safeguarding trigger** (Q09) and a data column, not the database feature — behaviour unchanged | NO CHANGE NEEDED |
| B01-10 | §7 "resolve_assessment_track + assessment_configuration_age_ck + attempt trigger enforce 13–17/18–25" | Same-document rule in the `assessment_versions`/`participants` validators; cross-document rule in `domain/registrationRules.js` and the attempt service (DM §4, §7) | TO RECONCILE BEFORE LAUNCH |
| B01-11 | §7 database functions, triggers (immutability, snapshot, consent, one active attempt) | Validators (same-document), unique/partial-unique indexes (`uq_one_nonterminal_attempt_per_participant` …), Tier A insert-only privilege (immutability beneath application code), application invariants (DM §4, §5, §7; DC §2.1) | TO RECONCILE BEFORE LAUNCH |
| B01-12 | §9 "Row-Level Security Contract" ("defense-in-depth; policies fail closed when transaction context is absent") | Scoped access layer with the same fail-closed rule (no scope ⇒ nothing), plus store-level privileges for immutability (DC §2.1, §5). Store guarantees G-21…G-26 replace the RLS matrix | TO RECONCILE BEFORE LAUNCH |
| B01-13 | §11 "Migration Execution Contract": `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 001_extensions_types.sql … 012_validation_contract.sql`; "013 only after approvals; 014 only in test/staging" | `npm run db:migrate` applies `backend/db/migrations/001–004` (forward-only, SHA-256 recorded in `_data_migrations`, edited-file refused); reference content by `npm run db:seed:reference`; no test-only or approval-gated migration (DC §3) | TO RECONCILE BEFORE LAUNCH |
| B01-14 | §11/§12/§13.2/§16.1 "execute on target PostgreSQL 15+ with ON_ERROR_STOP=1"; "Verify exactly 28 base tables and all expected enums/functions/triggers/indexes/policies exist" | `npm run db:verify` checks 27 collections, 9 views, validators, 50 indexes by name and definition, hashes, integrity; non-zero exit on failure (DC §7) | TO RECONCILE BEFORE LAUNCH |
| B01-15 | §14.3 "Explicitly deferred — not silently added" (development action instances, growth context, growth events) | Rule preserved: nothing beyond the contracts without a change record. Additions made by feature 006 are exactly CR-006-1…11 | NO CHANGE NEEDED |
| B01-16 | §16 "Review RLS role grants, SECURITY DEFINER ownership, backup/restore" | Role `santulan_runtime` (no `remove`, no schema change); `mongodump`/`mongorestore` drill `npm run drill:backup-restore` (research R-M12); no SECURITY DEFINER equivalent is needed | TO RECONCILE BEFORE LAUNCH |
| B01-17 | §16.1 "RLS negative tests prove cross-participant and cross-institution isolation" | Isolation suites `tests/santulan/store/scope.test.js`, `tests/santulan/security/isolation.test.js` (SEC-01…SEC-12, G-21…G-26) | TO RECONCILE BEFORE LAUNCH |
| B01-18 | §17 deliverables: "Santulan_BUILD_01_Canonical_Database_Contract_PostgreSQL_v3_1.docx", "Executable migration/seed/validation/RLS/smoke-test package" | Replaced by `backend/db/` (schema + migrations), `scripts/{db-migrate,db-verify,db-scratch,seed-reference}.js`, `tests/santulan/store/` | TO RECONCILE BEFORE LAUNCH |

Companion files (`…_DB_Contract_v3_1.json`, `…_Static_SQL_Audit_v3_1.json`, `…_Release_Manifest_v3_1.json`) describe the same PostgreSQL
package: the static SQL audit and the SQL file hashes **do not apply**. The new release fingerprint is `backend/release/manifest.json`
(`npm run release:manifest`).

## 2. Master Implementation Runbook (CODE BUILDS 01–09)

File: `implementation files/Santulan_CODE_BUILDS_01_09_Master_Implementation_Runbook_Audit_ON_v1_0.docx`.

| # | Passage (section) | MongoDB equivalent | Status |
|---|-------------------|--------------------|--------|
| RB-1 | Cover / §1.2 "28 PostgreSQL base tables"; "Canonical PostgreSQL schema = 28 base tables. Additive columns/views/functions may be governed" | 27 collections + governed additions (CR-006). The "no shadow domain tables" rule stands (DM §2, §9) | TO RECONCILE BEFORE LAUNCH |
| RB-2 | §2.1 "Minimum engineering environment: PostgreSQL"; "BUILD 02 preflight enforces PostgreSQL 15+" | MongoDB 8.0 replica set, local dedicated instance on 27018, Node.js. Start-up check (runtime user, replica set, data-model version) replaces the version preflight (DC §1; store start-up test G-17) | TO RECONCILE BEFORE LAUNCH |
| RB-3 | §2.4 staging is "the mandatory place for migration, RLS, concurrency, report reproducibility and qualification tests" | Unchanged for staging; "RLS" reads "scoped-access and privilege tests". No staging exists yet (`launch-gates.md` E1) | TO RECONCILE BEFORE LAUNCH |
| RB-4 | §3 audit remediation A-items on RLS: `app.actor_scope` vs `app.actor_type`; participant routes not setting RLS context; owner bypass; `BYPASSRLS`; "runtime must be NO BYPASSRLS and non-owner" | The defect class is designed out: one scope constructor, per-request, from the verified session; the runtime credential is not privileged and has no `remove`/schema rights (DC §2.1); test G-13…G-15, SEC-12 | TO RECONCILE BEFORE LAUNCH |
| RB-5 | §3 "Participant score endpoint can return raw research-only rows if RLS is bypassed" | There is **no** participant score endpoint (api-delta; withdrawn) | TO RECONCILE BEFORE LAUNCH |
| RB-6 | §3 "Report sections default unreleased while the immutability trigger blocks any UPDATE … permit only `is_released_to_participant`" | Tier B `report_sections`: the only permitted mutation is the release flag; content/version/domain/order immutable via the named-mutation list in `store/access.js`; release atomic with `REPORT_READY` in one transaction | TO RECONCILE BEFORE LAUNCH |
| RB-7 | §4.2 "Clean database bootstrap order: apply 001–012 in exact order … candidate assessment versions/items/actions/prompts and validation contract" | `db:migrate` (001–004) then `db:seed:reference` (216 actions inactive, 72 prompts draft). **No question set is seeded**; sets arrive by upload (spec FR-023/024 replaced) | TO RECONCILE BEFORE LAUNCH |
| RB-8 | §5 CODE BUILD 01 "Python/FastAPI codebase … PostgreSQL connection pool … RLS baseline and seeded reference content"; "Fresh PostgreSQL 15+ database"; "Create trusted DB-context middleware" | Implementation is Node.js/Express with the official `mongodb` driver (no ODM) — an existing platform decision, not introduced here; single `MongoClient`; trusted scope middleware (`store/scope.js`) | TO RECONCILE BEFORE LAUNCH |
| RB-9 | §6 CODE BUILD 02 "Run 020 preflight; PostgreSQL version, 28-table count and assessment version contract must pass" | `db:verify`; frozen-set `content_hash` recomputed at freeze, open and start-up. Item wording comes from uploaded, frozen sets (constitution I, II), not a frozen catalog file | TO RECONCILE BEFORE LAUNCH |
| RB-10 | §7 CODE BUILD 03 "Replace `SET LOCAL app.actor_type` … with the repository RLS contract (`app.actor_scope=SYSTEM`)" | Registration inserts under an explicit `SYSTEM` scope through `withScope` (task T062) | TO RECONCILE BEFORE LAUNCH |
| RB-11 | §8/§9 "rely on the DB attempt trigger as final defence-in-depth"; "Verify one-active-attempt unique index and consent trigger" | Partial unique index `uq_one_nonterminal_attempt_per_participant` + the transactional consent gate | TO RECONCILE BEFORE LAUNCH |
| RB-12 | §10 "filter it strictly to participant-approved evidence states under correctly enforced RLS" | Participant scope filter on released report sections only | TO RECONCILE BEFORE LAUNCH |
| RB-13 | §10 / §19 "Q09 trigger protocol", "Q09/P5 trigger procedure", "060 migration Q09 safeguarding trigger" | Safeguarding trigger (Q09) — a behaviour, not a database trigger. Unchanged: fires only from an approved trigger source; human P5 workflow remains an owner decision | NO CHANGE NEEDED |
| RB-14 | §14 "Cross-Build Authentication, RLS and Worker Architecture"; §14.1 `SET LOCAL app.actor_scope = …` per request/worker; "never copy actor_scope, participant_id, institution_id … from arbitrary client headers" | Same security rule, realised by `buildScope(user)` and the `SYSTEM` scope constructor for workers (DC §5). Tests SEC-08, SEC-09 | TO RECONCILE BEFORE LAUNCH |
| RB-15 | §14.2 "Recommended database role split: `santulan_runtime` … NO BYPASSRLS; not owner"; "Do not use the table owner as the normal web runtime role" | Two credentials: `santulan_runtime` (least privilege) for the API and workers; `santulan_migrator` for scripts and tests only, never in the API environment (DC §2) | TO RECONCILE BEFORE LAUNCH |
| RB-16 | §16.2 / §16.4 "Repeat critical tests under the non-owner runtime role with RLS enabled"; "test RLS context leakage across pooled connections" | Tests run **under** the runtime credential (`privileges.test.js`, `scope.test.js`); interleaved-request scope leakage test SEC-11 / G-26 | TO RECONCILE BEFORE LAUNCH |
| RB-17 | §17 Go/No-Go: "Runtime DB role is non-owner/NOBYPASSRLS and RLS isolation tests pass"; "RLS hardening, abuse protection, backup/actual restore" | Read as: runtime credential is least-privilege and scoped-isolation tests pass on the target deployment. Gate remains `NOT_EXECUTED` (`launch-gates.md` G8, E2) | TO RECONCILE BEFORE LAUNCH |
| RB-18 | §19 ownership: "Schema, RLS context, roles/grants, functions, migration/restore"; "RLS tests" | Owner assignment unchanged (still `TODO(GOVERNANCE_OWNERS)`); artefacts renamed as above | TO RECONCILE BEFORE LAUNCH |

## 3. Pilot RC0 Final Tech Handover Guide

File: `implementation files/Santulan_Pilot_RC0_Final_Tech_Handover_Guide_Audit_ON_v1_0.docx`.

| # | Passage (section) | MongoDB equivalent | Status |
|---|-------------------|--------------------|--------|
| HG-1 | §4 bootstrap: `cp .env.example .env`; "start PostgreSQL"; `docker compose up -d db`; `SANTULAN_MIGRATION_DATABASE_URL`; `make db-migrate`; `make db-verify` | `npm run db:local:init -- --write-env` (dedicated local instance, **no Docker**), `npm run db:migrate`, `npm run db:verify`; `MONGODB_URI_RUNTIME` / `MONGODB_URI_ADMIN` | TO RECONCILE BEFORE LAUNCH |
| HG-2 | §5 "`santulan_runtime` and `santulan_worker` are NOBYPASSRLS group roles"; "RLS + application-layer ownership/scoping are defence-in-depth" | One runtime credential shared by API and workers; workers act under the explicit `SYSTEM` scope. Application-layer scoping is the isolation mechanism, backed by privilege limits | TO RECONCILE BEFORE LAUNCH |
| HG-3 | §8 remediation register: "Separate owner/runtime/worker NOBYPASSRLS group roles; runtime gets SELECT+EXECUTE only. Live role/RLS proof required." | Runtime: `find`+`insert` (Tier A) or `find`+`insert`+`update` (Tier B); never `remove`. Live proof still required on the target deployment | TO RECONCILE BEFORE LAUNCH |
| HG-4 | §"216 seeded; inactive and participant_release=false" — "Growth/pathway release flags enforced application+DB/RLS side; default OFF" | 216 actions seeded `active=false`; release switches are audited events, default OFF, enforced in the application (CR-006-11) | TO RECONCILE BEFORE LAUNCH |
| HG-5 | §12 staging order: "Prove runtime role is not owner and has no BYPASSRLS"; "Run RLS cross-tenant and OPEN NULL-institution isolation tests, including pooled-connection context reset/SET LOCAL behavior"; "Re-run schema, integrity, RLS and critical end-to-end smoke journeys against the restored environment" | Privilege dump for `santulan_runtime`; SEC-01…SEC-12 including OPEN (null institution) never matching an institution scope; the backup drill runs `db-verify`, the store suite and a smoke journey on the restored copy | TO RECONCILE BEFORE LAUNCH |
| HG-6 | §16 ownership: "Migrations, ownership, RLS, grants, constraints, backup/restore, query isolation" | Same ownership; artefact names as above | TO RECONCILE BEFORE LAUNCH |
| HG-7 | §17 "live PostgreSQL/RLS execution, external integrations, approved c…" still required | Read as live **MongoDB** execution; still not done (`launch-gates.md`) | TO RECONCILE BEFORE LAUNCH |
| HG-8 | Safeguarding trigger ownership / human handoff | Behaviour, not database mechanism | NO CHANGE NEEDED |

Companion file `Santulan_Tech_Handover_Control_Register_Audit_ON_v1_0.xlsx`: any row that names PostgreSQL, RLS, `psql` or a SQL file is
reconciled by the same mapping as §3; it was **not** re-opened for this register (spreadsheet, not extracted) —
`TO RECONCILE BEFORE LAUNCH`.

## 4. System Qualification — Pilot Release Execution Runbook (RELEASE_01)

File: `RELEASE_01_…/Santulan_System_Qualification_Pilot_Release_Execution_Runbook_v1_0.docx`
(the copy under `implementation files/` is the same title; treat both identically).

| # | Passage (section) | MongoDB equivalent | Status |
|---|-------------------|--------------------|--------|
| RR-1 | §1 "…deployed staging application, PostgreSQL access, back…" not available | Staging environment and a MongoDB deployment are still not available (`launch-gates.md` E1) | TO RECONCILE BEFORE LAUNCH |
| RR-2 | §2 "Verify PostgreSQL RLS-based tenant isolation and application-layer scoping" | Verify scoped data-access isolation and runtime-credential privileges on the target MongoDB deployment | TO RECONCILE BEFORE LAUNCH |
| RR-3 | §3 E2 "Apply BUILD 09 RLS migration in staging; verify runtime role privileges; execute cross-tenant, OPEN NULL-tenant, participant ownership, service-context and connection-pool leakage tests" | Apply data-model migrations 001–004 on staging; dump the runtime role's privileges; run SEC-01…SEC-12 and G-21…G-26 (the "connection-pool leakage" test is the interleaved-scope test) | TO RECONCILE BEFORE LAUNCH |
| RR-4 | §3 E7 "Restore that exact backup into a clean recovery/staging environment; re-run schema, integrity, RLS and application smoke checks" | `mongorestore` into a clean database; re-run `db:verify`, the store suite and the smoke journey (`backup-restore-drill.js`) | TO RECONCILE BEFORE LAUNCH |
| RR-5 | §4 "Application-layer institution filtering alone is not an RLS PASS" | In this build the application-layer scope **is** the isolation mechanism; a PASS therefore requires the store-level guarantees too (G-13…G-15 privileges, G-21…G-26 scope) on the target — the underlying rule (isolation must be proven beneath the application code, not assumed) is preserved | TO RECONCILE BEFORE LAUNCH |
| RR-6 | §4 "A synthetic Q09 engine trigger without an operational human handoff is not safeguarding readiness" | Behaviour — unchanged | NO CHANGE NEEDED |
| RR-7 | §5 "No PostgreSQL staging connection is available to execute the RLS migration/tests" | Blocker restated: no MongoDB staging deployment | TO RECONCILE BEFORE LAUNCH |
| RR-8 | Execution Control workbook (`…Execution_Control_v1_0.xlsx`, sheets 01_LAUNCH_GATES, 09_EXECUTION_CONTROL): gate and execution rows that name PostgreSQL/RLS | Mirrored by `launch-gates.md` §1–§2 (G1–G10, E1–E11), reworded for MongoDB. Workbook not edited | TO RECONCILE BEFORE LAUNCH |

## 5. Other locked documents with database wording (not extracted here)

BUILD 00 Baseline Lock (v3.0/v3.1 JSON and DOCX), BUILD 02–09 documents and audit workbooks contain the same class of wording where they
refer to "the database", "RLS", the 28 tables or `santulan.` schema-qualified names. They were not exhaustively extracted for this
register. Rule for all of them: **the behavioural requirement stands; the mechanism is per this feature's `data-model.md` and
`contracts/database-contract.md`.** `TO RECONCILE BEFORE LAUNCH` (the owner should either re-issue the affected passages or accept this
register as the reconciliation record).

## 6. What "reconciled" means

Each row moves out of `TO RECONCILE BEFORE LAUNCH` only when the owner records one of: (a) a re-issued locked document with the
MongoDB text, or (b) a signed acceptance of this register for that row. Until then `launch-gates.md` keeps the release at **NO-GO**
and the governance item "owner confirmation of change record CR-006" (open governance item 12) stays open.
