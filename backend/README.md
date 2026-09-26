# Santulan backend

Node.js / Express API on MongoDB, laid out as classic MVC (`src/controllers/`, `src/services/`, `src/models/`). Everything about the data
model is code in `src/models/schema/`; everything that touches the database at run time goes through `src/models/db/` (client, access,
transactions) and `src/models/repositories/`.

This layer-first layout makes the codebase easy to navigate today (one place to look for "the controllers", "the models",
etc.). Worth revisiting if the codebase keeps growing: a layer-first structure tends to get less convenient than a
feature-first one once there are many features, because everything about one feature (e.g. scoring) then lives split
across `controllers/`, `services/scoring/` and `models/repositories/` instead of one folder. Not a problem at the current
size — just a tradeoff to keep in mind, not something to pre-emptively fix.

## Data layout

**27 canonical collections**, **9 read-only views**, **50 named indexes**, plus one development-only collection.

| Tier | Collections | Runtime credential may |
|------|-------------|------------------------|
| **A — append-only** | `audit_logs`, `score_results`, `response_events`, `items`, `participant_cohort_history`, `growth_reviews`, `pathway_decisions`, `pathway_reviews` | `find`, `insert` |
| **B — governed change** | the other 19 (participants, consents, question sets, attempts, responses, reports, growth plans, …) | `find`, `insert`, `update` (through named mutations) |
| **Views** | `v_research_*` (8) and `v_candidate_subdomain_scores` | `find` on the eight research views; the candidate view is migrator-only |
| **Dev only** | `dev_identity_credentials` | not part of the canonical model |

Nobody — no credential, no code path — has `remove`. Question sets are frozen permanently; a frozen set's content hash is re-checked
when it is opened and at start-up.

## Credentials and the least-privilege role

| Credential | Used by | Can |
|-----------|---------|-----|
| `MONGODB_URI_RUNTIME` (`santulan_runtime`) | the API and the workers | the tier rules above; no remove; no schema changes |
| `MONGODB_URI_ADMIN` (`santulan_migrator`) | **scripts and tests only** — never read by `src/` | migrations, seeding, verification, test fixtures |

The migrator credential must **never** be present in the API's environment. The API refuses to start if its store is not ready.

## The scoped data-access layer

`store.withScope(scope, async (tx) => …, { transaction })` is the only way to read or write. A scope is one of `PARTICIPANT`,
`INSTITUTION_ADMIN`, `SUPER_ADMIN`, `SYSTEM` or `NONE`; it comes from the verified token, never from a request. `tx.c.<collection>`
ANDs the scope into every read, checks every write, limits updates to the fields named in `models/db/access.js`, and has no remove.
Repositories (`models/repositories/`) are built on it. `tests/santulan/store/repoScan.test.js` fails the build if any file outside
`models/db/` or `models/repositories/` imports the driver. Transactions use snapshot reads and majority writes with retry; a transient
failure is a `503 STORE_UNAVAILABLE`.

## Data-model migrations

`db/migrations/001–004` (collections and validators, indexes, research views, runtime role). Each is applied once and recorded with its
SHA-256 in `_data_migrations`; editing an applied file is refused — add a new numbered migration. `DATA_MODEL_VERSION` (currently `006.1`)
is checked at start-up.

## Development

`npm run dev` runs the server under `nodemon` (auto-restart on change), watching only `src/` and `config/` (see
`nodemon.json` — `.mongo/`, `exports/`, `backups/` and `tests/` are excluded so the local database's own data files never
trigger a restart). `npm start` (production) still runs plain `node src/server.js`, unchanged.

## Logging

`src/utils/logger.js` (pino) is the process logger: structured JSON in production, pretty-printed in development, silent
during tests (`APP_ENV=test`). `LOG_LEVEL` (default `info`) controls verbosity. Every place that used to call `console.*`
now calls this logger instead, under the exact same conditions as before — only the output format changed, not when or
what gets logged.

## CI

`.github/workflows/backend-tests.yml` runs on every push/PR touching `backend/`: installs MongoDB 8.0, brings up the same
dedicated local replica-set instance a developer would (`scripts/mongo-local.js init`), rebuilds the scratch database
(`npm run db:scratch`) and runs `npm test` — the same commands documented below, just automated.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | start the server with auto-restart (nodemon) |
| `npm run db:local:init / start / stop / status` | the dedicated local MongoDB instance (port 27018, replica set `rs0`) |
| `npm run db:migrate` | apply data-model migrations |
| `npm run db:scratch` | rebuild the scratch (test) database |
| `npm run db:seed:reference` | development actions and reflection prompts |
| `npm run db:seed:dev` | dev accounts |
| `npm run db:verify` | integrity checks; non-zero exit on any failure |
| `npm run questions:convert` | convert the frozen catalog to the new workbook format |
| `npm run wording:load -- <file> [--approve]` | governed loading of approved report wording |
| `npm run pipeline:once` | run the scoring pipeline and report worker once |
| `npm run export:synthetic -- --participants N --items M` | synthetic research-export run on the scratch database |
| `npm run drill:backup-restore` | backup → restore into a scratch database → verify |
| `npm run release:manifest` | fingerprint of the release contents (unsigned) |
| `npm run test:santulan [-- <path filters>]` | tests against the scratch database |

## Configuration keys

| Key | Meaning |
|-----|---------|
| `MONGODB_URI_RUNTIME`, `MONGODB_DB` | the API's connection and database name |
| `MONGODB_URI_ADMIN`, `MONGODB_TEST_DB` | scripts and tests only; the test database name must contain `test`, `qual` or `scratch` |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | session tokens |
| `INTERNAL_API_KEY` | worker / verifier endpoints (empty = disabled) |
| `CONSENT_PROTOCOLS_PATH`, `QUALITY_POLICY_PATH`, `EVIDENCE_CONFIG_PATH`, `GROWTH_RANKING_PATH` | governed configuration files (see `config/`) |
| `SESSION_INACTIVITY_MINUTES`, `SCORING_PIPELINE`, `REPORT_WORKER`, `EXPORT_WORKER` | gated workers (off unless set) |
| `EXPORT_DIR` | protected storage for research exports (default `backend/exports`, git-ignored) |
| `REGISTRATION_THROTTLE_*` | OPEN-registration throttle limits |

## The four release switches

`pilotS2`, `advancedEvidence`, `developmentRelease`, `pathwayRelease` — all **OFF** on a new database. Each change is a
`RELEASE_FLAG_CHANGED` audit event written in the same transaction as the change; the latest event decides; an unknown value is OFF.
They are read and changed only through `GET /admin/release-flags` and `POST /admin/release-flags/{flag}` (reason required).

## Contact / notification policy (deliberate scope, not a gap)

The API never stores a participant's email or mobile number — even OTP registration only ever keeps a one-way hash of
`channel + identity` (`services/identity/devProvider.js`, `otpSubject`), never the address itself. This is a deliberate
privacy choice (the participants are minors), and it means:
- **OPEN participants** authenticate by OTP, sent to whatever they type at the time — nothing to "send a link to" later.
- **Institutional participants** have a password; if they forget it, an admin issues a new temporary one directly
  (`POST /admin/participants/{id}/credential-reset`) and hands it to them out of band. There is no self-service
  "forgot password" email/link flow, and none is planned, because that would require storing a verified contact address
  first — a real scope change, not a small addition.
If a self-service reset link is ever wanted, it needs this decision revisited first (contact storage + consent
implications + an actual email/SMS provider), not just a new endpoint.

## Registration throttle

`src/middleware/throttle.js` is an in-memory sliding window keyed by IP and by a signed device cookie. It is applied only to
the OTP flow and OPEN registration (`POST /registrations/open`, `POST /auth/request-otp`, `POST /auth/verify-otp`,
`POST /participants/age-declaration`) — never to `/auth/login`, `/cohorts/import` or admin routes. **A shared store is a deployment
prerequisite** when more than one API instance runs; the in-memory version only protects a single process. This is already an
extension point, not a rewrite: `createRegistrationThrottle(limits, store)` takes any object implementing `hit(key, windowMs, now?)`
as its second argument (see the `ThrottleStore` comment in the file) — a Redis-backed store implementing that one method is a
drop-in replacement, nothing else in the file or its callers needs to change.

## Operational considerations for scaling past a single instance

Two things are fine at pilot scale and worth revisiting before running more than one API process or for a long time
unattended:
- **The registration throttle** (above) is per-process memory; a second instance would enforce its own separate limits.
- **`audit_logs` is append-only forever** (Tier A, no remove anywhere in the codebase) — correct for an audit trail, but
  with no retention/archival policy it grows without bound. A retention period is a governance decision (how long must an
  audit record be kept?), not a technical one, so this is deliberately left as a flagged consideration rather than an
  automated deletion job.

## Tests

`tests/santulan/` — `store/` (validators, indexes, privileges, views, scope, atomicity, start-up), `domain/` (rules), `contract/` (HTTP),
`integration/`, `unit/`, `helpers/`, `evidence/`. They run against the scratch database and commit fixtures there (never to `santulan`).
