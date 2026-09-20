# Santulan

A capability / self-awareness assessment platform for adolescents and emerging adults
(ages 13–25). Santulan aligns the delivered product to the **SanTulan 2.0 build contracts**
(`docs/Santulan 2.0/`, BUILD 00–09) and ships a **PostgreSQL canonical schema** plus a
backend API and a React frontend that are being rebuilt against the contracts.

- **Docs & contracts**: every feature is traced from the `specs/` and `docs/`
  folders, not from conversation. See [Specs & references](#specs--references).
- **Governing rule**: *the database strictly per the contracts — no invented extras.*
  Every object in the canonical schema is traceable to a contract section.

---

## Table of contents

- [What is this project](#what-is-this-project)
- [Repository layout](#repository-layout)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Current implementation status](#current-implementation-status)
- [Running locally](#running-locally)
- [API surface](#api-surface)
- [Completing the project](#completing-the-project-plan)
- [Specs & references](#specs--references)

---

## What is this project

1. **A canonical database** — exactly **28 tables** in PostgreSQL schema `santulan`,
   built through forward-only migrations authored from the BUILD 01 contract text
   (tables, constraints, functions, triggers, indexes, RLS, seeds).
2. **A catalog pipeline** — the v3.1 item bank (175 + 171 items) is loaded from the
   BUILD 02 workbook into normalized CSVs and reconciled idempotently into the schema.
3. **A backend API** at `/api/v1` (`backend/src/modules/santulan/`) that talks only to
   the canonical schema through a trusted per-transaction context (`SET LOCAL` GUCs),
   calls the contract's `SECURITY DEFINER` procedures for the write paths, and never
   accepts scores, versions, Santulan IDs or participant IDs from the client.
4. **A frontend** (React 19 / CRA) that is being rebuilt to the Santulan design language
   and screen samples in `docs/Santulan 2.0/UI screen Samples/`.

The original feature-002/004 assessment tables and backend were **removed on request**
(backup: `backend/backups/santulandb-before-schema-removal-2026-09-20.dump`). There is no
cutover: the canonical module is the application.

---

## Repository layout

```text
backend/
├── migrations/                     # 008…022 forward-only SQL migrations (schema + seeds)
├── seeders/santulan/               # normalized CSVs + dev seeder
├── scripts/                        # catalog, reconcile, freeze, grants, scratch-db, dev-identity
├── src/
│   ├── app.js                      # Express app, mounts /api/v1 (canonical router)
│   ├── server.js                   # boot; inactivity + scoring pipeline workers (gated)
│   ├── config/index.js             # env-driven configuration
│   ├── shared/                     # errors/codes, middleware (auth), validate
│   ├── routes/v1/santulan.routes.js# canonical API router
│   ├── jobs/workers/               # inactivityWorker, pipelineWorker
│   └── modules/santulan/           # account, catalog, consent, context, delivery,
│                                   # identity, quality, registration, scoring, security, shared
└── tests/
    ├── santulan/                   # database, contract, integration, unit, helpers, evidence
    └── (legacy suites are dead — their tables were removed)

frontend/
└── src/                            # CRA/React 19; components, pages (public/participant/admin), services

docs/                               # source contracts (BUILD 00–09 .docx/.xlsx/.json) + UI screen samples

specs/
├── 001-assessment-service/         # legacy feature
├── 002-capability-assessment/      # legacy feature
├── 003-frontend-visual-design/     # design-system + screen-inventory + dashboards contracts
├── 004-platform-sql-database/      # legacy platform feature
└── 005-v3-1-canonical-alignment/   # ACTIVE feature: spec, plan, tasks, contracts, quickstart

.specify/memory/                    # constitution + working memory (rules, decisions)
```

---

## Tech stack

| Layer | Choice |
|---|---|
| Backend | Node.js, Express 4, raw `pg` (no ORM), `zod`, `jsonwebtoken`, `bcryptjs`, `multer`, `xlsx` |
| Database | PostgreSQL 16 (contract min 15+), `pgcrypto`, generated columns, partial unique indexes, RLS, `SECURITY DEFINER` functions |
| Frontend | React 19, `react-router-dom` 6, `lucide-react`, CSS Modules; RTL + `jest-axe`, `wcag-contrast` |
| Testing | Jest 29 + supertest (`--runInBand`); DB tests run in `BEGIN…ROLLBACK` with role switching |

---

## Architecture

### Canonical schema (`santulan`) — 28 tables

`institutions`, `cohorts`, `participants`, `participant_cohort_history`, `consents`,
`response_scales`, `assessment_versions`, `items`, `assessment_attempts`, `responses`,
`response_events`, `quality_flags`, `score_results`, `interpretation_rules`,
`development_actions`, `reflection_prompts`, `reports`, `report_sections`, `growth_plans`,
`growth_priorities`, `growth_goals`, `growth_actions`, `growth_reviews`, `pathway_decisions`,
`pathway_reviews`, `research_exports`, `admin_users`, `audit_logs`.

Non-negotiables enforced in code and tests:

- **No PII columns.** No names, emails, phones, DOB, guardian data in the 28 tables.
- **RLS is `ENABLE`d and `FORCE`d** on the participant/tenant-derived tables; the runtime
  role `app_runtime` is `NOBYPASSRLS` and owns nothing.
- **No `UPDATE`/`DELETE`** on `responses`, `audit_logs`, `score_results`, report snapshots.
- **Fail-closed defaults**: versions `DRAFT`/`CLOSED`, evidence state `S1`, development
  actions inactive, report sections unreleased until `REPORT_READY`.
- **Forward-only migrations**: a fix is a new numbered file; applied files are never edited.
- **Client never supplies** scores, version ids, Santulan IDs, or database context.
- **Principle III**: nothing beyond the contracts without a change record + approval.

### Migration map

`008` roles/extensions/types · `009` identity/org · `010` content · `011` delivery ·
`012` quality/scoring/reporting · `013` growth/pathways · `014` research/audit ·
`015` constraints/triggers/functions · `016` indexes · `017` RLS · `018` seeds (US1) ·
`019` BUILD 03 controls (registration) · `020` BUILD 04 controls (consent gate) ·
`021` BUILD 05 controls (delivery) · `022` BUILD 05 submit timestamp ·
`023` BUILD 06 controls (quality/scoring, **pending**) ·
`024` BUILD 07 controls (reporting/growth/pathways, **pending**) ·
`025` BUILD 08 controls (admin/research, **pending**).

### Identity (approved decision D-17)

The legacy `accounts` table was removed with the old schema. Sign-in uses an
`IdentityProvider` adapter; the dev implementation keeps OTPs in memory and bcrypt
credentials in a **dev-only store outside the canonical schema** (`dev_identity`),
and refuses production. OPEN participants reference a provider + subject only.

---

## Current implementation status

Tracking lives in `specs/005-v3-1-canonical-alignment/tasks.md` (173 tasks). As of
`2026-09-20` the working tree marks **76 / 173 tasks done = ~44 %**.

| Phase / Story | Status | Notes |
|---|---|---|
| P1 Setup | 4 / 9 | harness + scratch-db script done; fixtures/tokens/evidence reporter remain |
| P2 Foundational | 22 / 23 | 28 tables, roles, RLS, runtime primitives verified; T032 foundation test remains |
| P3 US1 Catalog import | 14 / 14 | CSVs, seeds, reconcile/apply/rollback, freeze — **done** |
| P4 US2 Registration | 10 / 11 | routing, Santulan ID, idempotency, service, routes; T049 DB test remains |
| P5 US3 Consent gate | 9 / 9 | state machine + gate + protocol registry + withdrawal hook — **done** |
| P6 US4 Identity / roster | 5 / 11 | OTP + provider adapters + set-password done; roster import + credentials remain |
| P7 US5 Delivery | 12 / 12 | attempts, sessions, responses, submit, control plane — **done** |
| P8 US6 Quality + scoring | 0 / 11 | service scaffolding exists on disk; migration 023 + pipeline wiring remain |
| P9 US7 Reports / growth / pathways | 0 / 13 | not started |
| P10 US10 Frontend | 0 / 22 | not started |
| P11 US8 Admin / research export | 0 / 20 | not started |
| P12 US9 Security / QA / launch | 0 / 11 | not started |
| P13 Polish | 0 / 7 | not started |

**Effective milestone state**

- **P1 MVP (US1 + US2 + US3)** — ~97 % complete; independently demonstrable.
- **US5 assessment delivery** — complete (submit → `SUBMITTED`).
- **Not yet built**: scoring/report pipeline (US6–US7), admin/research (US8),
  security/QA/launch evidence (US9), the rebuilt frontend (US10), polish.

---

## Running locally

### 1. Database

```bash
cd backend
docker compose up -d            # postgres:16 on localhost:5433
cp .env.example .env            # then edit DATABASE_URL / RUNTIME_DATABASE_URL if needed
```

### 2. Migrations + roles

```bash
cd backend
npm run db:migrate              # runs scripts/migrate.js then santulan-grant-roles.js
npm run db:seed:dev             # dev-only seeder: SUPER_ADMIN + one OPEN participant per track
```

### 3. API

```bash
cd backend
npm run dev                     # http://localhost:8000 (health check: GET /health)
```

Workers (gated): inactivity worker starts only when `SESSION_INACTIVITY_MINUTES` is set;
the scoring pipeline starts only when `SCORING_PIPELINE=on`.

### 4. Catalog pipeline (US1)

```bash
cd backend
npm run catalog:generate        # BUILD 02 workbook → normalized CSVs + MANIFEST (deterministic)
npm run catalog:verify          # offline verification incl. v3_0 cross-check
npm run catalog:reconcile       # reconcile | apply | rollback-from-receipt (CLI)
```

### 5. Tests

```bash
cd backend
npm test                        # legacy suites (dead tables) — superseded by:
npm run test:santulan           # canonical suites (database/contract/integration/unit) against a test|qual|scratch DB
```

The scratch database is created by `node scripts/santulan-scratch-db.js` (refuses
databases that do not match `test|qual|scratch`).

### 6. Frontend

```bash
cd frontend
npm install
npm start                       # CRA dev server (default http://localhost:3000)
npm test                        # RTL tests incl. jest-axe
npm run check:contrast          # WCAG contrast pair manifest (design-system.md §5)
```

---

## API surface

All canonical routes mount under `/api/v1` (see `backend/src/routes/v1/santulan.routes.js`):

| Group | Routes |
|---|---|
| Auth | `POST /auth/request-otp` · `POST /auth/verify-otp` · `POST /auth/login` · `POST /auth/set-password` · `POST /admin/participants/:id/credential-reset` |
| Registration | `POST /registration/route` · `POST /registrations/open` · `POST /registrations/institutional` · `POST /participants/age-declaration` · `GET /registration/state` |
| Consent | `GET /consents/requirements` · `GET /consents/gate` · `POST /consents` · `POST /consents/:id/{grant,verify,withdraw}` |
| Delivery | `POST /attempts` · `GET /attempts/:id` · `POST /attempts/:id/sessions/resume` · `POST /attempts/:id/responses` · `GET /attempts/:id/items` · `GET /attempts/:id/responses` · `POST /attempts/:id/pause` · `POST /attempts/:id/submit` |
| Internal | `POST /internal/attempts/:id/{quality,score,safeguarding}` · `GET /internal/attempts/:id/quality-flags` · `GET /attempts/:id/scores` |

Mandatory auth middleware: `requireParticipantToken`, `requireActiveSuperAdmin`,
`requireInternal` (constant-time compare of `x-internal-api-key` with `INTERNAL_API_KEY`).

---

## Completing the project (plan)

The end goal: **all 173 tasks done with a green evidence register and launch gates
closed.** The full, dependency-ordered task list is `specs/005-v3-1-canonical-alignment/tasks.md`;
the governing spec is `spec.md` and the API/database contracts are in `contracts/`.

### Work split

- **Frontend (US10 + admin UI, US8 frontend tasks)** is owned by **Claude**, which reads
  the reference screen images (`docs/Santulan 2.0/UI screen Samples/*.png`, `Final.jpeg`).
- **Backend (everything else)** is owned by opencode and built against the same
  `contracts/api.md` — that file is the single handoff contract between the two tracks.

### Remaining phases (dependency order)

1. **Close out Phase 1–2 leftovers** — T001/T002 fixtures & npm scripts, T006–T008
   (fixtures, token helper, evidence reporter), T032 (foundation contract test),
   T049 (registration DB test).
2. **US6 Quality + scoring** — migration `023` (BUILD 06 controls), evidence config,
   quality runners, Q06/Q09, `score_attempt`, worker wiring, routes; then
3. **US7 Reports / growth / pathways** — migration `024`, report renderer (T11/T12
   neutral copy), report/retry workers, growth plans, P1–P5 pathways and the
   unconditional P5 hook; pipeline becomes end-to-end **submit → quality → score → report**.
4. **US4 roster + credentials (backend)** — roster parser/validator, all-or-nothing
   commit, one-time credential export, credential reset.
5. **US10 Frontend** — design tokens, component library, screens. Starts with the
   design-system tasks (blocked on nothing) then screens in dependency order:
   public/registration (US2–US4) → dashboard/player (US5) → generating/report (US6–US7);
   the report screens are wired once US6/US7 land. `santulanApi.js` (T125) and the
   `REACT_APP_API_MODE=canonical` cutover flag are frontend-owned.
6. **US8 Admin + research export** — migration `025`, control plane, institution/cohort/
   participant admin, monitoring, catalog admin, audit log, research exports
   (`exceljs`, approval D-12), synthetic export run (10,000 × 222).
7. **US9 Security / QA / launch** — claims scanner, RLS + abuse + platform suites,
   AT/RC traceability, throttle middleware, backup-restore drill, release manifest,
   `launch-gates.md` (G1–G10, E1–E11). Launch stays **NO-GO** until gates that need
   staging or governance evidence are closed by their owners.
8. **Polish** — README/docs refresh, FLOWCHART reroute, quickstart §1–§11 execution,
   constitution review sweep, SECURITY.md, and the obsolete-cutover decision (T172).

### Priority guidance

- **P1 MVP is done** — a first product review can happen now (quickstart §1–4).
- **P2 pipeline (US5 → US6 → US7) is the next shippable milestone** and unblocks the
  report screens.
- **P3 (US8, US9)** then admin UI and launch qualification.

### Definition of done

- All checkboxes in `tasks.md` closed and each test title mapped to its BUILD
  matrix ID (e.g. `T03-004`, `B05-037`, `AT-13`, `SEC-11`).
- `backend/tests/santulan/evidence/register.json` contains real `PASS` (or documented
  `NOT_EXECUTED`) entries for every ID.
- `npm run test:santulan`, `npm run check:contrast`, and the frontend suite are green.
- No gate in `launch-gates.md` is changed from `NOT_EXECUTED` without real evidence.

---

## Specs & references

| Reference | Path |
|---|---|
| Active feature | `specs/005-v3-1-canonical-alignment/` (spec, plan, tasks, research, data-model, quickstart, contracts) |
| API contract | `specs/005-v3-1-canonical-alignment/contracts/api.md` |
| Database contract | `specs/005-v3-1-canonical-alignment/contracts/database-contract.md` |
| Catalog import | `specs/005-v3-1-canonical-alignment/contracts/catalog-import.md` |
| Frontend contracts | `specs/003-frontend-visual-design/contracts/` (design-system, screen-inventory, dashboards) |
| Governing rules | `.specify/memory/constitution.md` |
| Source contracts | `docs/Santulan 2.0/` (BUILD 00–09) |
| UI screen samples | `docs/Santulan 2.0/UI screen Samples/` |