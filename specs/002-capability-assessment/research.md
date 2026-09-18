# Research: Capability Assessment

**Branch**: `002-capability-assessment` | **Date**: 2026-09-17 | **Plan**: [plan.md](plan.md)

Research that resolves the technical unknowns in the [Implementation Plan](plan.md). Source of truth for business rules is the `docs/` folder (README of each sheet is quoted where relevant); this file records engineering decisions only.

## 1. Partial unique index (BF-01 current-response contract)

- **Decision**: Hand-written SQL migration (`backend/migrations/001_init_capability_assessment.sql`, applied by `backend/scripts/migrate.js` — see research §9) declares the "one current response per attempt/item" rule directly as Postgres DDL:

  ```sql
  CREATE UNIQUE INDEX "responses_one_current_per_attempt_item"
    ON "responses"("attempt_id", "item_id") WHERE (is_current = true);
  ```

- **Rationale**: BF-01 (from `07_Assessment_Response` / `03_Non_Negotiable_Rules`) requires exactly one CURRENT version per item per attempt while historical versions remain. Writing the DDL directly removes any dependency on an ORM's partial-index support (see §9) and is the single source of truth — no schema/migration drift is possible since there is no separate schema file to fall out of sync with the migration.
- **Alternatives considered**: an ORM-declared partial index (rejected with the ORM itself, §9); a plain unique constraint on `(attempt_id, item_id)` (wrong — forbids multiple historical versions per BF-01 versioning).

## 2. Tenant isolation (institution boundary)

- **Decision**: Application-layer scoping as the primary control for pilot v1, plus PostgreSQL Row-Level Security as a defense-in-depth backstop. App runs as a non-owner role with `FORCE ROW LEVEL SECURITY`; policies read a per-transaction GUC. Pattern within an interactive transaction:

  ```ts
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.institution_id', ${institutionId}, true)`; // is_local = SET LOCAL
    return tx.??? // scoped write
  });
  ```

- **Rationale**: `set_config(..., is_local := true)` is the first statement of an interactive transaction, so it is connection-scoped and auto-reset — safe under pooling, unlike session-level `SET` (issues #4303/#5128). Raw statements participate in the transaction. Missing GUC fails closed (`NULLIF(current_setting('app.institution_id', true), '')`).
- **Alternatives considered**: blanket RLS transaction on every request (costs all traffic); `$extends` tenant injection only (~96% throughput but not DB-enforced). Pilot v1 uses the hybrid: app-layer filter everywhere + `FORCE` RLS on sensitive writes/reads.

## 3. Admin item-pool import (TECH_READY xlsx)

- **Decision**: SheetJS `xlsx` v0.20.3 installed from the official SheetJS CDN tarball (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`; the npm registry copy is frozen at 0.18.5/unmaintained). Admin upload endpoint accepts the file via multipart (multer), parses the uploaded buffer:

  ```ts
  const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  ```

  Row 1 is the header, so keys match column names (`item_code`, `assessment_version`, `domain_code`, `subdomain_code`, `item_text`, `keying`, `age_band`, `context`, `layer`, `status`, `display_order`). Batch upsert inside one transaction keyed on natural unique `(item_code, assessment_version)`.
- **Rationale**: `sheet_to_json` returns structured objects directly (no type loss, no re-parse); ~171–175 rows is negligible memory. Upsert makes re-import of the same version idempotent (SC-004).
- **Alternatives considered**: `exceljs` (streaming but heavier than needed); hand-rolled CSV conversion (loses the xlsx contract).

## 4. Idempotent response writes (network retry safety)

- **Decision**: `idempotency_key` (UUID, unique) on the response record, mirroring the ERD `responses.idempotency_key`. The save-response endpoint performs `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING` via raw query inside the attempt's transaction; on conflict it returns the existing response. A one-shot retry on Prisma `P2002` guards the concurrent-create race (issue #14868).
- **Rationale**: BF-01 + `07_Assessment_Response` ("Idempotency keys prevent duplicate response writes on retry/reconnect"). DO NOTHING is atomic at the Postgres level.
- **Alternatives considered**: separate idempotency lookup table (extra join); Redis lock (adds infrastructure).

## 5. Scoring and report generation pipeline

- **Decision**: Synchronous, deterministic, in-service pipeline executed server-side on submit, inside one transaction: response lock → per-item validation → quality flags recorded (Q01–Q09, never mutating raw responses) → per-domain scoring (mean of valid responses, 1.00–5.00; completeness; score status S0–S5/SH) → report assembly from versioned interpretation rules → snapshot sections → `REPORT_READY`. A controlled `POST /reports/{id}/retry` regenerates identical content from the frozen attempt+versions on the documented `FAILED_RETRYABLE` path (BF-05). The scaffold's `src/jobs/queues|workers` remain reserved; the deterministic synchronous pipeline is sufficient because N ≤ ~59 eligible items/participant.
- **Rationale**: SC-001 (results within 10 s), SC-003 (reproducibility from frozen inputs), FR-008 (no client scores), FR-011 (REPORT_READY gate + retry). Deterministic means synchronous is simple and auditable.
- **Alternatives considered**: async queue + separate scoring worker (complexity not justified at pilot scale; the docs' MP17 gating is a content/evidence flag, not a compute requirement).

## 6. Response scale

- **Decision**: Freeze the 5-point scale from the OFFLINE booklets (`1 = Almost never`, `2 = Rarely`, `3 = Sometimes`, `4 = Often`, `5 = Almost always`). Stored as a `ResponseScale` row with `version`, `scale_points = 5`, `anchor_labels` JSON, `frozen_at`, `status`. Participation routing and eligibility use the item rules from the docs: General/universal items always eligible; variant items eligible by age band × context (School vs College/Work); confirmed per `05_Scoring_and_Evidence` A07 (C7 = 59 eligible per participant, not 60).
- **Rationale**: `02_System_Overview` and both OFFLINE booklets state the anchors verbatim; `V02` requires freezing anchors and numeric mapping.
- **Alternatives considered**: configurable per-version scale (over-engineering for two frozen versions in pilot).

## 7. Authentication / identity reuse

- **Decision**: Reuse the existing platform auth module and users module: JWT Bearer with role claims (`participant`, `admin`). The OTP managed-auth flows, consents and age-declaration endpoints in the ERD are represented in this feature as the participant profile + consent records the assessment module references; full managed-auth OTP is treated as an existing-capability dependency (documented in plan Assumptions).
- **Rationale**: Spec Assumptions ("existing platform's auth/users modules provide participant and admin identities"); the scaffold already centralizes `src/shared` middleware.
- **Alternatives considered**: building OTP/auth inside this feature (out of scope; duplicate).

## 8. Cross-origin access for the browser frontend (CORS)

- **Decision**: `cors` npm middleware mounted first in `backend/src/app.js`, restricted to an allow-list read from `CORS_ORIGINS` (comma-separated, default `http://localhost:3000` for the CRA dev server), permitting `GET/POST/PATCH/DELETE/OPTIONS` and the `Content-Type`/`Authorization` headers (the only two the frontend ever sends - `assessmentApi.js` never uses cookies, so no `credentials: true`/`Access-Control-Allow-Credentials` is needed).
- **Rationale**: The `003-frontend-visual-design` browser walkthrough surfaced `No 'Access-Control-Allow-Origin' header is present` on every `fetch()` from `http://localhost:3000` to `http://localhost:8000` - a gap from the original 002 implementation, which was validated only via Supertest (same-process, no browser preflight, so the missing header was invisible to the test suite). An explicit origin allow-list (not a wildcard) keeps the JWT-bearing API from being callable by an arbitrary third-party origin.
- **Alternatives considered**: `origin: '*'` (works for GET but blocks the `Authorization` header on real browsers' preflight in most configurations, and is unnecessarily permissive for an authenticated API); a dev-only proxy (`"proxy"` in `frontend/package.json`) instead of CORS (works only for `npm start`, not a served production build, so it doesn't fix the underlying gap).

## 9. Data access layer: raw `pg` over an ORM

- **Decision**: Replaced Prisma ORM entirely with the `pg` (node-postgres) driver, used directly. `backend/src/shared/db.js` wraps a `pg.Pool` with `query(text, params)` (auto-camelCases result rows) and `withTransaction(fn)` (BEGIN/COMMIT/ROLLBACK over a dedicated client, exposing `tx.query`/`tx.raw`); every service/controller issues hand-written parameterized SQL through this instead of a generated client. Schema management moved from `prisma migrate` to plain numbered SQL files under `backend/migrations/` (the exact DDL Prisma had generated, carried over unchanged, including both partial unique indexes and the `responses` RLS policy) applied by a ~50-line runner (`backend/scripts/migrate.js`) that tracks applied files in a `_migrations` table. `backend/seeders/assessment.seeder.js` and `backend/scripts/grant-runtime-role.js` connect with a plain `pg.Client` the same way.
- **Rationale**: Prisma 7's driver-adapter/config split (datasource `url` moved out of `schema.prisma` into `prisma.config.ts`, `@prisma/adapter-pg` required for the runtime client, package `exports` subpaths like `react-router/dom`-style resolution issues surfacing elsewhere in this stack) added real friction and moving parts for a single-service pilot backend that only ever talks to one Postgres database. `pg` is a single, stable, minimal dependency; the RLS/partial-index/JSON-column behavior this feature depends on (research §1, §2) is expressed as plain SQL either way, so an ORM was translating SQL the codebase already had to reason about directly. Removing Prisma dropped 132 transitive packages and reduced `npm audit` findings from 5 to 1.
- **Alternatives considered**: staying on Prisma with the driver-adapter workaround already in place (kept working, but the dependency churn was the reason for this change); Knex.js or Drizzle ORM as a lighter middle ground (both considered; raw `pg` was chosen for zero abstraction over the SQL this project already hand-tunes for RLS/partial indexes, at the cost of more boilerplate per query).
- **Compatibility note**: every table/column name, constraint, and the `responses` RLS policy are byte-for-byte the same DDL Prisma emitted — this was a data-access-layer swap only; no data model, endpoint, or behavior changed (FR-009-style regression guarantee, verified by the full existing contract/integration suite passing unchanged against the new layer).