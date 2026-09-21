# Santulan

A capability / self-awareness assessment platform for adolescents and emerging adults (ages 13–25). The delivered product follows the
**SanTulan 2.0 build contracts** (`docs/Santulan 2.0/`, BUILD 00–09): a Node.js API on **MongoDB**, a React frontend, and a
question-upload workflow that replaces the old spreadsheet import.

- **Docs and contracts**: every feature is traced from `specs/` and `docs/`, not from conversation. See [Specs and references](#specs-and-references).
- **Governing rule**: *the data model strictly per the contracts — no invented extras.* Anything the documents do not state is marked
  `ASSUMED` and listed in the change record for the owner to confirm.
- **Launch status: NO-GO.** Nothing here changes that. See `specs/006-mongodb-question-upload/evidence/launch-gates.md`.

---

## What is this project

1. **A MongoDB data model** — 27 canonical collections, 9 read-only research views and 50 named indexes, created by forward-only data
   migrations (`backend/db/migrations/`). There is no SQL anywhere in the platform.
2. **Question upload** — a Super Admin uploads a question workbook (`docs/Santulan_Sample_Questions.xlsx` shows the format): 13 question
   fields plus `option_1…option_N` (2 to 20 options per question). The upload is validated as a whole, stored as a **draft** set, then
   **frozen** (permanent, content-hashed) and **opened** for an age group. Nothing is seeded.
3. **A backend API** at `/api/v1` (`backend/src/modules/santulan/`) that reaches the database only through a scoped data-access layer,
   and never accepts scores, versions, Santulan IDs or participant IDs from a client.
4. **Scoring and reports** following the Scoring and Report Generation master: exact completeness statuses, no imputation, research-only
   evidence (`S1`) by default, four audited release switches, and reports that fail closed when approved wording is missing.
5. **A frontend** (React 19 / CRA) for participants and for the administrator.

---

## Repository layout

```text
backend/
├── db/
│   ├── schema/                      # collection, view, index and role definitions (the data model as code)
│   └── migrations/                  # 001–004, applied once each, hash-checked
├── scripts/                         # mongo-local, db-migrate, db-scratch, db-verify, seed-reference, wording-load,
│                                    # questions-convert-catalog, pipeline-once, export-synthetic, backup-restore-drill, release-manifest
├── seeders/santulan/                # dev seeder + reference framework map
├── config/                          # example governed configuration (quality policy, evidence config, ranking, messages)
├── src/
│   ├── app.js / server.js           # Express app; start-up guard; gated workers
│   ├── config/index.js              # environment-driven configuration
│   ├── routes/v1/santulan.routes.js # the API router
│   ├── jobs/workers/                # inactivity, pipeline (quality + scoring), report, export workers
│   └── modules/santulan/
│       ├── store/                   # the ONLY code that imports the MongoDB driver (scoped access layer, repositories)
│       ├── domain/                  # pure rules: registration, consent, attempts, scoring, quality, reports, growth, pathways, admin, export
│       └── …                        # registration, consent, identity, questionsets, delivery, scoring, quality, reporting, growth,
│                                    # pathways, admin, research
└── tests/santulan/                  # store, domain, contract, integration, unit, helpers, evidence

frontend/src/                        # components, pages (public / participant / admin), services
docs/                                # source contracts (BUILD 00–09), sample question workbook, UI screen samples
specs/                               # feature specs; 006-mongodb-question-upload is the current one
.specify/memory/constitution.md      # governing rules (v3.0.0)
```

---

## Tech stack

| Layer | Choice |
|---|---|
| Backend | Node.js, Express 4, the official `mongodb` driver (no ODM), `zod`, `jsonwebtoken`, `bcryptjs`, `multer`, `xlsx`, `exceljs` |
| Database | MongoDB 8.0 replica set (transactions), `$jsonSchema` validators, partial unique indexes, read-only views, least-privilege role |
| Frontend | React 19, `react-router-dom` 6, `lucide-react`, CSS Modules; RTL + `jest-axe`, `wcag-contrast` |
| Testing | Jest 29 + supertest (`--runInBand`, `--experimental-vm-modules`) against a **scratch** database |

MongoDB runs **locally, not in Docker**: `backend/scripts/mongo-local.js` starts a dedicated instance on port **27018** (never the
`MongoDB` Windows service on 27017, which may hold other databases).

---

## Running locally

### 1. Database

```bash
cd backend
npm install
npm run db:local:init -- --write-env   # dedicated instance + replica set + users; writes backend/.env (git-ignored)
npm run db:local:status                # port, replica set, primary, authorization
npm run db:migrate                     # data-model migrations (001–004) on the `santulan` database
npm run db:seed:reference              # 216 development actions (inactive) + 72 reflection prompts (draft)
npm run db:seed:dev                    # dev-only accounts (below)
npm run db:verify                      # structural and integrity checks (exit non-zero on any failure)
```

### Dev login credentials

The dev seeder creates three synthetic login accounts (development only; no personal data; it refuses production). Login is
`POST /api/v1/auth/login` with `{ "subject": "<login id>", "password": "<password>" }`.

| Account | Login id (`subject`) | Password |
|---|---|---|
| SUPER_ADMIN | `dev-super-admin` | `Dev-Admin-Pass-7` |
| Open participant — adolescent (age 15) | `dev-participant-adolescent` | `Dev-Adolescent-7` |
| Open participant — emerging adult (age 21) | `dev-participant-emerging-adult` | `Dev-Emerging-7` |

Participants may also sign in with their printed Santulan ID (`STN-…`). `npm run db:seed:dev -- --reset` restores these passwords.
The alternative `participants.seeder.js` uses distinct subjects (`ps-dev-…`).

### 2. API and workers

```bash
cd backend
npm run dev                              # http://localhost:8000  (GET /api/v1/health reports the store)
npm run pipeline:once                    # run the scoring pipeline and the report worker once
```

Workers are off unless switched on: `SESSION_INACTIVITY_MINUTES`, `SCORING_PIPELINE=on`, `REPORT_WORKER=on`, `EXPORT_WORKER=on`.
The API refuses to start unless the store is ready (runtime credential, replica set, expected data-model version).

### 3. Question sets, wording and switches (Super Admin)

1. Sign in as the Super Admin → **Question sets** → download the template, fill it, upload (choose the age group). Every problem in
   the file is reported at once with row and column; a failing file stores nothing.
2. Review the draft, **Freeze** it, then **Open** it for the age group (a reason is required). One set can be open per age group.
3. Reports for a domain scored at S2 or above need **approved wording**. Load it with
   `node scripts/wording-load.js <file.json> --approve`; until it exists the report ends "failed, retryable" and participants see nothing partial.
4. **Release switches** (`pilotS2`, `advancedEvidence`, `developmentRelease`, `pathwayRelease`) are all OFF by default and changed only
   on the *Release switches* page, with a reason, audited.

To convert the frozen v3.1 catalog (175 + 171 questions) to the new workbook format: `npm run questions:convert`
(writes `backend/exports/converted/`).

### 4. Tests

```bash
cd backend
npm run test:santulan                          # everything, against the scratch database `santulan_qual`
npm run test:santulan -- tests/santulan/store  # only files matching the filter
```

`npm run db:scratch` rebuilds the scratch database (its name must contain `test`, `qual` or `scratch`).

### 5. Frontend

```bash
cd frontend
npm install
npm start                       # CRA dev server (http://localhost:3000)
npm test                        # RTL tests incl. jest-axe
npm run check:contrast          # WCAG contrast pair manifest
npm run build
```

---

## API surface

All routes mount under `/api/v1` (`backend/src/routes/v1/santulan.routes.js`).

| Group | Routes |
|---|---|
| Health | `GET /health` |
| Auth | `POST /auth/request-otp` · `/auth/verify-otp` · `/auth/login` · `/auth/set-password` · `POST /admin/participants/:id/credential-reset` |
| Registration | `POST /registration/route` · `/registrations/open` · `/registrations/institutional` · `/participants/age-declaration` · `GET /registration/state` |
| Consent | `GET /consents/requirements` · `/consents/gate` · `POST /consents` · `/consents/:id/{grant,verify,withdraw}` |
| Delivery | `POST /attempts` · `GET /attempts/:id` · `/attempts/:id/{items,responses}` · `POST /attempts/:id/{sessions/resume,responses,pause,submit}` |
| Reports | `GET /reports/:id` · `GET /growth-plans/:id` · `POST /growth-plans/:id/{priorities,goals,reviews}` |
| Question sets | `GET/POST /admin/question-sets` · `GET /admin/question-sets/template` · `GET /admin/question-sets/:id` · `POST …/:id/{freeze,open,close}` |
| Release switches | `GET /admin/release-flags` · `POST /admin/release-flags/:flag` |
| Admin | `GET/POST /admin/assessment-control` · `/admin/institutions` (+ `PATCH /:id`) · `/admin/cohorts` (+ `PATCH /:id`) · `GET /admin/participants` · `POST /admin/participants/:id/status` · `GET /admin/monitoring/summary` · `GET/PATCH /admin/quality-flags` · `GET /admin/audit-logs` · `GET /admin/submissions` · `POST /cohorts/import` · `GET /admin/credentials/export/:importId` |
| Research export | `POST /research-exports` · `GET /research-exports` · `GET /research-exports/:id` · `GET /research-exports/:id/download` |
| Internal | `POST /internal/attempts/:id/{quality,score,safeguarding,report,pathways}` · `GET /internal/attempts/:id/quality-flags` · `POST /internal/reports/:id/retry` |

There is **no participant score endpoint**: the chart is read from the released report (`GET /reports/:id`, section `PROFILE`).
Authentication middleware: `requireParticipantToken`, `requireActiveSuperAdmin` (re-checks the database every request),
`requireInternal` (constant-time compare of `x-internal-api-key`).

---

## Non-negotiables

- **No personal data in the data model** beyond what the contracts name; no name, contact detail, date of birth or guardian data.
- **Scoped access, never removal**: every read and write goes through the scoped access layer; the runtime credential can never
  remove data or change the schema; audit rows, answers' content, scores and report snapshots are append-only.
- **Fail closed**: sets start `DRAFT`/`CLOSED`, evidence starts `S1`, all release switches OFF, reports never show a partial result.
- **No client-supplied** scores, versions, Santulan IDs, participant IDs or database context.
- **Nothing beyond the contracts** without a change record and owner approval (`specs/006-mongodb-question-upload/evidence/change-record-006.md`).

---

## Specs and references

| Reference | Path |
|---|---|
| Current feature | `specs/006-mongodb-question-upload/` (spec, plan, tasks, research, data-model, quickstart, contracts, evidence) |
| Scoring and report contract | `specs/006-mongodb-question-upload/contracts/scoring-and-report.md` |
| API delta / database contract / upload format | `specs/006-mongodb-question-upload/contracts/` |
| Launch gates (NO-GO) | `specs/006-mongodb-question-upload/evidence/launch-gates.md` |
| Behaviour carried from before | `specs/005-v3-1-canonical-alignment/` (storage parts superseded) |
| Frontend contracts | `specs/003-frontend-visual-design/contracts/` |
| Governing rules | `.specify/memory/constitution.md` (v3.0.0) |
| Source contracts | `docs/Santulan 2.0/` (BUILD 00–09), `docs/Santulan_Scoring_and_Report_Generation_Layman_Master_Audit_ON_v1_0.docx` |
