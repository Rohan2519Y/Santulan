# Implementation Plan: Capability Assessment

**Branch**: `002-capability-assessment` | **Date**: 2026-09-17 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-capability-assessment/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command; its definition describes the execution workflow.

## Summary

Deliver the capability assessment as a new `assessment` module in the existing Node.js modular monolith. Participants (with valid consent on file) start a frozen instrument — one of the two pilot item pools (Adolescent 175 items / Emerging Adult 171 items, imported from the TECH_READY xlsx files) — answer eligible items on a frozen 1–5 Likert scale across 7 capability domains with pause/resume across up to 4 sessions, and submit. The server scores deterministically per domain (mean 1.00–5.00, completeness, score status S0–S5/SH), assembles a versioned, snapshotted report with MP17 staged-release gating, and participants/admins view results with full immutability, evidence-gating, consent and safeguarding controls. Replaces the earlier MCQ-based `001-assessment-service` model.

## Technical Context

**Language/Version**: Node.js 20 LTS (JavaScript). Backend scaffold (`backend/src/modules/*`, `src/routes/v1`, `src/shared` middleware, `src/events`, `src/jobs`) already targets a Node/JS modular monolith; frontend is React 19 (Create React App scaffold in `frontend/`).

**Primary Dependencies**: Express 4 (HTTP), `pg` (node-postgres) as the sole data-access layer — no ORM (research §9; replaces the earlier Prisma decision), multer + SheetJS `xlsx` v0.20.3 from the SheetJS CDN (item-pool import), `cors` (browser origin allow-list for the frontend dev server, research §8), `csv`/JSON parsing not required client-side. Resolved in [research.md](research.md).

**Storage**: PostgreSQL — `responses`/`score_results`/`reports` immutable and versioned; hand-written SQL migrations under `backend/migrations/` applied by `backend/scripts/migrate.js` (research §9), plus `backend/seeders/`. Local dev connects to a plain local PostgreSQL install (no container required — `docker-compose.yml` remains available as an alternative).

**Testing**: Backend — Jest + Supertest (unit + integration + contract), run directly against a local Postgres database. Frontend — jest via `react-scripts test`. Validation tests named after the ERD `13_Validation_Tests_Master` (SIE VT01–VT10) where applicable.

**Target Platform**: PostgreSQL reachable from the Node process — a local PostgreSQL install for day-to-day dev (current default), or Docker via `docker-compose` where preferred/available.

**Project Type**: Web service (modular monolith — assessment capability as one module) + React frontend screens for participant and admin.

**Performance Goals**: 7 domain results within 10 seconds of submission for 100% of valid submissions (SC-001); report assembly deterministic and repeatable (SC-003); item-pool import validated and live without redeploy (SC-004).

**Constraints**: Immutable raw responses with exactly one current version per item (BF-01); server-side scoring only, client-provided scores rejected (FR-008); evidence-gated interpretation, no percentiles/diagnoses/reliable-change claims (FR-010, SC-005); minor consent gate before any active attempt (FR-012, SC-006); Q09 safeguarding always routed to human workflow, never scored (FR-014, SC-007); ≤ 4 sessions per attempt, one active attempt per participant (FR-005/006); failed report generation leaves attempt scored and retryable (FR-011); prescriptive report layers gated behind `is_released_to_participant` (FR-018).

**Scale/Scope**: Pilot scale — 10k participants, ~59 eligible items per participant, two frozen assessment versions, 7 domains, 72 subdomains. Prescriptive layers (priorities/actions/growth plan/pathways) are built and stored but rendered only behind the release flag (MP17).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution file (`.specify/memory/constitution.md`) is the unfilled placeholder template — no concrete principles, constraints, or governance rules have been ratified by the project. **No gates apply.** The plan therefore applies the default conventions evident in the repo: modular capability organization (`backend/src/modules/*`), backend/frontend split, existing shared middleware, and test-first delivery with the ERD acceptance-test inventory (`15_Acceptance_Tests`) as the source of verification scenarios. No violations requiring Complexity Tracking.

**Post-design re-check (after Phase 1)**: No new constraints surfaced in data-model.md, contracts, or quickstart.md; the design stays within the conventions above. Gate remains PASS / nothing to track.

## Project Structure

### Documentation (this feature)

```text
specs/002-capability-assessment/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── api.md           # HTTP API contract
│   └── item-pool-schema.md  # xlsx item-pool import contract
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
backend/
├── package.json                 # Express, pg, multer, xlsx deps + scripts (no ORM - research §9)
├── migrations/                  # Numbered plain-SQL migration files (data model from data-model.md)
├── scripts/
│   ├── migrate.js               # Applies migrations/*.sql, tracked in a `_migrations` table
│   └── grant-runtime-role.js    # Grants the non-superuser app_runtime role (T053) on current tables
├── seeders/
│   ├── assessment.seeder.js     # Seed response scale, admin + participant, interpretation rules
│   └── seeds/item-pool-adolescent/  # Converted TECH_READY pool → JSON fixture (or import via admin)
├── src/
│   ├── modules/
│   │   └── assessment/
│   │       ├── controllers/     # HTTP handlers: consent/profile, attempts, responses, submit, scores, report, admin
│   │       ├── services/        # Eligibility, response-versioning, scoring, quality, report, import
│   │       ├── schemas/         # Request/response validation (zod or Joi, matching 001 scaffold choice)
│   │       ├── engine/          # Evidence-gated interpretation + report assembly logic
│   │       └── index.js
│   ├── routes/v1/
│   │   └── assessment.routes.js # Mount under /api/v1/assessments (+ /api/v1/admin/assessments)
│   ├── shared/                  # Existing auth guards, error helpers, RLS helper (reused/extended)
│   └── app.js                   # Wire module routes + middleware (currently empty skeleton)
├── tests/
│   ├── unit/assessment/
│   ├── integration/assessment/
│   └── contract/assessment/

frontend/
├── src/
│   ├── pages/
│   │   ├── participant/
│   │   │   ├── AssessmentPage.jsx      # Take/resume the assessment (7 sections, 1–5 scale)
│   │   │   ├── ResultsPage.jsx         # Own domain scores + released report layers
│   │   ├── admin/
│   │   │   ├── ImportPage.jsx          # Upload item-pool xlsx, control participation
│   │   │   ├── ResultsAdminPage.jsx    # Submissions, scores, quality flags
│   │   └── LoginPage.jsx               # Reuse existing auth flow
│   ├── services/
│   │   └── assessmentApi.js            # API client for assessment endpoints
│   └── tests/
```

**Structure Decision**: The backend is a modular monolith — each capability (auth, users, orders, payments, notifications) is a self-contained module under `src/modules/`. The assessment capability follows the same pattern as a new `assessment` module with its own controllers/services/schemas/engine, routes mounted under `routes/v1`, and shared guards reused from `src/shared`. The React frontend gains participant and admin screens that call those endpoints. This keeps the capability independently deployable and testable (spec assumption) while matching repo conventions; the school/college and research-export tooling from the ERD is intentionally out of scope for this feature.

## Complexity Tracking

> No Constitution Check violations exist — this section is intentionally left empty.