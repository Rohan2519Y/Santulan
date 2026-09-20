# Implementation Plan: v3.1 Canonical Alignment

**Branch**: `005-v3-1-canonical-alignment` | **Date**: 2026-09-19 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/005-v3-1-canonical-alignment/spec.md` (revised 2026-09-19)

## Summary

Bring the delivered Santulan product to the SanTulan 2.0 build contracts (BUILD 00–09). The technical approach:

1. **Add the canonical PostgreSQL schema `santulan`** — exactly the 28 tables of BUILD 01 §6 — through forward-only raw-SQL migrations run by the existing runner, next to (never inside) the feature-004 platform schema and the feature-002 assessment tables. The SQL packages named in the manifests are not on disk, so the migrations are **authored from the contract text** (tables, constraints, functions, triggers, indexes, RLS, seeds), mapped 1-to-1 to BUILD 01's file list.
2. **Load and reconcile the v3.1 catalog** from normalized CSVs derived from the BUILD 02 audit workbook (175 + 171 items), with a reconcile-by-default importer, receipts and audit events.
3. **Add a new backend module `src/modules/santulan/`** that talks only to the canonical schema through a trusted per-transaction context (`SET LOCAL` GUCs), calls the contract's `SECURITY DEFINER` procedures for the write paths, and exposes the BUILD API surface under new paths. The legacy `assessment` module stays untouched until the frontend has cut over.
4. **Identity**: OTP and password sign-in sit behind an `IdentityProvider` adapter that maps a provider + subject to `participants` / `admin_users` (`auth_provider`, `auth_provider_subject_id`). The legacy `accounts` table was removed with the old schema (2026-09-20), so where credentials live for the pilot is open decision D-17.
5. **Rebuild the frontend** to the Santulan design language and add the public, registration, dashboard, profile and eleven-page admin surfaces defined in the 003 contracts.
6. **Qualify**: DB tests in rolled-back transactions (the feature-004 harness pattern), API contract/integration tests, the AT/RC and SEC suites with an evidence register, a real backup-restore drill, and a G9 claims scan. Launch stays **NO-GO** until governance gates owned outside engineering close.

**Not in this plan**: legal consent copy, Q09 trigger/escalation, threshold values, report prose, evidence-state approvals — these are supplied by their owners; the plan builds the mechanism and the fail-closed default only.

## Technical Context

**Language/Version**: Node.js (dev machine v24; CRA/React 19 frontend), JavaScript (no TypeScript migration).

**Primary Dependencies**: Backend — Express 4, `pg` 8 (raw SQL, no ORM), `zod`, `jsonwebtoken`, `bcryptjs`, `multer`, `xlsx` (SheetJS, already present for import parsing). **New (needs approval, D-12)**: a streaming XLSX writer (`exceljs` `WorkbookWriter`) for the 2.22 M-row export — SheetJS builds the whole workbook in memory. Frontend — React 19, `react-router-dom` 6, `lucide-react`, CSS Modules.

**Storage**: PostgreSQL. Contract minimum 15+; local dev is 18.6, `docker-compose.yml` pins `postgres:16`. New schema `santulan` with `pgcrypto` (`gen_random_uuid`). Generated columns, partial unique indexes, RLS and `SECURITY DEFINER` functions are required features.

**Testing**: Jest 29 + supertest (`--runInBand`). DB tests run inside `BEGIN…ROLLBACK` on one owner connection and switch to the restricted role with `SET LOCAL ROLE` (the feature-004 `tests/database/harness.js` pattern). Frontend: React Testing Library, `jest-axe`, the `check:contrast` script.

**Target Platform**: Linux/Windows server for the API; modern evergreen browsers, 320 px phones to desktop. Access channels are responsive web only (`Final.jpeg`).

**Project Type**: Web application — `backend/` modular monolith + `frontend/` SPA.

**Performance Goals** (only those the contracts state): class burst of ~40 participants saving responses and two classes submitting together with no lost/duplicate writes or deadlocks (B05-039/040); 10,000 × 222 = 2,220,000-row export generated as a partitioned workbook without exhausting memory; report/score generation asynchronous with a real pipeline state (no numeric latency target exists in the sources — none is invented).

**Constraints**: exactly 28 canonical tables, no PII columns, forward-only migrations, no `UPDATE`/`DELETE` on `responses`, `audit_logs`, `score_results`, report snapshots; runtime role without `BYPASSRLS` and not the table owner; transaction-local context; participants never write consent/participants/scores directly; client never chooses the assessment version or supplies scores; no prohibited claims in UI/report/export.

**Scale/Scope**: pilot scale — ~10,000 participants, 222 items, 28 tables, ~60 API operations, 25 reference screens plus ~14 screens without a sample, 11 admin pages; ~445 mandatory tests across the BUILD matrices.

## Constitution Check

*GATE: pass before Phase 0; re-check after Phase 1.*

`.specify/memory/constitution.md` is still the unfilled template — **no ratified principles exist**, so no formal gate can fail. The plan is instead held to the spec's own non-negotiables and the project's standing rule *"database strictly per the docs, no invented extras"* (memory: feedback-database-strictly-per-docs), which BUILD 01 restates as "no silent schema additions".

| Gate (derived) | Source | Pre-research | Post-design |
|----------------|--------|--------------|-------------|
| Exactly 28 canonical tables; no shadow/29th table | FR-001, BUILD 01 App. B | PASS | PASS — idempotency persistence uses `audit_logs` (R-04), not a new table |
| Forward-only migrations; never edit an applied file | BUILD 01 §4, memory | PASS | PASS — new numbered files only |
| No PII columns (name, email, phone, DOB, guardian) | FR-013, BUILD 03 | PASS | PASS — roster PII is transient; bridge stores provider + subject only |
| Fail-closed defaults (DRAFT/CLOSED, S1, inactive actions, release OFF) | FR-007, FR-024 | PASS | PASS — seed migration asserts them |
| Tests first for DB invariants | spec Independent Tests, BUILD test matrices | PASS | PASS — invariants land with a failing DB test before each migration |
| No new runtime dependency without impact assessment | spec Assumptions | **FLAG** | ACCEPTED — one candidate (`exceljs`), assessed in R-09 |
| Old schema removed on request (2026-09-20); `santulan` is the only schema | FR-001 | PASS | PASS — 28 tables, backup taken, old migrations deleted |

No unjustified violations. Complexity that needs justification is in *Complexity Tracking*.

## Project Structure

### Documentation (this feature)

```text
specs/005-v3-1-canonical-alignment/
├── plan.md                      # this file
├── research.md                  # Phase 0 — decisions R-01…R-18 (D-08…D-17)
├── data-model.md                # Phase 1 — 28 tables, relationships, state machines, objects
├── quickstart.md                # Phase 1 — validation scenarios
├── contracts/
│   ├── api.md                   # REST surface (BUILD 03–09), authz, idempotency, errors
│   ├── database-contract.md     # schema objects, roles, context, migration map, RLS matrix
│   └── catalog-import.md        # sources, normalized CSVs, reconcile/apply, receipts
├── checklists/requirements.md
└── tasks.md                     # Phase 2 — /speckit-tasks (NOT created here)
```

UI contracts live in `specs/003-frontend-visual-design/contracts/` (`design-system.md`, `screen-inventory.md`, `dashboards.md`) and are consumed, not duplicated.

### Source Code (repository root)

```text
backend/
├── migrations/                                   # existing runner: filename order, one txn per file
│   ├── 008_santulan_roles_extensions_types.sql   # ← BUILD 01 000/001
│   ├── 009_santulan_core_identity_org.sql        # ← 002
│   ├── 010_santulan_assessment_content.sql       # ← 003
│   ├── 011_santulan_assessment_delivery.sql      # ← 004
│   ├── 012_santulan_quality_scoring_reporting.sql# ← 005
│   ├── 013_santulan_growth_pathways.sql          # ← 006
│   ├── 014_santulan_research_audit.sql           # ← 007
│   ├── 015_santulan_constraints_triggers_functions.sql # ← 008
│   ├── 016_santulan_indexes.sql                  # ← 009
│   ├── 017_santulan_rls.sql                      # ← 010 (+ BUILD 09 FORCE RLS)
│   ├── 018_santulan_seed_reference_content.sql   # ← 011 (fail-closed seeds)
│   ├── 019_santulan_build03_controls.sql         # ← BUILD 03 030 (registration)
│   ├── 020_santulan_build04_controls.sql         # ← BUILD 04 040 (consent gate)
│   ├── 021_santulan_build05_controls.sql         # ← BUILD 05 050/051 (delivery hardening + control-plane read fn)
│   ├── 022_santulan_build06_controls.sql         # ← BUILD 06 060 (quality/scoring)
│   ├── 023_santulan_build07_controls.sql         # ← BUILD 07 070 (reporting/growth/pathways)
│   ├── 024_santulan_build08_controls.sql         # ← BUILD 08 080 (admin/research)
│   └── (013 freeze template + 014 smoke tests stay as scripts, not auto-applied migrations)
├── seeders/santulan/                             # normalized CSVs + loader (from BUILD 02 workbook)
├── scripts/
│   ├── catalog-generate-csv.js                   # BUILD 02 workbook → normalized CSVs (deterministic)
│   ├── catalog-offline-verify.js                 # counts, coverage, legality, hash presence, v3_0 cross-check
│   ├── catalog-reconcile.js                      # reconcile | apply | rollback-from-receipt, receipt JSON
│   ├── santulan-grant-roles.js                   # santulan_worker + app_runtime grants
│   ├── santulan-freeze.js                        # BUILD 01 013 freeze template; refuses without a signed scale hash
│   └── backup-restore-drill.js                   # dump → clean DB → restore → checks → evidence file
├── src/
│   ├── routes/v1/santulan.routes.js              # new router; the legacy /assessments/* routes are dead code (their tables were removed)
│   └── modules/santulan/
│       ├── context/                              # withCanonicalTx({actorScope, …}) → SET LOCAL
│       ├── catalog/  registration/  consent/  delivery/
│       ├── quality/  scoring/  reporting/  growth/  pathways/
│       ├── admin/  research/  audit/  identity/  security/   # identity = provider adapters; security = throttle adapter
│       └── shared/                               # errors→HTTP mapping, zod schemas, correlation ids
└── tests/santulan/{database,contract,integration,security,evidence}/

frontend/
└── src/
    ├── styles/                                   # tokens.css (new palette), fonts
    ├── components/                               # existing restyled + new (design-system.md §2.2)
    └── pages/{public,register,participant,admin}/  # per screen-inventory.md and dashboards.md
```

**Structure Decision**: Web application (existing `backend/` + `frontend/`). The canonical module is **additive** — a sibling of `modules/assessment` — so the shipped flow keeps working while the new one is built and cut over. New migrations extend the existing numbered sequence (`008…`); the contract's optional-role bootstrap becomes a migration plus a grant script because roles are cluster-level and the existing project already splits role creation (`docker/init-app-role.sql`) from grants (`scripts/grant-runtime-role.js`).

### Delivery order (drives `tasks.md`)

| Phase | Stories | Deliverable | Exit evidence |
|-------|---------|-------------|---------------|
| 0 Foundations | — | Test harness for `santulan`, roles, context helper, error mapping | harness runs an empty suite as owner and as `app_runtime` |
| 1 Schema | US1 | 28 tables, types, functions, triggers, indexes, RLS, fail-closed seeds | table-count = 28; BUILD 01 validation + smoke assertions pass |
| 2 Catalog | US1 | CSVs, loader, reconcile/apply, receipts, audit event | T-B02-001…020 |
| 3 Identity + consent (MVP) | US2, US3 | registration API, routing, Santulan ID, idempotency, consent state machine and gate | T03-001…028, T04-001…036 |
| 4 Delivery | US5 | attempt create, sessions, responses, submit, resume model | B05-001…045 |
| 5 Quality + scoring | US6 | quality runner framework, Q06/Q09, scorer, research view | B06-001…060 |
| 6 Reporting + development | US7 | report engine, T11/T12, growth plan, pathways, P5 hook | B07-001…080 |
| 7 Sign-in + roster | US4 | identity adapter (D-17), OTP adapter, roster validation/commit, credential lifecycle | AT-01–09, AT-27 |
| 8 Admin + research | US8 | control plane, audit, institutions, participants, exports | B08-001…084 |
| 9 Security + QA | US9 | FORCE-RLS negative suite, IP/device throttle, restore drill, AT/RC + SEC evidence, G9 scan | 44 + 29 tests, G1–G10 register |
| UI (parallel from Phase 3) | US10 | tokens, shells, screens, dashboards | contrast script, per-screen review, SC-010/011 |

**MVP** = Phases 0–3 (schema + catalog + registration + consent gate) — independently demonstrable and the base for everything else. Phase 7 is scheduled after delivery; Phases 3–6 are exercised with tokens minted by the test helpers (there is no demo-account login any more — D-17).

### Cutover strategy (D-06, resolved 2026-09-20)

There is no cutover: the old schema is gone. The canonical module ships at its own paths (`/api/v1/registrations`, `/consents`, `/attempts`, `/reports`, `/admin/*`, `/research-exports`, `/internal/*`). Legacy backend code that still queries the removed tables (`modules/assessment`, `modules/auth`, `seeders/*`, `tests/database`, `tests/integration`, `tests/contract`) is dead until it is removed or replaced; deleting it is a separate, explicit step. The frontend is rebuilt against the canonical API screen by screen.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|------|-----------|--------------------------------------|
| Legacy backend code left in place but unusable (queries removed tables) | Deleting application code was not part of the request to remove the old schema | Deleting it silently would go beyond the request; it is listed for a decision |
| Credentials outside the 28 tables (D-17) | Sign-in and temporary passwords need somewhere to live and Constitution VIII forbids Santulan storing passwords | A password column on `participants` would add PII-adjacent data to the canonical schema |
| No `BYPASSRLS` role exists at all | BUILD 09 forbids it for the runtime; the legacy `app_platform` role was dropped | Privileged reads use `SET LOCAL ROLE santulan_worker` with an explicit `SYSTEM` context instead |
| New streaming-XLSX dependency (`exceljs`) | 2.22 M rows cannot be built in memory with SheetJS | Hand-writing OOXML is larger and riskier than one MIT-licensed dependency |
| Migrations authored from prose (SQL packages absent) | Only the `.docx` contracts exist on disk | Waiting for the packages blocks the whole feature; each object is traceable to a contract section instead |
