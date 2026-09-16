# Research: Assessment Service

**Branch**: `001-assessment-service` | **Date**: 2026-09-16 | **Plan**: [plan.md](plan.md)

## 1. Backend Framework

**Decision**: Express 4 (JavaScript) mounted as a modular monolith.

**Rationale**: The backend scaffold is explicitly Node/JS-shaped (`src/modules/*`, `src/routes/v1/*`, `package.json`, `node_modules/` in `.gitignore`). Express is the lowest-friction fit for these conventions, has a huge ecosystem for the exact needs here (multer for uploads, JSON body parsing, middleware routing for role guards), and keeps the assessment module consistent with sibling modules (auth, users, orders, payments, notifications).

**Alternatives considered**:
- **Fastify** — faster and schema-validated out of the box, but would introduce a second framework convention across all modules.
- **NestJS** — strong DI and structure, but heavier and a larger divergence from the existing flat-module scaffold.

## 2. HTTP API Form + Versioning

**Decision**: REST over JSON, mounted under `/api/v1/`.

**Rationale**: Existing route convention is `src/routes/v1/`. REST is the platform default for web services and trivially consumed by the React frontend. Versioning prefix (`v1`) matches the folder layout already present.

**Alternatives considered**: GraphQL (no existing usage; overkill for 6 endpoints).

## 3. CSV Parsing & Validation

**Decision**: `csv-parse` (node-csv) for parsing; explicit schema validation in the service layer on top of parsed rows.

**Rationale**: `csv-parse` is the de-facto standard RFC 4180 parser, streaming-capable, dependency-light, and battle-tested for exactly this file shape. Validation is kept in the application layer so error messages can reference the specific row/column (SC-006, FR-014) rather than being swallowed by a generic parser.

**Alternatives considered**: `fast-csv` (thinner API surface, less control over per-row validation errors), `PapaParse` (browser-oriented, awkward server-side).

## 4. File Upload Handling

**Decision**: `multer` memory storage with a hard 1 MB size cap and `.csv` MIME/extension check.

**Rationale**: De-facto Express upload middleware; memory storage avoids temp-file lifecycle complexity for small question-set files. Size cap prevents abuse; the application validates content regardless of MIME.

**Alternatives considered**: `busboy` (manual, more code), direct multipart parsing (reinventing multer).

## 5. Storage / Data Layer

**Decision**: PostgreSQL 16 via Prisma ORM, migrations in the existing `backend/migrations/` flow.

**Rationale**: The spec model (versioned templates, questions, options, submissions, responses, results, CSV import records) is relational with strong referential invariants (one active template, immutable submission snapshots, exactly one correct option). PostgreSQL enforces these natively (unique partial index for single active version; foreign keys preserving submission immutability — FR-008). Prisma gives typed models, schema-as-source-of-truth, and migrations that slot into the existing `migrations/` directory.

**Alternatives considered**: Sequelize (weak partial-index support), Knex (rawer, more glue), Mongo (document model but weak referential integrity for version snapshots), SQLite (inadequate for server concurrency).

## 6. Authentication & Roles

**Decision**: Reuse the existing `auth` module pattern — JWT access tokens with a `role` claim (`admin` | `student`); a shared authorization middleware in `src/shared/` guards routes.

**Rationale**: Spec assumes students authenticate through the existing auth module (no separate auth). Roles map directly to FR-015/FR-016 (student-only start/answer, admin-only upload/view-all). JWT with a role claim is the standard stateless approach for this API layout.

**Alternatives considered**: OAuth2 (no external IdP exists), session cookies (stateful, adds session store to a modular monolith already on tokens).

## 7. Scoring

**Decision**: Deterministic correct/incorrect matching at submission time; score persisted with the submission snapshot.

**Rationale**: FR-011 requires instant, fully automated scoring; FR-004 defines simply counting correct answers. Persisting the computed result with the snapshot satisfies FR-005/FR-008 (past results never change).

**Alternatives considered**: Recomputing from live template (violates FR-008), external scoring service (violates FR-011 latency), ML scoring (out of scope per spec).

## 8. Version Lifecycle

**Decision**: Every accepted CSV upload creates a new `AssessmentTemplate` row and atomically flips it to the single active version (active flag transitioned in a transaction). Submissions reference the exact template version they started with.

**Rationale**: Satisfies FR-007, FR-008, and FR-017. Handling "CSV uploaded mid-session" (edge case) is trivially safe: an in-progress submission already holds its template version, so a later upload cannot alter it.

**Alternatives considered**: In-place editing of one template row (loses history — violates FR-008), separate version table with composite keys (over-engineered for v1).

## 9. Testing Strategy

**Decision**: Jest + Supertest for unit and integration; contract tests assert the endpoint schemas in `contracts/`.

**Rationale**: Standard Node testing pairing; Supertest exercises the real HTTP layer against a test database, matching the user-story acceptance flows. Seeded fixture CSV files drive parser/scoring tests.

**Alternatives considered**: Mocha/Chai (equivalent, no advantage), Playwright end-to-end (later phase).

## 10. Frontier / Scope Guardrails

- v1 single-select MCQ only (spec assumption) — validate exactly one correct option per row (FR-014).
- No in-progress duplicate sessions (FR-009) — enforce a unique constraint on `(student_id, template_id)` where status is `in_progress`.
- History isolation (FR-010) — every query scopes by requesting user id; admin paths add a role guard.
- Mid-assessment resume — v1 decision: in-progress submission is resumed, not discarded (keeps SC-005 abandonment low).