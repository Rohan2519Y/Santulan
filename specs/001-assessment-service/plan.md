# Implementation Plan: Assessment Service

**Branch**: `001-assessment-service` | **Date**: 2026-09-16 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-assessment-service/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command; its definition describes the execution workflow.

## Summary

Deliver the assessment capability as a new module in the existing backend modular monolith: admins upload an `mcq_template.csv` (parsed, validated, versioned into an active question set) and students take a single-select multiple-choice assessment from that set, receiving an instant score. Students can view their own history; admins can view all submissions across versions. Two roles — admin and student — enforced via JWT auth reused from the existing auth module.

## Technical Context

**Language/Version**: Node.js 20 LTS (JavaScript). Backend scaffold (`package.json`, `.gitignore` with `node_modules/`, `src/modules/*`, `src/routes/v1/*`, `migrations/`, `seeders/`) already points to a Node/JS setup. Frontend is React 19 (Create React App).

**Primary Dependencies**: Express 4 for HTTP, multer for CSV upload, `csv-parse` for RFC-4180 parsing, `pg` (node-postgres) for the data layer. Resolved in [research.md](research.md).

**Storage**: PostgreSQL 16 — relational model with versioned templates, submissions, results; `migrations/` + `seeders/` folders already exist in the backend scaffold.

**Testing**: Backend — Jest + Supertest (unit + integration + contract). Frontend — jest via `react-scripts test`.

**Target Platform**: Linux container (Docker) + PostgreSQL; local dev via `docker-compose`.

**Project Type**: Web service grouped as a modular monolith (assessment as one module) + React frontend screens for admin and student.

**Performance Goals**: Result available within 3 seconds of submission (SC-002); CSV validation errors surfaced within 10 seconds of upload (SC-006).

**Constraints**: User-facing p95 latency < 200 ms for read/start endpoints; validation errors must include line-level CSV detail; past submissions must never be rewritten by later CSV uploads (FR-008).

**Scale/Scope**: Small-to-medium (classroom/cohort scale, ~10k students, dozens of questions per set). v1 is single-select MCQ only; one active template version at a time.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution file (`.specify/memory/constitution.md`) is an unfilled placeholder template — no concrete principles, constraints, or governance rules have been ratified by the project. **No gates apply.** The plan therefore applies the default conventions evident in the repo: modular capability organization, backend/frontend split, and test-first delivery. No violations requiring Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/001-assessment-service/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── modules/
│   │   └── assessment/             # New assessment module
│   │       ├── controllers/        # HTTP handlers (upload CSV, start, submit, history, admin views)
│   │       ├── services/           # CSV validation/parse, scoring, version lifecycle
│   │       ├── schemas/            # Request/response validation
│   │       └── index.js
│   ├── routes/v1/
│   │   └── assessment.routes.js    # Route mounting under /api/v1/assessments
│   ├── shared/                     # Existing shared auth guards, error helpers (reused)
│   └── app.js                      # Wire module routes + middleware (currently empty skeleton)
├── migrations/
│   ├── 001_init_assessment_service.sql  # Data model from data-model.md
│   └── ...                         # Existing migrations dir (reused)
├── seeders/
│   └── assessment.seeder.js        # Seed default admin + initial CSV-based question set
└── tests/
    ├── unit/assessment/
    ├── integration/assessment/
    └── contract/assessment/

frontend/
├── src/
│   ├── pages/
│   │   ├── student/
│   │   │   ├── AssessmentPage.jsx        # Take the assessment
│   │   │   ├── AssessmentHistoryPage.jsx # Own history + results
│   │   ├── admin/
│   │   │   ├── UploadPage.jsx            # Upload mcq_template.csv
│   │   │   ├── ResultsPage.jsx           # View all submissions + detail
│   │   └── LoginPage.jsx                 # Reuse existing auth flow
│   ├── services/
│   │   └── assessmentApi.js              # API client for assessment endpoints
│   └── tests/
```

**Structure Decision**: The backend is organized as a modular monolith — each capability (auth, users, orders, payments, notifications) is a self-contained module under `src/modules/`. The assessment capability follows the same pattern as a new `assessment` module with its own controllers/services/schemas and routes mounted under `routes/v1`. The React frontend gains student and admin screens that call those endpoints. This keeps the feature independently deployable (spec assumption) while matching repo conventions; no separate project is created.

## Complexity Tracking

> No Constitution Check violations exist — this section is intentionally left empty.