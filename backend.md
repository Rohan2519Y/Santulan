# Santulan Backend Guide

This document explains the Santulan backend in beginner-friendly language. It is meant to answer three questions:

1. What kind of architecture is this?
2. Where should I look when I need to understand or change something?
3. How does data move from an HTTP request to MongoDB and back?

## 1. The short answer

The backend is a **layered modular monolith** built with Node.js, Express, and MongoDB.

- **Monolith** means the API, business rules, database access, and background workers live in one backend application.
- **Modular** means the code is separated by responsibility and feature.
- **Layered** means a request moves through routes, middleware, controllers, services, repositories, and the database layer.

The project calls its layout "classic MVC," but it is not Model-View-Presenter and it does not have a traditional server-rendered View layer. The React frontend is the view. The backend mainly returns JSON.

The simplest mental model is:

```text
React frontend
      |
      | HTTP request
      v
Express route
      |
      v
Middleware (authentication, validation, throttling)
      |
      v
Controller (HTTP input and output)
      |
      v
Service (business process)
      |
      +----> Domain rules (pure decisions and state rules)
      |
      v
Repository / scoped data-access layer
      |
      v
MongoDB
```

Most backend confusion becomes easier when you follow one request through these layers instead of trying to understand every folder at once.

## 2. What the backend is responsible for

The backend handles:

- participant and administrator authentication;
- open and institutional registration;
- age-based participant routing;
- consent and assent requirements;
- question-set upload, validation, freezing, opening, and closing;
- assessment attempts, sessions, answers, pause, resume, and submission;
- quality checks and safeguarding flags;
- score calculation;
- report generation and controlled report wording;
- growth plans and pathway decisions;
- institutions, cohorts, rosters, participants, and admin monitoring;
- research export generation;
- audit records for important operations;
- database permissions, schema validation, migrations, and transactions.

It is intentionally strict because it processes assessment, consent, and participant data.

## 3. Technology used

| Purpose | Technology |
|---|---|
| HTTP API | Node.js and Express 4 |
| Database | MongoDB 8 using the official `mongodb` driver |
| Validation | Zod |
| Authentication | JSON Web Tokens (`jsonwebtoken`) |
| Password hashing | `bcryptjs` |
| File uploads | `multer` |
| Spreadsheet reading | `xlsx` |
| Spreadsheet writing | `exceljs` |
| IDs | UUID v4 |
| Tests | Jest and Supertest |

There is no ODM such as Mongoose. The project implements its own repositories and protected data-access layer around the MongoDB driver.

## 4. Important entry files

Start with these files when learning the backend:

| File | What it does |
|---|---|
| `backend/src/server.js` | Starts the process, checks the database, verifies frozen question sets, starts Express, and starts enabled workers. |
| `backend/src/app.js` | Creates the Express application, configures CORS and JSON parsing, mounts routes, and installs 404/error handlers. |
| `backend/src/config/index.js` | Converts environment variables into one configuration object. |
| `backend/src/routes/v1/santulan.routes.js` | Lists every API endpoint and shows its middleware and controller. This is the best API map. |
| `backend/src/controllers/*.controller.js` | Receives HTTP requests and calls services. |
| `backend/src/services/` | Contains business processes and feature logic. |
| `backend/src/services/domain/` | Contains business rules and state-machine decisions. |
| `backend/src/models/repositories/` | Contains reusable database operations for each data area. |
| `backend/src/models/db/` | Owns the MongoDB connection, security scopes, transactions, and low-level access. |
| `backend/src/models/schema/` | Defines collections, validators, indexes, roles, and views as code. |
| `backend/src/jobs/workers/` | Contains periodic background work. |

## 5. What happens when the server starts

Running `npm run dev` or `npm start` executes `backend/src/server.js`.

Startup happens in this order:

1. Environment variables are loaded through `dotenv`.
2. The backend connects using `MONGODB_URI_RUNTIME`.
3. It checks that the connected MongoDB user is exactly `santulan_runtime`.
4. It checks that MongoDB is running as a replica set because transactions are required.
5. It checks that the database migration version matches `DATA_MODEL_VERSION` in the code.
6. It verifies the content fingerprints of open, frozen question sets.
7. It starts Express on `APP_PORT`, which defaults to `8000`.
8. It starts only the workers explicitly enabled by environment variables.

The server refuses to start when the database is unsafe or incomplete. This is called **failing closed**.

Important detail: `npm run dev` currently runs plain `node src/server.js`. It does not use Nodemon, so code changes require a manual restart.

## 6. The request layers

### 6.1 Routes

`backend/src/routes/v1/santulan.routes.js` is the front door.

A route connects four things:

```js
router.post(
  '/admin/institutions',
  requireActiveSuperAdmin,
  validate(admin.institutionCreateSchema),
  admin.createInstitution
);
```

This says:

1. Accept `POST /api/v1/admin/institutions`.
2. Require an active Super Admin.
3. Validate the request body.
4. Run `admin.createInstitution`.

All main routes are mounted below `/api/v1` in `app.js`.

### 6.2 Middleware

Middleware runs before the controller.

The main middleware files are:

- `middleware/auth.js`: verifies JWTs or the internal API key and creates `req.actor`.
- `middleware/http.js`: creates correlation IDs, strict Zod objects, and log redaction helpers.
- `middleware/throttle.js`: rate-limits open registration and OTP traffic.
- `utils/validate.js`: parses the selected request part using a Zod schema.

Request schemas are strict. Unknown fields are rejected. For example, a client cannot secretly send `score`, `participantId`, or database scope fields.

### 6.3 Controllers

Controllers translate HTTP into service calls. They should remain small.

A controller normally:

- defines Zod request schemas;
- reads validated path, query, or body values;
- reads the trusted actor created by authentication middleware;
- calls one service function;
- selects the HTTP status code;
- passes errors to the central error handler.

Controllers should not contain MongoDB queries or large business decisions.

### 6.4 Services

Services perform complete business operations. Examples include:

- registering a participant;
- creating an assessment attempt;
- saving an answer version;
- freezing a question set;
- reviewing a quality flag;
- generating a report;
- creating a research export.

Services coordinate repositories, domain rules, transactions, and auditing.

Feature services are grouped into folders such as:

```text
services/
  admin/
  consent/
  delivery/
  growth/
  identity/
  pathways/
  quality/
  questionsets/
  registration/
  reporting/
  research/
  scoring/
```

### 6.5 Domain rules

`services/domain/` contains the rules that decide what is legal.

Examples:

- `attemptRules.js`: attempt states, session limits, pause/resume, and submission rules;
- `consentRules.js`: required consent types and legal consent transitions;
- `registrationRules.js`: participant fields derived from age and registration route;
- `questionSetRules.js`: draft/frozen/open rules and content-hash checks;
- `scoringRules.js`: completeness and score decisions;
- `reportRules.js`: report states and which sections may be released;
- `adminRules.js`: admin entity states and hierarchy checks;
- `releaseFlags.js`: four audited release switches.

These files are often the best place to understand **why** an action is accepted or rejected.

### 6.6 Repositories

`models/repositories/` contains data operations organized by topic:

| Repository | Main data |
|---|---|
| `identity.js` | participants, admins, institutions, cohorts |
| `consents.js` | consent records and transitions |
| `questionSets.js` | assessment versions and questions |
| `delivery.js` | attempts and attempt events |
| `responses.js` | current and historical answer versions |
| `quality.js` | quality flags |
| `scores.js` | score results |
| `reports.js` | reports and report sections |
| `growth.js` | growth plans, priorities, goals, actions, and reviews |
| `exports.js` | research-export requests and status |
| `audit.js` | immutable audit records |
| `devIdentity.js` | development-only credential hashes |

Repositories use `tx.c.<collection>` from the scoped data-access layer. They do not create a new MongoDB connection.

### 6.7 Scoped data access

The key database entry point is:

```js
store.withScope(scope, async (tx) => {
  // use tx.c.<collection> here
}, { transaction: true });
```

The scope controls which records can be read or changed.

| Scope | Meaning |
|---|---|
| `PARTICIPANT` | Can see only that participant's permitted data. |
| `INSTITUTION_ADMIN` | Can see records belonging to one institution. |
| `SUPER_ADMIN` | Privileged administrative access. |
| `SYSTEM` | Trusted workers, engines, and startup tasks. |
| `NONE` | Reads return nothing and writes are refused. |

Scopes are created from verified identity, never from a request body. A plain JavaScript object cannot pretend to be a valid scope.

`models/db/access.js` defines access rules for every collection. It also lists exactly which fields can be updated. Collections marked append-only do not have an update path.

### 6.8 MongoDB driver

Only the database and repository layers are allowed to use database operations. `models/db/client.js` owns one shared `MongoClient` with a maximum pool size of 20.

The runtime API uses a least-privilege account. Migration and test scripts use a separate admin account.

## 7. A complete example from `admin.controller.js`

Consider creating an institution.

```text
POST /api/v1/admin/institutions
```

The request follows this path:

```text
santulan.routes.js
  -> requireActiveSuperAdmin
  -> validate(admin.institutionCreateSchema)
  -> admin.controller.js:createInstitution
  -> services/admin/institutionService.js:create
  -> services/domain/adminRules.js (when a rule must be checked)
  -> store.withScope(SUPER_ADMIN, ..., transaction: true)
  -> tx.c.institutions.insertOne(...)
  -> audit log inserted in the same transaction
  -> JSON response with HTTP 201
```

The controller is not the whole feature. It is only the HTTP adapter. For admin behavior, keep the controller and the matching file under `services/admin/` open together.

## 8. Authentication and authorization

There are three main caller types.

### Participant token

`requireParticipantToken`:

1. reads the Bearer JWT;
2. verifies its signature and expiration;
3. requires `role: participant` and a participant ID;
4. reloads the participant from MongoDB on every request;
5. refuses suspended or inactive participants;
6. checks credential version so password resets revoke old tokens;
7. creates a participant actor and scope.

### Super Admin token

`requireActiveSuperAdmin`:

1. verifies the JWT;
2. requires an admin identity;
3. reloads the admin from MongoDB;
4. requires status `ACTIVE` and role `SUPER_ADMIN`;
5. creates a Super Admin actor and scope.

Although the schema names other admin roles, the current route guard exposes these admin endpoints only to active Super Admins.

### Internal API key

Workers and trusted service calls use `x-internal-api-key`. The value is compared with `INTERNAL_API_KEY` using a constant-time comparison. An empty configured key disables internal-key access.

### Development identity provider

In development:

- OTP codes are held in memory, expire, and are single-use;
- password hashes are stored in the non-canonical `dev_identity_credentials` collection;
- temporary passwords must be changed;
- the old password stops working after replacement;
- the development provider is refused when `APP_ENV=production`.

A production deployment must provide a managed identity-provider adapter.

## 9. Registration flow

Age routing is deterministic:

| Age | Result |
|---|---|
| Below 13 or above 25 | Ineligible |
| 13-17 | `ADOLESCENT`, minor |
| 18-25 | `EMERGING_ADULT`, adult |

Open registration and institutional registration create the participant identity. Registration does **not** create consent records and does **not** create an assessment attempt.

Registration is transactional and idempotent:

1. validate age and route;
2. check the `Idempotency-Key`;
3. validate institution/cohort scope when applicable;
4. generate a Santulan ID and participant record;
5. write an audit event;
6. commit everything together.

Retrying the same request with the same key and same body returns the original outcome. Reusing that key with a different body returns an idempotency conflict.

## 10. Consent flow

Consent uses this state machine:

```text
PENDING -> GRANTED -> VERIFIED -> WITHDRAWN
    |          |            |
    +----------+------------+-> WITHDRAWN
```

`WITHDRAWN` is terminal.

An adult needs one verified `ADULT_SELF_CONSENT`.

A minor needs both:

- verified `STUDENT_ASSENT`;
- verified `PARENT_GUARDIAN_CONSENT`.

`GRANTED` alone is not enough. The assessment gate opens only when all required consent records are `VERIFIED` and not withdrawn.

Consent protocol versions and allowed verification methods come from `CONSENT_PROTOCOLS_PATH`. Missing approval makes the operation fail closed.

## 11. Question-set flow

A question set follows this lifecycle:

```text
Workbook upload -> DRAFT -> FROZEN -> OPEN for participation
                                |          |
                                |          +-> CLOSED
                                +-> content is permanent
```

Main rules:

- the uploaded workbook is parsed and validated before data is written;
- each question embeds 2 to 20 answer options;
- every required domain must have an eligible active core question before freezing;
- freezing records a deterministic content hash;
- a frozen set cannot be edited;
- only a frozen set can be opened;
- only one set can be open for an age group;
- the content hash is rechecked when opening and during server startup;
- a mismatching open set is quarantined and cannot be used for a new attempt.

Question-set administration is implemented in `services/questionsets/`.

## 12. Assessment delivery flow

An attempt has a state machine. The common successful path is:

```text
CREATED -> IN_PROGRESS -> PAUSED -> IN_PROGRESS -> SUBMITTED
                                                     |
                                                     v
                                                  SCORING
                                                     |
                                                     v
                                                   SCORED
                                                     |
                                                     v
                                                REPORT_READY
```

Alternative terminal or controlled outcomes include `QUALITY_HOLD`, `INVALID`, and `EXPIRED`.

Before creating an attempt, the backend checks:

- participant status is active;
- required consent is verified;
- assessment control is open;
- a frozen question set is open for the participant's age group;
- the question-set fingerprint is intact;
- the participant does not already have a non-terminal attempt.

### Sessions

- A participant gets at most four true sessions.
- Reconnecting to an already active session does not increase the session count.
- Resuming from `PAUSED` starts a new session and increases the count.
- Explicit pause, logout pause, or configured inactivity timeout ends a session.

### Answers

The browser sends an option position such as `"1"`, not a score.

Saving an answer:

1. verifies the attempt belongs to the participant;
2. checks that the attempt is writable;
3. checks the question belongs to the attempt's frozen set;
4. validates the option position against that question's options;
5. marks the previous current answer as historical;
6. inserts a new response version;
7. writes a `RESPONSE_SAVED` event;
8. updates last activity;
9. commits in one transaction.

Each save has an idempotency key so a network retry cannot create an accidental duplicate logical answer.

### Submission

Submission atomically:

- closes the active session when necessary;
- moves the attempt to `SUBMITTED`;
- writes a submit event containing the submission key;
- writes an audit event.

Submission does not directly score the attempt. The pipeline worker handles scoring later.

## 13. Quality, scoring, and reports

The asynchronous flow is:

```text
SUBMITTED
   |
   v
Quality engine
   |
   +---- CLEAR -> scoring -> SCORED -> report worker -> REPORT_READY
   |
   +---- HOLD -----------------------> UNDER_REVIEW report
   |
   +---- INVALID --------------------> NOT_ELIGIBLE report
```

### Quality

Quality rules can create `Q01` through `Q09` flags. The policy is loaded from `QUALITY_POLICY_PATH`. Missing or unapproved policy behavior fails closed.

Quality flags are for trusted/admin review. Sensitive safeguarding details are not returned to participant endpoints.

### Scoring

Scoring reads the frozen question set and current answers. The client cannot submit scores or scoring versions.

The score engine stores one result per domain with:

- raw score when enough data exists;
- completeness rate;
- eligible and valid item counts;
- completeness status;
- evidence state;
- scoring version;
- calculation timestamp.

There is no participant score endpoint. The participant receives only released report content.

### Reports

Report generation uses several transactions so partial reports are never exposed:

1. create or find one report shell for the attempt;
2. render every required section;
3. store all sections and mark both report and attempt ready together;
4. if rendering fails, store `FAILED_RETRYABLE` without partial sections;
5. allow only a controlled, audited retry.

Approved report wording is loaded separately. If required wording is missing, the report fails closed.

Only terminal reports are participant-visible:

- `REPORT_READY`;
- `UNDER_REVIEW`;
- `NOT_ELIGIBLE`.

## 14. Background workers

Workers run inside the same Node.js process as the API. Each one uses a timer and handles records in small batches.

| Worker | Enabled by | Work performed |
|---|---|---|
| `inactivityWorker.js` | valid `SESSION_INACTIVITY_MINUTES` | Pauses inactive in-progress attempts. |
| `pipelineWorker.js` | `SCORING_PIPELINE=on` | Runs quality checks and scores clear submitted attempts. |
| `reportWorker.js` | `REPORT_WORKER=on` | Builds reports for scored, held, and invalid attempts. |
| `exportWorker.js` | `EXPORT_WORKER=on` | Generates requested research workbooks. |

The pipeline, report, and export workers are off unless their value is exactly `on`.

Workers use compare-and-set transitions and unique indexes so multiple worker instances converge safely instead of processing the same state twice.

For local one-time processing, use:

```bash
cd backend
npm run pipeline:once
```

## 15. Database model

The database has 27 canonical collections plus one development-only credential collection.

### Identity and consent

- `institutions`
- `cohorts`
- `admin_users`
- `participants`
- `participant_cohort_history`
- `consents`

### Assessment content

- `assessment_versions`
- `items`
- `interpretation_rules`
- `development_actions`
- `reflection_prompts`

### Assessment delivery

- `assessment_attempts`
- `responses`
- `response_events`

### Quality and scoring

- `quality_flags`
- `score_results`

### Reporting, growth, and pathways

- `reports`
- `report_sections`
- `growth_plans`
- `growth_priorities`
- `growth_goals`
- `growth_actions`
- `growth_reviews`
- `pathway_decisions`
- `pathway_reviews`

### Research and audit

- `research_exports`
- `audit_logs`

### Development only

- `dev_identity_credentials`

MongoDB validators enforce document shape, allowed enum values, required fields, age ranges, and several same-document consistency rules.

The backend also defines eight participant-safe research views and one internal candidate-score view through migrations.

## 16. Transactions and concurrency

MongoDB runs as a replica set because multi-document transactions are used heavily.

Transactions use:

- snapshot reads;
- majority writes;
- primary read preference;
- bounded retry for transient MongoDB transaction errors.

State changes use compare-and-set logic. For example, changing an attempt from `SUBMITTED` to `SCORING` includes `SUBMITTED` in the update filter. If another request already changed it, the stale update changes nothing.

This prevents common race conditions without trusting the order in which requests arrive.

## 17. Audit trail

Important actions write an `audit_logs` record, often in the same transaction as the change.

Examples include:

- participant registration;
- attempt creation and submission;
- consent transitions;
- institution and cohort changes;
- participant suspension;
- release-switch changes;
- quality and scoring completion;
- report generation and retry;
- credential reset.

Audit records are append-only. Sensitive values such as passwords, OTPs, and authorization tokens should never be placed in audit data or logs.

Each API request receives an `X-Correlation-Id`. A valid incoming ID is reused; otherwise the server generates one. This helps connect one HTTP request to related audit events and errors.

## 18. Error format

The API returns errors in a consistent JSON structure:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": {}
  }
}
```

Common statuses:

| Status | Typical meaning |
|---|---|
| `400` | Invalid JSON or request validation failure |
| `401` | Missing, invalid, or expired authentication |
| `403` | Authenticated but not allowed, or consent gate closed |
| `404` | Record is not visible or does not exist |
| `409` | State conflict, duplicate operation, or idempotency conflict |
| `413` | Uploaded file is too large |
| `422` | Business-rule validation failure |
| `429` | Rate limit reached |
| `500` | Unexpected internal failure |
| `503` | Database/configuration safety requirement is unavailable |

Unknown errors are logged on the server, but the client receives a generic message.

## 19. Main API groups

Every route below is prefixed with `/api/v1`.

### Health

- `GET /health`

There is also a basic process health route at `GET /health` without the `/api/v1` prefix. The API health route checks database readiness.

### Authentication

- `POST /auth/request-otp`
- `POST /auth/verify-otp`
- `POST /auth/login`
- `POST /auth/set-password`
- `POST /admin/participants/:id/credential-reset`

### Registration

- `POST /registration/route`
- `POST /registrations/open`
- `POST /registrations/institutional`
- `POST /participants/age-declaration`
- `GET /registration/state`

### Consent

- `GET /consents/requirements`
- `GET /consents/gate`
- `POST /consents`
- `POST /consents/self-consent`
- `POST /consents/minor-self-service`
- `POST /consents/:id/grant`
- `POST /consents/:id/verify`
- `POST /consents/:id/withdraw`

### Assessment delivery

- `POST /attempts`
- `GET /attempts/:id`
- `GET /attempts/:id/items`
- `GET /attempts/:id/responses`
- `POST /attempts/:id/sessions/resume`
- `POST /attempts/:id/responses`
- `POST /attempts/:id/pause`
- `POST /attempts/:id/submit`

### Reports and growth

- `GET /reports/:id`
- `GET /growth-plans/:id`
- `POST /growth-plans/:id/priorities`
- `POST /growth-plans/:id/goals`
- `POST /growth-plans/:id/reviews`

### Question sets and release switches

- `GET /admin/question-sets/template`
- `POST /admin/question-sets`
- `GET /admin/question-sets`
- `GET /admin/question-sets/:id`
- `POST /admin/question-sets/:id/freeze`
- `POST /admin/question-sets/:id/open`
- `POST /admin/question-sets/:id/close`
- `POST /admin/question-sets/:id/delete`
- `GET /admin/release-flags`
- `POST /admin/release-flags/:flag`

### Admin operations

- assessment control;
- institutions and cohorts;
- participants and credential resets;
- roster import and one-time credential export;
- monitoring summary;
- submissions;
- quality-flag review;
- audit-log search.

The exact methods and paths are easiest to read in `src/routes/v1/santulan.routes.js`.

### Research exports

- `POST /research-exports`
- `GET /research-exports`
- `GET /research-exports/:id`
- `GET /research-exports/:id/download`

### Internal engine endpoints

- quality;
- scoring;
- safeguarding;
- report generation and retry;
- pathway decisions.

These routes require the internal API key or, where explicitly allowed, a Super Admin token.

## 20. Important configuration

Copy values from `backend/.env.example` into the git-ignored `backend/.env`.

| Variable | Meaning |
|---|---|
| `APP_PORT` | API port, default `8000` |
| `APP_ENV` | `development`, `test`, or `production` |
| `CORS_ORIGINS` | Comma-separated browser origins allowed to call the API |
| `JWT_SECRET` | Signs session tokens; must be changed in production |
| `JWT_EXPIRES_IN` | Session duration, default `2h` |
| `MONGODB_URI_RUNTIME` | Least-privilege MongoDB URI used by API and workers |
| `MONGODB_URI_ADMIN` | Admin MongoDB URI used only by scripts and tests |
| `MONGODB_DB` | Main database name, default `santulan` |
| `MONGODB_TEST_DB` | Scratch test database name |
| `INTERNAL_API_KEY` | Protects internal engine routes |
| `IDENTITY_PROVIDER` | Identity adapter; currently `dev` locally |
| `CONSENT_PROTOCOLS_PATH` | Approved consent protocol configuration |
| `QUALITY_POLICY_PATH` | Quality detector policy |
| `EVIDENCE_CONFIG_PATH` | Evidence state configuration |
| `GROWTH_RANKING_PATH` | Growth-priority ranking configuration |
| `EXPORT_DIR` | Protected research export directory |
| `SCORING_VERSION` | Version stamped on score results |
| `REPORT_VERSION` | Version stamped on reports |
| `PATHWAY_POLICY_VERSION` | Version stamped on pathway decisions |
| `SESSION_INACTIVITY_MINUTES` | Enables inactivity pausing when set to a positive number |
| `SCORING_PIPELINE` | Set to `on` to run quality/scoring worker |
| `REPORT_WORKER` | Set to `on` to run report worker |
| `EXPORT_WORKER` | Set to `on` to run export worker |

Do not commit real secrets or the local `.env` file.

## 21. Release switches

The backend has four governed switches:

- `pilotS2`
- `advancedEvidence`
- `developmentRelease`
- `pathwayRelease`

All are off by default. The latest audit event determines each value. An unknown or missing value is treated as off.

Every change requires a reason and is audited in the same transaction.

## 22. Running locally

From the repository root:

```bash
cd backend
npm install
npm run db:local:init -- --write-env
npm run db:local:status
npm run db:migrate
npm run db:seed:reference
npm run db:seed:dev
npm run db:verify
npm run dev
```

The dedicated local MongoDB instance uses port `27018`, not the normal Windows MongoDB service on `27017`.

Useful database commands:

```bash
npm run db:local:start
npm run db:local:stop
npm run db:local:status
npm run db:migrate
npm run db:verify
```

The API should be available at:

```text
http://localhost:8000
http://localhost:8000/api/v1/health
```

## 23. Development accounts

`npm run db:seed:dev` creates synthetic development accounts. Current credentials are documented in the root `README.md` and defined by the development seeder.

Never use those credentials in production. The development identity provider refuses to run when `APP_ENV=production`.

## 24. Tests

Run the full backend suite with:

```bash
cd backend
npm run test:santulan
```

Run one test area with a path filter:

```bash
npm run test:santulan -- tests/santulan/domain
npm run test:santulan -- tests/santulan/contract
npm run test:santulan -- tests/santulan/integration
```

Test folders have different purposes:

| Folder | Purpose |
|---|---|
| `unit/` | Small isolated functions such as parsing and scoring math |
| `domain/` | Pure business rules and state decisions |
| `contract/` | HTTP endpoint behavior using Supertest |
| `integration/` | Multi-layer workflows with the real scratch database |
| `store/` | Validators, indexes, permissions, transactions, and scope isolation |
| `security/` | Abuse cases, isolation, claims, and platform protections |
| `helpers/` | Shared test setup and fixtures |
| `evidence/` | Test evidence reporting |

Tests use a scratch database whose name must include `test`, `qual`, or `scratch`. This guard reduces the chance of accidentally rebuilding a real database.

## 25. Database migrations

Migrations live in `backend/db/migrations/` and run in numeric order.

They create:

1. collections and validators;
2. indexes;
3. research views;
4. the runtime database role.

Applied migrations are recorded with a SHA-256 hash. Do not edit an already applied migration. Add a new numbered migration and update the data-model version when the schema changes.

The API reads only `MONGODB_URI_RUNTIME`. Scripts and tests may read `MONGODB_URI_ADMIN`.

## 26. How to debug a request

Use this routine when something is difficult to understand:

1. Find the frontend call in `frontend/src/services/santulanApi.js`.
2. Copy the path, such as `/admin/institutions`.
3. Search that path in `backend/src/routes/v1/santulan.routes.js`.
4. Note every middleware before the controller.
5. Open the named controller method.
6. Follow the service function called by the controller.
7. Read any imported file from `services/domain/` to understand legal states.
8. Follow repository calls or `tx.c.<collection>` operations.
9. Check `models/db/access.js` when a record is unexpectedly invisible or a write is forbidden.
10. Check the relevant contract, domain, or integration test for an executable example.

For errors, record:

- HTTP status;
- `error.code`;
- `error.message`;
- `X-Correlation-Id` response header;
- server log at the same time;
- current state of the attempt, consent, set, report, or export.

## 27. How to add a backend endpoint

A normal feature change should follow this order:

1. Add or update pure rules in `services/domain/`.
2. Add repository operations only when an existing repository does not already provide them.
3. Implement the business process in the correct feature service.
4. Add a thin controller function and strict Zod schema.
5. Register the route with the correct authorization middleware.
6. Add audit writing when the operation changes governed state.
7. Use a transaction when several records must change together.
8. Add domain tests for rules.
9. Add contract tests for HTTP behavior.
10. Add integration/store/security tests when the change crosses those boundaries.

Do not:

- query MongoDB directly from a controller;
- trust a participant ID, score, database scope, or version sent by the browser;
- add an unrestricted update method;
- expose partial reports or internal quality details;
- bypass the scoped store;
- edit an applied migration;
- silently choose legal, evidence, or quality thresholds.

## 28. Common sources of confusion

### "Why are there so many files for one feature?"

Each layer protects a different concern. The route protects entry, the controller handles HTTP, the service coordinates work, domain rules decide legality, repositories describe data operations, and the scoped store enforces access.

### "Why can I not find a model class?"

This project does not use Mongoose. A "model" is spread across schema definitions, repositories, and scoped collection rules.

### "Why does a valid request return 404?"

A scoped lookup deliberately makes inaccessible data look missing. A participant asking for another participant's report should not learn that it exists.

### "Why is a worker not processing submitted attempts?"

Check whether `SCORING_PIPELINE=on` and `REPORT_WORKER=on`. Both are disabled otherwise. Also check governed configuration files and current attempt/report state.

### "Why does the server refuse to start?"

Common reasons are:

- missing `MONGODB_URI_RUNTIME`;
- MongoDB is not running;
- connected with the wrong database user;
- MongoDB is not a replica set;
- migrations were not applied;
- database data-model version does not match the code.

### "Why does report generation fail even after scoring?"

Required approved wording may be missing. The report intentionally fails closed rather than showing incomplete or invented text.

### "Why does the same write have an idempotency key?"

Browsers and networks retry requests. Idempotency makes the retry return the same logical result instead of creating duplicate registrations, answers, submissions, or exports.

## 29. Recommended reading order

Do not begin with every schema and worker. Use this order:

1. `backend/src/app.js`
2. `backend/src/server.js`
3. `backend/src/routes/v1/santulan.routes.js`
4. one controller related to your task
5. the service called by that controller
6. the imported domain-rule file
7. the repository used by the service
8. `backend/src/models/db/access.js`
9. the matching test file

For the file currently open in the editor, use:

```text
controllers/admin.controller.js
  -> services/admin/<matching feature service>.js
  -> services/domain/adminRules.js
  -> models/repositories/* or tx.c.*
  -> models/db/access.js
```

## 30. Final mental model

When reading this backend, remember:

```text
Routes say WHO may call and WHAT input is accepted.
Controllers translate HTTP.
Services perform the use case.
Domain files decide WHAT IS LEGAL.
Repositories describe data operations.
The scoped store decides WHAT DATA IS VISIBLE OR WRITABLE.
MongoDB validators and indexes provide the final safety net.
Workers continue long-running workflows after submission.
Tests show the intended behavior.
```

You do not need to understand the entire backend before making progress. Pick one endpoint, trace it through these layers, and treat the state-machine file as the source of truth for allowed behavior.
