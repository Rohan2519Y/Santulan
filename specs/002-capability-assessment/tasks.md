---

description: "Feature implementation task list for Capability Assessment"
---

# Tasks: Capability Assessment (002)

**Input**: Design documents from `/specs/002-capability-assessment/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: The feature spec mandates "User Scenarios & Testing" (each story lists an Independent Test and Acceptance Scenarios), so each story phase includes contract + integration tests written FIRST (fail before implementation).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Web app**: `backend/src/`, `frontend/src/` (repository root), tests under `backend/tests/` (Jest + Supertest)
- The `backend/` scaffold is currently bare (empty `package.json`, `src/app.js`, `src/server.js`, empty module dirs, empty `docker-compose.yml`, `.env.example`); the `frontend/` is a default Create React App. All files below are to be created or filled.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Initialize `backend/package.json` with dependencies: Express 4 (`express`), `pg` (node-postgres) as the data-access layer (research §9), `multer`, `xlsx` installed from the SheetJS CDN tarball (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`), `dotenv`; scripts: `dev`, `start`, `test` (jest), `db:migrate` (`node scripts/migrate.js`), `db:seed`, `docker:up`
- [X] T002 [P] Configure PostgreSQL 16 dev environment: fill `backend/docker-compose.yml` (single `postgres:16` service, env DATABASE_URL-friendly port/credentials, volume) and `backend/.env.example` with `DATABASE_URL`, `JWT_SECRET`, `APP_PORT=8000`, `APP_ENV`
- [X] T003 [P] Configure the data layer as raw `pg`: `backend/src/shared/db.js` wraps a `pg.Pool` with `query(text, params)` and `withTransaction(fn)` (research §9); DDL is plain numbered SQL under `backend/migrations/` (single source of truth — research §1)
- [X] T004 [P] Configure Jest + Supertest in `backend/package.json`: root-level `test` script and jest config with `testMatch` covering `backend/tests/**/*.test.js`, testEnvironment node, `setupFilesAfterEnv` for project root `backend/tests/setup.js`
- [X] T005 [P] Wire the Express app bootstrap: fill `backend/src/server.js` (listen on `APP_PORT`) and `backend/src/app.js` (express instance, `express.json()`, mount routes dir from `routes/v1`, mounted health `GET /health`, global error middleware from `shared/errors`), and `backend/src/config/index.js` reading `.env` via dotenv

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

> **CRITICAL**: No user story work can begin until this phase is complete

- [X] T006 Create the full assessment data model in `backend/migrations/001_init_capability_assessment.sql` — all 14 entities from `specs/002-capability-assessment/data-model.md` with the constraints quoted verbatim: `ResponseScale` (`scale_points` = 5; `anchor_labels` JSON `{1:'Almost never',2:'Rarely',3:'Sometimes',4:'Often',5:'Almost always'}`; status `DRAFT | FROZEN | RETIRED`; `frozen_at` immutable), `AssessmentVersion` (`version_label` unique; status `DRAFT | FROZEN | RETIRED`; `content_hash` required; `is_active` with "at most one true (partial unique index)"), `Item` (`(item_code, assessment_version_id)` unique; `domain_code` ∈ C1–C7; `keying` `POSITIVE | REVERSE`; `age_band` `13–25 | 13–18 | 18–25`; `context` `General | School | College/Work`; `layer` `CORE | V | SJT | O`; status `ACTIVE | RETIRED`; `item_text` required, ≤ 500 chars; `display_order` required, immutable), `ParticipantProfile` (`user_id` required, unique → User; `santulan_id` required, unique; `participation_route` `OPEN | INSTITUTIONAL`; `age_band` `D1–D4`; `is_minor` bool; `context` `SCHOOL | COLLEGE_WORK | GENERAL`), `Consent` (`consent_type` `ADULT_SELF_CONSENT | PARENT_GUARDIAN_CONSENT | STUDENT_ASSENT`; `status` `PENDING | GRANTED | VERIFIED | WITHDRAWN`; `verified_at` nullable), `AssessmentAttempt` ("State machine (ERD `07_Assessment_Response`)": `CREATED → STARTED → IN_PROGRESS ⇄ PAUSED → SUBMITTED → SCORING → SCORED → REPORT_READY` plus exception states `QUALITY_HOLD | INVALID | EXPIRED`; `session_count` 0–4; `idempotency_key` required, unique; partial unique index "At most one attempt per participant in an active state ... `(participant_profile_id, assessment_version_id) WHERE status IN ('CREATED','STARTED','IN_PROGRESS','PAUSED')` (FR-006)"), `Response` (partial unique index "Partial unique index `(attempt_id, item_id) WHERE is_current = true` → exactly one CURRENT per attempt/item (BF-01)" via partial unique index `(attempt_id, item_id) WHERE is_current = true` named `responses_one_current_per_attempt_item`; `response_value` int 1–5; `response_version` ≥ 1 monotonic; `supersedes_response_id` self FK; `idempotency_key` required, unique; `answered_at` required), `ResponseEvent` (`event_type` `SESSION_START | SESSION_END | PAUSE | RESUME | RESPONSE_SAVED | SUBMIT`; `session_number` 1–4), `QualityFlag` (`flag_code` `Q01…Q09`; `domain_code` nullable ∈ C1–C7; disposition/reviewed fields), `ScoreResult` ("unique per (attempt, domain)" `@@unique([attempt_id, domain_code])`; `raw_score` numeric(3,2) 1.00–5.00; `valid_response_count` ≥ 0; `eligible_item_count` ≥ 1; `completeness_rate` 0–1; `score_status` `S0…S5 | SH`; `scoring_version` required, frozen; `calculated_at` immutable), `InterpretationRule` (`domain_code` ∈ C1–C7; `developmental_band` D1–D4; `evidence_state` `S0–S5, SH`; `locale` default `en`; `rule_code` required; `approved_text_template` required; `version/status` immutable once live), `Report` ("attempt_id required, unique → AssessmentAttempt"; `generation_status` `PENDING | REPORT_READY | FAILED_RETRYABLE`; `retry_count` default 0), `ReportSection` (`section_type` enum T-series; `content_version` required; `content_snapshot` json required; `is_released_to_participant` boolean default false), `ContentImportRecord` (`status` `accepted | rejected`; `error_summary` nullable; `imported_by` → User (admin))
- [X] T007 Write and apply the initial migration `backend/migrations/001_init_capability_assessment.sql` (research §9), review that the DDL includes the two partial unique indexes for `responses_one_current_per_attempt_item` and the one-active-attempt index, then apply via `npm run db:migrate` (`backend/scripts/migrate.js`)
- [X] T008 [P] Implement shared error envelope and error handler in `backend/src/shared/errors/` (HttpError class + Express error middleware writing `{ "error": { "code": "...", "message": "...", "details": {...} } }`, mapping the codes table in `specs/002-capability-assessment/contracts/api.md` including UNAUTHENTICATED 401, FORBIDDEN 403, INVALID_STATE 422, SESSION_LIMIT 409)
- [X] T009 [P] Implement JWT auth + role guards in `backend/src/shared/middleware/` (`authenticate` + `requireRole('participant'|'admin')` reading `Authorization: Bearer <JWT>` with role claims, per research §7 "Reuse the existing platform auth module and users module: JWT Bearer with role claims (participant, admin)")
- [X] T010 [P] Implement RLS helper in `backend/src/shared/utils/rls.js`: `set_config('app.institution_id', ${institutionId}, true)` as the first statement of an interactive transaction via `db.withTransaction` (research §2, `is_local = SET LOCAL`, connection-scoped auto-reset), reading the current GUC with `NULLIF(current_setting('app.institution_id', true), '')` for the scoped query
- [X] T011 [P] Implement request validation helper in `backend/src/shared/utils/validate.js` (schema-driven body/query/params validation; choose one validator — zod or Joi — and use it consistently across the assessment module schemas)
- [X] T012 Create `backend/seeders/assessment.seeder.js` + fixture generator: convert the two TECH_READY pools (`docs/Santulan_Adolescent_Items_TECH_READY.xlsx`, `docs/Santulan_EmergingAdult_Items_TECH_READY.xlsx`) into JSON fixtures under `backend/seeders/seeds/item-pool-adolescent/` and `backend/seeders/seeds/item-pool-emergingadult/` keyed by the `contracts/item-pool-schema.md` columns; the seeder inserts ResponseScale (anchors per research §6), both frozen AssessmentVersions (`santulan-adolescent-pilot-v1.0` / `santulan-emergingadult-pilot-v1.0`, with `content_hash`), all items (`layer` CORE, `status` ACTIVE), one admin User, and stem InterpretationRule rows; mark adolescent version `is_active = true`
- [X] T013 Run `npm run db:seed` and verify: 175 adolescent + 171 emerging-adult ACTIVE items, exactly one `is_active` AssessmentVersion (SC-004 precondition), ResponseScale `scale_points = 5` — record results in the commit message

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Participant Takes the Capability Assessment and Gets Domain Results (Priority: P1) — MVP

**Goal**: A consent-complete participant starts the active frozen assessment version, sees only age-band/context-eligible items across 7 domain sections on the frozen 1–5 scale, answers immutably, submits; server scores deterministically server-side and the participant views 7 domain results (mean 1.00–5.00, completeness, score status) within seconds (FR-001…FR-009, FR-012, FR-016).

**Independent Test**: Admin-imported/seeded active version; consent-complete participant (minor: verified parent consent + assent per FR-012) starts, answers every eligible item, submits, and within seconds sees domain scores for all 7 domains.

### Tests for User Story 1 (write FIRST, ensure they FAIL before implementation)

- [X] T014 [P] [US1] Contract test for profile/consent/attempt/response/submit/scores endpoints in `backend/tests/contract/assessment/participant.test.js` (asserts response envelope, status codes, payload shapes from `contracts/api.md`: POST/GET `/api/v1/assessments/profile`, POST `/api/v1/assessments/consents`, POST `/api/v1/assessments/attempts`, POST `/api/v1/assessments/attempts/:attemptId/responses`, POST `/api/v1/assessments/attempts/:attemptId/submit`, GET `/api/v1/assessments/attempts/:attemptId/scores`)
- [X] T015 [P] [US1] Integration test for the full participant journey in `backend/tests/integration/assessment/participant-flow.test.js`: consent-complete participant → start → answer every eligible item (C7 = 59 per research §6 A07) → submit → atomically locked → `REPORT_READY` → GET scores returns 7 domain means in 1.00–5.00 with completeness + S0–S5 status

### Implementation for User Story 1

- [X] T016 [P] [US1] Implement profile controller + service in `backend/src/modules/assessment/services/profile.service.js` and `controllers/profile.controller.js`: POST/GET `/api/v1/assessments/profile`; derives `age_band` (D1–D4), `is_minor`, `context` (`SCHOOL | COLLEGE_WORK | GENERAL`), `participation_route` from declaration; REQUIRED before consents/attempts (returns `403 PROFILE_NOT_DECLARED`)
- [X] T017 [P] [US1] Implement consent controller + service in `backend/src/modules/assessment/services/consent.service.js` and `controllers/consent.controller.js`: POST `/api/v1/assessments/consents` with `consent_type` from FR-012; enforces the minor gate — "System MUST prevent a minor participant from creating an attempt without a verified parent/guardian consent AND a separate recorded student assent" (`422 CONSENT_INCOMPLETE` with `details.requiredConsents`); `PARENT_GUARDIAN_CONSENT` requires `verificationMethod` and `verified_at` to reach VERIFIED
- [X] T018 [P] [US1] Implement eligibility service in `backend/src/modules/assessment/services/eligibility.service.js`: FR-002 "General/universal items always eligible; variant items only for the matching context" filtered by participant `age_band` + `context`; returns items grouped into the 7 domain sections in provided `display_order`; C7 eligible count = 59 per A07 (research §6)
- [X] T019 [P] [US1] Implement attempt lifecycle service in `backend/src/modules/assessment/services/attempt.service.js`: create against the active FROZEN version (FR-001), snapshot `assessment_version_id` ("snapshot, never re-pointed (FR-008)"), enforce FR-006 one-active-attempt per (participant, version), apply consent gate (FR-012) and participation control (default OPEN; refused when stopped/paused)
- [X] T020 [P] [US1] Implement response service in `backend/src/modules/assessment/services/response.service.js`: POST responses validates item belongs to the attempt's version and `response_value` ∈ frozen 1–5; FR-004/BF-01 immutability — each edit writes a new `Response` row with `response_version` +1, `supersedes_response_id` pointing to the previous CURRENT, `is_current` false on the prior row; `idempotency_key` (UUID, unique) with `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING` (research §4); reject after SUBMITTED with `422 INVALID_STATE` (FR-007)
- [X] T021 [US1] Implement scoring service in `backend/src/modules/assessment/services/scoring.service.js` (depends on T019, T020): FR-008 server-side only — rejects any client-provided score; FR-009 per domain: `raw_score` = mean of valid 1.00–5.00 responses, `valid_response_count`, `eligible_item_count`, `completeness_rate` 0–1, `score_status` `S0…S5 | SH`; `scoring_version` frozen reference; one ScoreResult per (attempt, domain) — "unique per (attempt, domain)"
- [X] T022 [US1] Implement quality-flag service in `backend/src/modules/assessment/services/quality.service.js` (depends on T021): "System MUST detect and record quality flags (Q01–Q09) separately from raw responses" (FR-014), recorded as QualityFlag rows during scoring, never mutating raw responses; "a Q09 safeguarding trigger MUST route to the human workflow and MUST NEVER be converted into a score or ordinary report" — set attempt to `QUALITY_HOLD` and skip scoring for that attempt
- [X] T023 [US1] Implement submit pipeline in `backend/src/modules/assessment/services/submit.service.js` (depends on T021, T022): inside one interactive transaction — FR-007 lock responses (state → `SUBMITTED`), run scoring, create the Report record (FR-011 trajectory `SUBMITTED → SCORING → SCORED → REPORT_READY`), set `generation_status = REPORT_READY`, `attempt.status = REPORT_READY`; deterministic, synchronous, < 10 s (SC-001); any failed generation leaves attempt `SCORED` with `generation_status = FAILED_RETRYABLE` (FR-011)
- [X] T024 [US1] Implement scores view controller + routes: GET `/api/v1/assessments/attempts/:attemptId/scores` scoped to the caller (FR-016) returning the 7 per-domain results from `contracts/api.md` §7, and assemble `backend/src/modules/assessment/controllers/` + `backend/src/routes/v1/assessment.routes.js` mounted in `backend/src/app.js` for the US1 participant endpoints (profile, consents, attempts, responses, submit, scores)
- [X] T025 [US1] Create the assessment API client in `frontend/src/services/assessmentApi.js` (profile, consent, attempted start, save response, submit, scores calls matching `contracts/api.md`; carries JWT Bearer from the existing auth flow)
- [X] T026 [P] [US1] Build participant assessment screen in `frontend/src/pages/participant/AssessmentPage.jsx`: profile+consent gates, then the attempt — 7 domain sections, eligible items in provided order, frozen anchors "1 – Almost never … 5 – Almost always", FR-003 "MUST NOT present any right/wrong framing"
- [X] T027 [US1] Wire assessment entry into the existing login flow: participant landing → profile → consent → AssessmentPage → submit → route to a results placeholder in `frontend/src/App.js` (real Results page is US4)

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently (MVP)

---

## Phase 4: User Story 2 - Participant Pauses and Resumes Across Up to Four Sessions (Priority: P2)

**Goal**: Resume support — an in-progress attempt can be paused/resumed across ≤ 4 sessions with progress preserved and saved answers intact; a 5th session is rejected with the controlled recovery message; starting a second attempt while one is active returns the existing attempt (FR-005, FR-006, FR-007).

**Independent Test**: Start, answer a few items, stop mid-way; then pause/restart several times, confirming progress is preserved and a 5th session start is rejected with the defined recovery message.

### Tests for User Story 2 (write FIRST, ensure they FAIL before implementation)

- [X] T028 [P] [US2] Contract test for session endpoints + states in `backend/tests/contract/assessment/attempt-sessions.test.js`: POST `/api/v1/assessments/attempts/:attemptId/pause`, POST `/api/v1/assessments/attempts/:attemptId/resume`, 409 SESSION_LIMIT on a 5th session, `422 INVALID_STATE` for invalid transitions
- [X] T029 [P] [US2] Integration test for resume flow in `backend/tests/integration/assessment/resume-flow.test.js`: answer → pause → resume preserves prior current responses exactly and only unanswered items remain (acceptance scenario 1), session limit at 4 (scenario 2), second POST `/attempts` returns the existing active attempt not a new one (scenario 3, FR-006)

### Implementation for User Story 2

- [X] T030 [P] [US2] Implement event service in `backend/src/modules/assessment/services/event.service.js`: records ResponseEvent rows — `SESSION_START | SESSION_END | PAUSE | RESUME | RESPONSE_SAVED | SUBMIT` with `session_number` 1–4
- [X] T031 [US2] Extend `backend/src/modules/assessment/services/attempt.service.js` with pause/resume transitions: `IN_PROGRESS ⇄ PAUSED`; resume/start increments `session_count` and rejects a 5th with `409 SESSION_LIMIT` ("`session_count` increment guarded to ≤ 4 (checked in the session-start service)"); a second attempt-create while an active attempt exists returns the existing attempt (FR-006)
- [X] T032 [US2] Implement pause/resume endpoints in `backend/src/modules/assessment/controllers/` + `backend/src/routes/v1/assessment.routes.js`: POST `/api/v1/assessments/attempts/:attemptId/pause` and POST `/api/v1/assessments/attempts/:attemptId/resume` per `contracts/api.md` §5, emitting the matching ResponseEvent
- [X] T033 [US2] Extend the resume view payload (in `attempt.service.js` resume path): return progress ("items completed/total, session N of 4") plus the current saved answers exactly as saved, so the frontend restores state 1:1 (acceptance scenario 1)
- [X] T034 [US2] Extend `frontend/src/pages/participant/AssessmentPage.jsx` + `frontend/src/services/assessmentApi.js` for resume: show completed/total and "session N of 4", a single "Continue Assessment" action, previously saved answers shown unchanged, and the SESSION_LIMIT controlled recovery message on a rejected 5th session start

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Admin Imports a Frozen Item Pool and Controls Participation (Priority: P3)

**Goal**: An authorized admin imports a TECH_READY .xlsx as a new frozen assessment version (validated, content-hash integrity, becomes active; prior attempts untouched) and can pause/stop/reopen participation; every action audit-logged with actor + timestamp (FR-013, FR-015, FR-016).

**Independent Test**: Admin imports a valid item-pool file → it becomes the active version; past submissions still render their original frozen content; pause and reopen recorded as control events in the audit log.

### Tests for User Story 3 (write FIRST, ensure they FAIL before implementation)

- [X] T035 [P] [US3] Contract test for admin endpoints in `backend/tests/contract/assessment/admin.test.js`: POST `/api/v1/admin/assessments/import` (multipart) — valid file, `INVALID_FILE_TYPE` 415, `UPLOAD_TOO_LARGE` 413, `ITEM_POOL_VALIDATION_FAILED` 422 with row/column details; POST `/api/v1/admin/assessments/control`; role guard returns 403 for participant tokens
- [X] T036 [P] [US3] Integration test in `backend/tests/integration/assessment/admin-import.test.js`: import → becomes active `is_active = true`, prior version retired; completed attempt from the older version still renders original frozen items/responses/results; PAUSE/REOPEN appear in the audit log with actor + timestamp

### Implementation for User Story 3

- [X] T037 [P] [US3] Implement import service in `backend/src/modules/assessment/services/import.service.js`: parse buffer via SheetJS per research §3 (`XLSX.read(req.file.buffer, { type: 'buffer' })`, `XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])`, header row 1); per-row validation against `contracts/item-pool-schema.md` (required `item_code`, `assessment_version` ∈ the two pilot labels, `domain_code` ∈ C1–C7, `subdomain_code`/`item_text` present, `keying` POSITIVE/REVERSE, `age_band` `13–25|13–18|18–25`, `context` `General|School|College/Work`, `layer` CORE, status READY only, `display_order` positive integer) with row/column error details; compute `content_hash`; transactional batch upsert keyed on the natural unique `(item_code, assessment_version)`; create FROZEN AssessmentVersion, set `is_active = true`, retire prior active version (FR-013); record ContentImportRecord `accepted|rejected`; a zero-valid-rows or duplicate-frozen-version import rejects with `ITEM_POOL_VALIDATION_FAILED`
- [X] T038 [US3] Implement participation control service in `backend/src/modules/assessment/services/participation.service.js`: actions `PAUSE | STOP | REOPEN` from `contracts/api.md` §11, each recorded in the audit log with actor + timestamp + reason; attempt-creation enforces the current control (FR-013)
- [X] T039 [US3] Implement admin import + control endpoints in `backend/src/modules/assessment/controllers/` + `backend/src/routes/v1/assessment.routes.js` under `/api/v1/admin/assessments`: POST `/import` (multer memory storage, file size limit, content-type check) and POST `/control`; both `requireRole('admin')` (FR-016)
- [X] T040 [P] [US3] Build admin import screen in `frontend/src/pages/admin/ImportPage.jsx`: upload the TECH_READY xlsx, show accepted version + item count or the row/column validation errors; plus participation control (pause/stop/reopen with reason)
- [X] T041 [US3] Wire admin navigation + role gate into `frontend/src/App.js`: admin landing shows ImportPage; participant tokens cannot reach admin routes (FR-016)

**Checkpoint**: All user stories so far remain independently functional; active version swaps never alter prior attempts (FR-015)

---

## Phase 6: User Story 4 - Participant and Admin View Scores and the Report (Priority: P4)

**Goal**: Report-ready participants view domain results + released descriptive layers (nothing release-flag-gated); admins review submissions, scores, and quality flags and set review dispositions; interpretation is versioned and evidence-gated (no percentiles/diagnoses); report content snapshotted per attempt; retry reproduces identical content (FR-010, FR-011, FR-017, FR-018, FR-014, FR-016).

**Independent Test**: Report-ready participant opens the report → 7 domain results + released descriptive layers; admin opens results view → that participant's submission, scores, and quality flags; hold/invalid attempts show the single neutral message to the participant, operational detail to the admin.

### Tests for User Story 4 (write FIRST, ensure they FAIL before implementation)

- [X] T042 [P] [US4] Contract test for report + admin-results endpoints in `backend/tests/contract/assessment/report.test.js`: GET `/api/v1/assessments/reports/:reportId` (404 `REPORT_NOT_READY` until ready; released sections only), POST `/api/v1/assessments/reports/:reportId/retry` (409 when already `REPORT_READY`), GET `/api/v1/admin/assessments/submissions` and `/submissions/:attemptId`, PATCH `/api/v1/admin/assessments/quality-flags/:flagId`
- [X] T043 [P] [US4] Integration test in `backend/tests/integration/assessment/report-flow.test.js`: evidence-gated interpretation (held construct `SH` produces no operational output), release flag flip reflects in participant output without redeploy (FR-018), retry regenerates byte-identical `content_snapshot` from frozen inputs (FR-011), neutral T11/T12 message for a `QUALITY_HOLD`/`INVALID` attempt (SC-007)

### Implementation for User Story 4

- [X] T044 [P] [US4] Implement the interpretation engine in `backend/src/modules/assessment/engine/interpretation.engine.js` (depends on T021): looks up versioned `InterpretationRule` rows by `domain_code` × `developmental_band` × `evidence_state` × `locale` (default `en`); FR-010 — evidence-gated (`S0–S5, SH`); "held constructs MUST NOT generate operational interpretation" and "no output MAY present percentiles, cut scores, diagnoses, or reliable-change claims" (SC-005)
- [X] T045 [US4] Implement report assembly service in `backend/src/modules/assessment/services/report.service.js` (depends on T044): FR-017 — write ReportSection rows with `content_version` (frozen interpretation version) and `content_snapshot` (exact displayed text); descriptive layers (T-series) ship to participants; FR-018/MP17 — prescriptive layers (priorities, actions, growth plan, pathway) stored with `is_released_to_participant = false` and only rendered when the flag is set; single neutral T11/T12 section for `QUALITY_HOLD`/`INVALID`/not-eligible attempts (never the specific trigger)
- [X] T046 [US4] Extend `backend/src/modules/assessment/services/submit.service.js` + `report.service.js` so submit runs the full report assembly and sets `REPORT_READY`; add the retry path — `generation_status = FAILED_RETRYABLE` leaves attempt `SCORED`, a retry regenerates identical content from the frozen attempt + versions (FR-011, SC-003)
- [X] T047 [US4] Implement participant report endpoint GET `/api/v1/assessments/reports/:reportId` in `backend/src/modules/assessment/controllers/` + `assessment.routes.js`: 404 `REPORT_NOT_READY` until ready; returns only `is_released_to_participant = true` sections, scoped to the caller (FR-016)
- [X] T048 [US4] Implement retry endpoint POST `/api/v1/assessments/reports/:reportId/retry` ("permitted when `generationStatus = FAILED_RETRYABLE` (attempt stays `SCORED`)", `409 REPORT_RETRY_NOT_ALLOWED` otherwise) with actor + reason logged
- [X] T049 [US4] Implement admin view endpoints GET `/api/v1/admin/assessments/submissions`, GET `/api/v1/admin/assessments/submissions/:attemptId`, and PATCH `/api/v1/admin/assessments/quality-flags/:flagId` (disposition, `reviewed_by`/`reviewed_at`; Q09 stays human-workflow owned — NEVER produces a score or ordinary report, FR-014) in controllers + routes, all `requireRole('admin')` (FR-016)
- [X] T050 [P] [US4] Build participant results screen in `frontend/src/pages/participant/ResultsPage.jsx`: own 7 domain results + released descriptive layers; hides release-flag-gated layers; shows the single neutral message on hold/invalid
- [X] T051 [US4] Build admin results screen in `frontend/src/pages/admin/ResultsAdminPage.jsx`: submissions list (santulan ID, version, status, session count, score summary) + per-attempt detail (scores, completeness, score status, quality flags) + flag disposition action; wire into `frontend/src/App.js` admin landing and connect `ResultsPage` at submit completion

**Checkpoint**: All user stories now independently functional; reports reproducible and release-gated

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [X] T052 [P] Frontend pass: verify FR-003 "MUST NOT present any right/wrong framing" everywhere, consistent labels on the frozen 1–5 anchors, and the SESSION_LIMIT/recovery copy in `frontend/src/pages/participant/` and `frontend/src/pages/admin/`
- [X] T053 Security hardening: FR-016 data isolation — apply `FORCE ROW LEVEL SECURITY` policies on participant-scoped tables (`responses`, `score_results`, `reports`, `report_sections`) using the research §2 `set_config` GUC pattern (`set_config('app.institution_id', ${institutionId}, true)` first statement of the interactive transaction; missing GUC fails closed with `NULLIF(current_setting('app.institution_id', true), '')`), plus an audit check that no participant endpoint leaks cross-participant rows
- [X] T054 Performance: verify SC-001 — submit → 7 domain results returns < 10 s for valid attempts (benchmark under Jest or a smoke script); review query plans for the current-response partial unique index and the one-active-attempt partial unique index (T007)
- [X] T055 Run `docs/` alignment: execute every scenario in `specs/002-capability-assessment/quickstart.md` end-to-end against a fresh `docker:up` + `db:migrate` + `db:seed`; confirm SC-002/SC-003/SC-005/SC-006/SC-007 gates pass; record any gaps as follow-up notes
- [X] T056 Final suite + cleanup: run the full `npm test` (all contract + integration suites green), remove leftover scaffolding placeholders, verify no DELETE/UPDATE paths remain for Response/ScoreResult (FR-015) and no client-scored path exists (FR-008), and confirm every story's Independent Test passes against the running stack
- [X] T057 Bug fix (found during 003-frontend-visual-design browser verification): enable CORS on the Express app (`backend/src/app.js`) - the `cors` middleware was never wired in, so every browser `fetch()` from the frontend dev server (`http://localhost:3000`) failed its preflight with "No 'Access-Control-Allow-Origin' header" even though the identical request passed under Supertest (no browser, no preflight). Added `cors` dependency, `CORS_ORIGINS` env var (`backend/.env`, `.env.example`, `config/index.js`, default `http://localhost:3000`), and `app.use(cors({ origin: config.corsOrigins, methods: [...], allowedHeaders: ['Content-Type', 'Authorization'] }))` as the first middleware; documented as research §8 and in `contracts/api.md` Conventions
- [X] T058 Architecture change (user-requested): dropped the ORM entirely, replaced with raw `pg` (node-postgres). Deleted the ORM schema/migrations directory and the generated-client helper; removed the ORM client and CLI dependencies from `package.json`, added `pg` as a direct dependency (132 packages removed from node_modules). New `backend/src/shared/db.js` (Pool + `query`/`withTransaction` helpers, auto-camelCasing rows) is the sole data-access surface; every service, controller, the seeder, `auth.routes.js`, and all Jest test files were rewritten from generated-client calls to hand-written parameterized SQL. Schema management moved to plain numbered files under `backend/migrations/` (unchanged DDL) applied by a new `backend/scripts/migrate.js` runner tracked in a `_migrations` table; `backend/scripts/grant-runtime-role.js` (already raw `pg`) needed no change. Local dev also switched from the Docker Postgres container to a local PostgreSQL install (`backend/.env`: `postgresql://postgres:1234@localhost:5432/santulandb`); `docker-compose.yml` remains available as an alternative. Verified: all 23 backend tests pass unchanged (behavior-only regression guard, no data model or endpoint changes), the RLS policy on `responses` still applies and is proven by `rls-isolation.test.js`, and the full suite now runs in ~37s (down from ~170-220s under the ORM). Documented as research §9; `plan.md` and `quickstart.md` Primary Dependencies/Setup sections updated to match

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-6)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3 → P4)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1) MVP**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Depends on US1 attempt/response services it extends (`attempt.service.js`, response endpoints); independently testable
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Seeded version from T012 stands in until the real import ships; independently testable
- **User Story 4 (P4)**: Can start after Foundational (Phase 2) - Uses the scoring pipeline (US1) and report record created at submit (US1); independently testable via seeded report-ready attempts

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Validation/schemas before services; services before controllers; controllers before routes wiring; core implementation before integration (frontend)
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows)
- All tests for a user story marked [P] can run in parallel
- Independent service tasks within a story marked [P] can run in parallel (e.g., US1 profile/consent/eligibility/attempt/response services)
- Different user stories can be worked on in parallel by different team members

---

## Parallel Example: User Story 1

```bash
# Launch all contract/integration tests for US1 together (write FIRST, expect FAIL):
Task: "Contract test for participant endpoints in backend/tests/contract/assessment/participant.test.js"
Task: "Integration test for participant flow in backend/tests/integration/assessment/participant-flow.test.js"

# Launch the independent services together:
Task: "Profile service+controller backend/src/modules/assessment/services/profile.service.js"
Task: "Consent service+controller backend/src/modules/assessment/services/consent.service.js"
Task: "Eligibility service backend/src/modules/assessment/services/eligibility.service.js"
Task: "Attempt lifecycle service backend/src/modules/assessment/services/attempt.service.js"
Task: "Response service backend/src/modules/assessment/services/response.service.js"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently (contract + integration tests + manual quickstart Scenario 1)
5. Import the adolescent pool via the T012 seeder; the full admin import path arrives in US3

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo
4. Add User Story 3 → Test independently → Deploy/Demo
5. Add User Story 4 → Test independently → Deploy/Demo
6. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1
   - Developer B: User Story 2
   - Developer C: User Story 3
   - Developer D: User Story 4
3. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
- Data-model constraint quote: every field-level rule referenced above is quoted verbatim from `specs/002-capability-assessment/data-model.md`; where a rule differs from the ERD, the data-model.md version controls