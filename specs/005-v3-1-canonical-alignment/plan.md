# Implementation Plan: v3.1 Canonical Alignment

**Branch**: `005-v3-1-canonical-alignment` | **Date**: 2026-09-19 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/005-v3-1-canonical-alignment/spec.md` (revised 2026-09-19)

## Summary

Bring the delivered Santulan product to the SanTulan 2.0 build contracts (BUILD 00–09). The technical approach:

1. **Add the canonical PostgreSQL schema `santulan`** — exactly the 28 tables of BUILD 01 §6 — through forward-only raw-SQL migrations run by the existing runner, next to (never inside) the feature-004 platform schema and the feature-002 assessment tables. The SQL packages named in the manifests are not on disk, so the migrations are **authored from the contract text** (tables, constraints, functions, triggers, indexes, RLS, seeds), mapped 1-to-1 to BUILD 01's file list.
2. **Load and reconcile the v3.1 catalog** from normalized CSVs derived from the BUILD 02 audit workbook (175 + 171 items), with a reconcile-by-default importer, receipts and audit events.
3. **Add a new backend module `src/modules/santulan/`** that talks only to the canonical schema through a trusted per-transaction context (`SET LOCAL` GUCs), calls the contract's `SECURITY DEFINER` procedures for the write paths, and exposes the BUILD API surface under new paths. The legacy `assessment` module stays untouched until the frontend has cut over.
4. **Bridge identity**: existing `accounts` sign-in maps to `participants` / `admin_users` through the optional `auth_provider` + `auth_provider_subject_id` pair; OTP sits behind an adapter so the managed provider is configuration.
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
| Legacy platform untouched | FR-001 | PASS | PASS — `santulan.*` schema-qualified; legacy routes kept |

No unjustified violations. Complexity that needs justification is in *Complexity Tracking*.

## Project Structure

### Documentation (this feature)

```text
specs/005-v3-1-canonical-alignment/
├── plan.md                      # this file
├── research.md                  # Phase 0 — decisions R-01…R-18 (D-08…D-16)
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
│   ├── routes/v1/santulan.routes.js              # new router; legacy /assessments/* untouched
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
| 7 Sign-in + roster | US4 | accounts bridge, OTP adapter, roster validation/commit, credential lifecycle | AT-01–09, AT-27 |
| 8 Admin + research | US8 | control plane, audit, institutions, participants, exports | B08-001…084 |
| 9 Security + QA | US9 | FORCE-RLS negative suite, IP/device throttle, restore drill, AT/RC + SEC evidence, G9 scan | 44 + 29 tests, G1–G10 register |
| UI (parallel from Phase 3) | US10 | tokens, shells, screens, dashboards | contrast script, per-screen review, SC-010/011 |

**MVP** = Phases 0–3 (schema + catalog + registration + consent gate) — independently demonstrable and the base for everything else. Phase 7 is scheduled after delivery because the demo-account bridge lets Phases 3–6 be exercised earlier.

### Cutover strategy (D-06)

1. Canonical module ships at new paths (`/api/v1/registrations`, `/consents`, `/attempts`, `/reports`, `/admin/*`, `/research-exports`, `/internal/*`); legacy `/api/v1/assessments/*` keeps working.
2. Frontend pages switch to the new paths screen by screen behind a single client config flag.
3. Legacy tables are frozen (writes disabled by the module, not by dropping) once the canonical flow is the default; retirement/drops require an explicit user request (memory: earlier drop broke the module).

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|------|-----------|--------------------------------------|
| Two assessment stores side by side (legacy `public` tables and `santulan`) | The contract forbids reshaping the old tables into the 28, and the shipped flow must not break during the build | Migrating in place would alter frozen feature-002/004 data and violate FR-001 |
| `accounts` → `participants`/`admin_users` bridge | Keeps working sign-in while the managed OTP provider is external | Rebuilding auth first would block every later phase |
| Two RLS mechanisms (legacy `app.bypass_rls`/`app.current_school_id`; canonical `app.actor_scope`…) | Different schemas, different owners | Reusing the legacy `BYPASSRLS` platform role for canonical access would break BUILD 09 |
| New streaming-XLSX dependency (`exceljs`) | 2.22 M rows cannot be built in memory with SheetJS | Hand-writing OOXML is larger and riskier than one MIT-licensed dependency |
| Migrations authored from prose (SQL packages absent) | Only the `.docx` contracts exist on disk | Waiting for the packages blocks the whole feature; each object is traceable to a contract section instead |
