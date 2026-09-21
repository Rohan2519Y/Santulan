# Research: Document Database Only Platform and Spreadsheet Question Upload

**Feature**: 006-mongodb-question-upload | **Date**: 2026-09-20 | **Plan**: [plan.md](plan.md)

Every unknown in the plan's Technical Context is resolved here. Facts marked **[verified]** were checked on this machine (MongoDB 8.0.10, local install, Node v24.13.1) or against the official MongoDB documentation on 2026-09-20; nothing marked verified is from memory. Numbers use the prefix `R-M` so they do not collide with feature 005's `R-01…R-18`. Owner decisions that need a yes/no are gathered in the plan's *Decision register* (`D-M01…`).

---

## R-M01 — Where MongoDB runs (local, no Docker)

**Findings [verified]**

| Check | Result |
|-------|--------|
| Installed | MongoDB Server **8.0.10** (`C:\Program Files\MongoDB\Server\8.0`), `mongosh`, and Database Tools (`mongodump`, `mongorestore`) |
| Running | Windows service `MongoDB`, `127.0.0.1:27017` |
| Topology | **Standalone** — `db.hello()` has no `setName` |
| Access control | **Off** — `listDatabases` succeeds with no credentials |
| Other data | The service already holds other databases (`CompanyDatabase`, `Employee`, …) that belong to other work |
| Transactions | Official docs: multi-document transactions are **not available on a standalone**; they need a replica set (a single node is valid) |
| Auth on a replica set | Official docs: enabling access control on a replica set **requires a keyFile or x.509** (a single-node set with a keyFile is valid) |

So the installed service as it stands can give neither the atomic multi-step actions (constitution V, spec FR-007) nor the least-privilege credential (constitution IX).

**Decision**: run a **second, dedicated local `mongod` process** from the same installation for Santulan — port **27018**, its own data directory, config file and keyFile under `backend/.mongo/` (git-ignored), configured as a **single-node replica set `rs0` with authorization on**. A script (`backend/scripts/mongo-local.js`: `init | start | stop | status`) creates the config and keyFile, starts the process with `mongod --config …`, initiates the replica set and creates the users. No Docker anywhere. The existing `MongoDB` service on 27017 is never touched or reconfigured.

**Rationale**: it meets the owner's instruction (local install, no Docker), gives the guarantees the constitution requires, and cannot disturb the other databases on 27017.

**Alternatives considered**
- *Convert the existing 27017 service to a replica set with auth.* Rejected as the default: it needs a restart with a keyFile, turns authentication on for every database on that instance, and would break any of the owner's other applications that connect without credentials. Offered as decision **D-M01** if the owner prefers one instance.
- *Docker.* Rejected — the owner said not to use it.
- *`mongodb-memory-server`.* Rejected for guarantee evidence: it downloads its own binaries, is ephemeral, and is not the local install; the constitution requires evidence from a live deployment that provides the atomicity and access controls. (It could still be used for throw-away unit tests; not planned.)
- *Managed cloud cluster.* Out of scope for the local pilot.

**Operational notes for the quickstart**: on Windows the keyFile permission check is not enforced; the process can be run in a terminal or installed as a second Windows service (`mongod --config … --install --serviceName SantulanMongo`, needs an elevated shell); use `127.0.0.1` in the replica-set member host (MongoDB 5.0+ wants hostnames, and `127.0.0.1` with a loopback-only bind is accepted — **[verified]** on the probe).

---

## R-M02 — Driver and libraries

**Decision**: the official **`mongodb` Node driver 7.6.0** (**[verified]** `npm view`: engines `node >=20.19.0`; the machine has 24.13.1). No ODM (no Mongoose). `zod` stays for request validation; **the store's own `$jsonSchema` validators are the authority** for stored shape. `xlsx` (SheetJS 0.20.3, already a dependency) parses uploads. `exceljs` **4.4.0** is added for streaming export (decision D-12, already planned in feature 005 T147). The `pg` dependency is removed; `bcryptjs`, `jsonwebtoken`, `multer`, `express`, `cors`, `dotenv`, `uuid` and `zod` stay.

**Rationale**: an ODM would hide the store behaviour that the constitution needs explicit (validation, indexes, transactions, error codes) and would encourage schema-less convenience over the documented model. The previous code used raw `pg` for the same reason.

**Alternatives**: Mongoose (rejected — hides validators/indexes behind its own schema layer, which would be a second source of truth); Prisma (needs a replica set and generates its own model — same objection).

---

## R-M03 — What the store can and cannot enforce [verified by probe]

A throw-away **single-node replica set with authorization and a keyFile** was started from the local `mongod.exe` on a spare port with its own temp directory, exercised with an admin user and a least-privilege runtime user, then stopped and deleted (the owner's 27017 service was untouched). Results:

| Question | Result on MongoDB 8.0.10 |
|----------|--------------------------|
| `$in` in a partial **unique** index filter | **Supported** (so "one non-terminal attempt per participant" is a real unique index) |
| `$nin` / `$ne` in a partial filter | **Rejected** (`CannotCreateIndex`) — every "NOT IN" rule must be written as a positive `$in` list |
| `$type: 'string'` partial filter (SQL `IS NOT NULL` uniqueness) | Works; documents without the field are exempt from uniqueness |
| Validator `$jsonSchema` with `additionalProperties:false` | Undeclared field rejected (code 121) |
| Validator with `$expr` (derived-field consistency, e.g. `is_minor == age < 18`) | Enforced on **insert and update** (code 121) |
| Runtime role with only `find/insert` on a collection | `update`, `remove` → **Unauthorized** (append-only is real) |
| Runtime role with `find/insert/update` | `update` allowed; `remove` **Unauthorized** |
| `createIndex`, `collMod` (drop the validator), `drop`, `createCollection` as runtime | **Unauthorized** |
| Read-only **view** as research-safe projection | `find` on the view allowed with **no** rights on the underlying collection; writes to the view denied |
| Transaction commit across two collections | Both persist |
| Transaction abort | Neither persists |
| Validator failure inside a transaction | Transaction aborts; the earlier write in the same transaction is not leaked |
| Compare-and-set (`updateOne({_id, status: from}, {$set:{status: to}})`) | Matches nothing on a wrong from-state (`modifiedCount 0`) — usable for state machines |

**What MongoDB cannot do** (no foreign keys, no triggers, no field-level privileges, no old-vs-new comparison in a validator):
- reference existence (`participant_id` must exist),
- cross-document rules (cohort belongs to the participant's institution; consent gate at attempt creation; an answered item belongs to the attempt's question set; score/report provenance),
- field-level immutability inside a mutable collection (e.g. only `is_current` may change on a response),
- state-machine transitions (a validator sees only the new document).

These are the **application-enforced invariants** listed in [data-model.md](data-model.md) §7. They are the honest gap in constitution Principle III bullet 3 and are recorded, with mitigations, in the plan's *Complexity Tracking* (D-M06).

---

## R-M04 — Immutability tiers and the credential model (constitution IV, IX)

**Decision**: two database users and three collection tiers.

| Credential | Rights | Used by |
|------------|--------|---------|
| `santulan_migrator` | `dbOwner` on the Santulan database only (create collections, validators, indexes, views; drop in test databases) | data-model migrations, the scratch-database script, test cleanup, backup/restore drill. **The running application never holds it.** |
| `santulan_runtime` | custom role `santulan_runtime` | the API and workers |

| Tier | Runtime privileges | Collections |
|------|--------------------|-------------|
| **A — append-only** | `find`, `insert` | `audit_logs`, `score_results`, `response_events`, `items` (questions with their embedded options), `participant_cohort_history`, `growth_reviews`, `pathway_decisions`, `pathway_reviews` |
| **B — governed mutation** | `find`, `insert`, `update` | collections where the contracts allow a named mutation: `participants`, `consents`, `assessment_versions` (draft→frozen, open/close), `assessment_attempts`, `responses` (`is_current` retirement), `quality_flags` (disposition), `reports` (state), `report_sections` (release flag), `growth_plans`/`growth_priorities`/`growth_goals`/`growth_actions`, `research_exports`, `institutions`, `cohorts`, `admin_users`, `interpretation_rules`, `development_actions`, `reflection_prompts` |
| **View** | `find` only | `v_research_*` (research-safe projections, see R-M11) |

**No collection grants `remove` to the runtime credential** — there is no deletion path anywhere (constitution III "no deletion path"; retirement is by status). Draft question sets are superseded by a new revision, never deleted (R-M09). Report generation never needs a delete: a failed render writes its sections in a transaction that aborts, then records `FAILED_RETRYABLE` separately. Test clean-up uses the migrator credential.

**Rationale**: Tier A makes score, audit, event and question immutability true at the store, not by convention. Tier B is the smallest privilege that lets the contracts' permitted mutations happen; the data-access layer exposes only those mutations (R-M05).

**Alternatives**: one all-powerful application user (rejected — violates IX); per-operation stored procedures (MongoDB has none); separate worker user (rejected — one runtime credential plus scoped access layer is simpler, and the worker/participant distinction is a *scope*, not a credential).

**Residual risk, accepted and recorded (D-M02)**: `responses.is_current` needs `update` on `responses`, and MongoDB privileges are per collection, not per field, so the store cannot stop a compromised application from editing `response_value`. Compensations: the access layer has a single `retireCurrent` operation; a test scans that no other update to `responses` exists; a nightly integrity check recomputes answer hashes. An alternative that removes the risk (derive "current" from a supersedes chain and keep `responses` in Tier A) is described in the data model and offered as D-M02; it changes a BUILD 01 field, so it needs the owner's approval.

---

## R-M05 — Scoped data-access layer (the row-level-security replacement) (constitution IX)

**Decision**: one module, `backend/src/modules/santulan/store/`, is the **only** code that imports the driver. It exports `withScope(scope, fn, { transaction })`. The `scope` is a frozen object `{ actorScope, participantId, adminUserId, institutionId }` built from the **verified session** by middleware — never from the request body/query. `fn` receives repositories (one per entity) whose read methods always AND a scope filter onto the query and whose write methods refuse to run without the matching scope.

Scope rules (translating the previous RLS policies):
- `PARTICIPANT` → `participant_id == scope.participantId` (own attempts, answers, scores that are participant-visible, released report sections, own consents, own growth data); `PARTICIPANT` can read reference content but not other participants, admin users, exports or audit logs.
- `INSTITUTION_ADMIN` (reserved/inactive in the pilot) → exact non-null `institution_id == scope.institutionId`; `null` never matches.
- `SUPER_ADMIN` / `SYSTEM` → privileged; still passes through the repositories (so audit and permitted-mutation rules apply).
- **No scope → no data** (fail closed): a missing or unknown scope returns empty results / throws, never all rows.
- Scope is **request-scoped** (passed explicitly, no module-level state), so it cannot leak between concurrent requests — the Mongo equivalent of the "pooled connection" test SEC-11.

Enforcement of the rule that no code bypasses the layer: a repository-scan test fails the build if any file outside `store/` imports `mongodb` or calls `.collection(`; the runtime credential can't write anywhere it shouldn't anyway (R-M04).

**Alternatives**: Mongo views per tenant (rejected — views are static, not per-request); one database per institution (rejected — violates the single canonical model, and OPEN participants have no institution); trusting each route to add its own filter (rejected — the failure mode is silent).

---

## R-M06 — Atomicity, concurrency and idempotency (constitution V)

**Decision**
- Multi-step actions run in **one transaction** via the driver's `session.withTransaction` (automatic retry on `TransientTransactionError` / `UnknownTransactionCommitResult`) with `readConcern: snapshot`, `writeConcern: majority`, `readPreference: primary`. Default 60 s lifetime is ample; the largest transaction (a 500-question upload) writes ≈ 505 documents.
- **State machines** use **compare-and-set**: `updateOne({ _id, status: <expected> }, { $set: { status: <next>, … } })`; `modifiedCount === 0` means someone else moved it → conflict (409/422), never a blind overwrite. **[verified]**
- **Serialisation that PostgreSQL did with advisory locks** (one save per attempt/item, one report per attempt, one score run per attempt) is done by **unique indexes** (`uq_response_version`, `uq_current_response`, `uq_one_nonterminal_attempt_per_participant`, one report per attempt, unique idempotency keys) plus transaction write-conflict retry: the loser gets a duplicate-key (`11000`) or write-conflict error, which the layer maps to the same API codes as before (`RESPONSE_KEY_CONFLICT`, `INVALID_STATE`, idempotent replay).
- **Idempotency** keeps its earlier design (R-04/D-09): a key hash stored on an `audit_logs` row (registration, exports) or a unique field on the record itself (answers, submissions).
- **Fail-closed audit**: the audit insert is inside the same transaction as the mutation; if it fails the transaction aborts.
- **A failed write inside a MongoDB transaction aborts the whole transaction** **[verified]** (there are no SQL savepoints). Where feature 005 used a savepoint to keep a report shell after a render failure, the new code uses **two transactions**: sections + completion in the first (aborted on failure), then the `FAILED_RETRYABLE` marker in the second.

**Error mapping** (`store/errors.js`): `11000` (duplicate key) → by index name to the earlier API codes; `121` (validator) → `VALIDATION_ERROR`/`INVALID_STATE` by collection; `13 Unauthorized` → 403 + alert log (it means a code path tried something the credential forbids); transient/network → 503 and the operation refuses rather than guessing.

---

## R-M07 — Test strategy on MongoDB

- **Real deployment**: tests run against the dedicated local instance (R-M01), scratch database `santulan_qual` (the harness keeps refusing database names that do not contain `test`, `qual` or `scratch`).
- **No rolled-back-by-default harness**: feature 005's suites relied on `BEGIN … ROLLBACK` and on savepoints to assert several refusals in one test. In MongoDB a failed write aborts the transaction, so store-level refusal tests (validators, unique indexes, privileges) run **outside** transactions with uniquely prefixed fixtures and clean up through the migrator credential. Domain-rule and contract tests use the same committed-fixtures pattern feature 005 already used for HTTP suites.
- **Two credentials in tests**: the migrator for fixtures/cleanup; the **runtime** credential for everything under test, so a privilege regression fails a test (e.g. "runtime cannot `remove`", "runtime cannot update `audit_logs`").
- Suites keep their matrix IDs (T03/T04/B05–B08/AT/RC/SEC) so the evidence reporter and the AT/RC/SEC traceability check carry over; **evidence from the PostgreSQL run does not count** (constitution X, spec FR-039).
- Unit suites for pure rules (routing, scoring math, partition arithmetic, upload validation, ranking) need no database.

---

## R-M08 — Variable options and scoring (spec FR-014, A-5, A-7)

**Decision**: a question stores an ordered list of **options** `[ { position: 1, text }, … ]` (2–20). An answer stores `response_value` = the chosen option's **position** as a string (`"1"`…`"n"`); the server checks `1 ≤ position ≤ option_count` of **that question**.

Scoring converts position to the common scale, evenly spaced:

```text
score(position, n) = 1 + (position − 1) × 4 ÷ (n − 1)      n = number of options of that question, n ≥ 2
n = 5  → 1, 2, 3, 4, 5        (identical to today)
n = 3  → 1, 3, 5              n = 2 → 1, 5
```

Domain mean, completeness, missingness (≥ 20 % → no participant interpretation; ≥ 40 % → no raw score), `numeric(4,2)` rounding and keying (`Positive` only; `REVERSE` still hard-fails) are unchanged. Because evidence state defaults to **S1 (research only)** for any new set, an unapproved rescaling cannot reach participants until the owner and psychometrics promote it (constitution VII). Pure function, unit-tested at n = 2, 3, 4, 5, 9, 20.

**Alternatives**: store a numeric score per option (spec option C — rejected as default, would enlarge the sheet); exclude non-5-option questions from scores (spec option B — rejected: makes uploaded sets unusable).

**Alignment with the scoring master**: the completeness statuses, exact boundaries, evidence rules, quality flags, report composition and release switches are specified in [contracts/scoring-and-report.md](contracts/scoring-and-report.md) and summarised in R-M19.

---

## R-M09 — Upload pipeline (spec FR-011…FR-018, FR-022)

**Decisions**
1. **Transport**: `POST /api/v1/admin/question-sets` multipart (`file` + `ageGroup` field), Super Admin only, `multer` memory storage limited to **2 MB**; extension and magic bytes must be a ZIP-based `.xlsx`.
2. **Parse safely**: SheetJS `read` from a buffer with `sheetRows: 502` (header + 500 questions + 1 to detect overflow), no macros (`bookVBA:false` default), no external links, `cellFormula` read so that **formula cells are detected and rejected** (`FORMULA_NOT_ALLOWED`) — a value that merely *starts* with `=`/`+`/`-`/`@` but is stored as text is legitimate content and is kept as plain text, then escaped again on export (R-M11).
3. **Sheet choice**: sheet `01_Items`, else the first sheet (as the old contract allowed).
4. **All-or-nothing**: validate every row and collect **all** errors (cap 200 returned, with a total count) before any write; on success write the whole set in **one transaction** (`assessment_versions` + up to 500 `items` + an audit row).
5. **Identity of a set**: `assessment_version` (label) must be identical on every row; pattern `^[a-z0-9][a-z0-9._-]{2,63}$`. Content hash = SHA-256 of the canonical, key-sorted JSON of the questions and options (independent of file bytes/formatting), so re-uploading the same content is a **no-op** (returns the existing set) and a different file with the same content is too.
6. **Revisions, no deletes**: different content under an existing **DRAFT** label creates `revision + 1`; the previous revision is marked `SUPERSEDED` (status only). A label that is `FROZEN` or `RETIRED` is refused (`SET_NOT_DRAFT`).
7. **Old format rejected**: a file without option columns fails with `OLD_FORMAT_NOT_SUPPORTED` and the template link (a question with `< 2` options is `OPTIONS_TOO_FEW`).
8. **Audit record** (the "upload record" of constitution III): an `audit_logs` row `QUESTION_SET_UPLOADED` / `QUESTION_SET_UPLOAD_REJECTED` with file name, SHA-256 of the file, age group, counts, and (for rejections) the first 20 error codes — no participant data. Rejected uploads write only this row.
9. **Template**: `GET /api/v1/admin/question-sets/template` returns a generated workbook (header + 3 example rows using the 5-point labels) — generated, not stored.
10. **Conversion helper** (FR-021): `scripts/questions-convert-catalog.js` reads the two frozen `TECH_READY` files / the BUILD 02 canonical sheets and writes new-format workbooks with the five standard options; its output uploads without errors (acceptance test SC-014).

**Rationale**: parsing is bounded (memory/CPU), errors are actionable, idempotent, and nothing ever half-saves.

---

## R-M10 — Freeze, open and the one-open-set rule (spec FR-018, constitution II)

**Decision**: a set moves `DRAFT → FROZEN` (records `frozen_at`, recomputes and stores `content_hash`), then `participation_state CLOSED → OPEN`. **Store-enforced** "at most one open set per age group": unique **partial** index on `assessment_versions { age_group: 1 }` where `participation_state: 'OPEN'` (equality filter — supported **[verified]**). Opening a second set for the same age group is refused until the first is closed (the admin closes/stops, then opens the new set) — a deliberate two-step so a switch is always visible in the audit trail. Because `items` is Tier A, question content can never change after insert; `content_hash` is verified at open time, at server start, and by `scripts/db-verify.js` — a mismatch is a hard stop (constitution I). The control-plane stop/reopen (audited event) is separate from the set's `participation_state`, as in feature 005 (R-18).

Routing: a participant is offered the **single open set of their age group**; if none is open the attempt is refused with `ASSESSMENT_NOT_OPEN`. The chosen set is stored on the attempt and never re-derived (constitution II).

---

## R-M11 — Research export on MongoDB (feature 005 US8 carried over)

- **Research-safe projections** are **read-only MongoDB views** (`v_research_participants`, `_attempts`, `_item_responses`, `_domain_scores`, `_quality_flags`, `_response_events`, `_assessment_versions`, `_cohorts`) built with `$project`/`$lookup`; the runtime role has `find` on the views only for the export path (the export worker is the only caller), and the views simply do not contain `participant_id` (private), `auth_provider*`, `external_student_id`, contact or guardian data. **[verified]** that a view can be read without rights on its source.
- **Streaming**: a cursor per sheet feeds `exceljs` `stream.xlsx.WorkbookWriter` writing to a temp file in `EXPORT_DIR`; `ITEM_RESPONSES_nn` sheets open dynamically at 1,048,575 data rows; cells beginning `= + - @ \t \r` are prefixed; sheet names are constants; long metadata truncated with a marker; **Ready only after the file is closed and moved**, otherwise `FAILED` and the partial file removed.
- **Lifecycle** (`REQUESTED → GENERATING → READY | FAILED`) with compare-and-set claims, so two workers cannot claim the same export and ready/failed cannot both win; download audited in the same transaction as the lookup, so an audit failure blocks the download.
- **Filters** (`institutionId`, `cohortId`, `participantStatus`, `dateFrom`, `dateTo`, `includeAllVersions`) come from a whitelist; unknown keys → `EXPORT_FILTER_UNKNOWN`; the filter is applied in every sheet's aggregation, not only the participants sheet.
- **Withdrawn participants**: excluded by default and counted in `EXPORT_METADATA` (the approved pseudonymisation protocol is still an owner decision — B08-AUD-012).
- **Scale test**: a synthetic generator (`scripts/export-synthetic.js`) seeds 10,000 × 222 answers into the scratch database only, exports, and reconciles rows (spec SC-010).

---

## R-M12 — Backup and restore (constitution IX; spec FR-037)

**Decision**: `mongodump --uri … --archive=<file> --gzip` and `mongorestore --archive --gzip --drop` (from the installed Database Tools **[verified present]**) driven by `scripts/backup-restore-drill.js`: dump the source database, restore into a clean scratch database, then run the integrity check (`db-verify.js`), the store-guarantee suite and a smoke journey against the restored copy, and write an evidence file (operator, timestamps, hashes, PASS/FAIL). Dumps of real participant data are never committed (git-ignored `backend/backups/`); the existing PostgreSQL dump there is left untouched (spec A-3).

---

## R-M13 — Reference content that is not questions (feature 005 T041–T043 replaced)

The catalog pipeline is retired, but the platform still needs reference content: the **72-subdomain framework map** (validation of uploaded domain/subdomain codes), the **216-action Development Action Library** (all inactive), the **72 reflection prompts** (draft), and empty `interpretation_rules`. Decision: `seeders/santulan/reference/` holds the framework map (`framework.json`, generated once from the canonical reference CSV) and `scripts/seed-reference.js` loads actions and prompts from `docs/Santulan_Development_Reporting_MASTER_System_v1_1.xlsx` with the same counting guards as before (exactly 216 and 72, every subdomain × Foundation/Practice/Transfer once). `scripts/db-verify.js` re-checks counts and defaults (all actions inactive, all prompts draft, no rules). No question is seeded.

---

## R-M14 — Cut-over and removal of SQL

**Decision**: no data migration (spec A-3). Build the new store and domain layers beside the old code, **port one module at a time** (each ported module's tests move to the new harness in the same step), and delete every SQL artefact only in the final phase, so the repository is never left with a half-working mix that nobody can explain:

Removed at the end: `backend/migrations/` (17 files), `scripts/migrate.js`, `santulan-grant-roles.js`, `santulan-scratch-db.js` (replaced), `santulan-generate-seed-sql.js`, the catalog CSV/reconcile/freeze/verify pipeline and `seeders/santulan/*.csv`+`MANIFEST.json`, `docker/init-app-role.sql`, `shared/db.js`, the `pg` dependency, the `dev_identity` PostgreSQL schema, `RUNTIME_DATABASE_URL`/`PLATFORM_DATABASE_URL`/`DATABASE_URL` (replaced by `MONGODB_*`), and PostgreSQL wording in READMEs. Historical spec documents keep a banner instead of being rewritten.

**Risk**: the port touches ≈ 40 source files (≈ 3,100 lines) and re-expresses ≈ 2,900 lines of SQL (much of it business rules in triggers/functions) as tested application code, plus 32 test files. Mitigation: the SQL is the executable spec for every rule; each function/trigger gets a named rule module and a test carrying the original matrix ID; the port order (plan §Delivery) keeps a runnable system at every step.

---

## R-M15 — Frontend changes

Small and contained: (1) the assessment player renders **the question's own options** (radio group, order as uploaded, accessible names, no correct/incorrect cues) instead of the fixed 5-point component; `GET /attempts/{id}/items` returns `options` per item; the save payload sends `value` = option position; (2) a **Question sets** admin page (upload with age group, validation report table, template download, list, freeze/open/stop) replaces the dead item-pool page; (3) the rest of the admin pages carried over from feature 005 (participants, institutions, monitoring, exports, audit) as planned there. (4) the participant **Results** page stops calling the withdrawn score endpoint and draws the seven-axis chart from the report's PROFILE payload, showing "Not enough data yet" for unplotted domains (R-M19). Participant registration/consent/dashboard screens are unchanged.

---

## R-M16 — Local sign-in credentials (was decision D-17)

Development credentials keep their design (bcrypt hashes, outside the canonical entities, refuses production) but move to a MongoDB collection `dev_identity_credentials` (Tier B, runtime `find/insert/update`), created by the migrator; the dev seeder recreates the three synthetic accounts. OTPs remain in memory.

---

## R-M17 — Configuration keys

New: `MONGODB_URI_RUNTIME` (least-privilege user), `MONGODB_URI_ADMIN` (migrator; scripts/tests only, never in the API process environment), `MONGODB_DB` (default `santulan`), `MONGODB_TEST_DB` (default `santulan_qual`). Removed: `DATABASE_URL`, `RUNTIME_DATABASE_URL`, `PLATFORM_DATABASE_URL`. Unchanged: `INTERNAL_API_KEY`, `JWT_*`, governed-config paths, throttle limits, `EXPORT_DIR`, `SCORING_*`, `REPORT_*`, `GROWTH_RANKING_PATH`, `PATHWAY_POLICY_VERSION`. The four release switches are **not** configuration: they are audited events (R-M19); `EVIDENCE_CONFIG_PATH` now only *holds* (`SH`) or *pins* (`S1`) domains. The API refuses to start if `MONGODB_URI_RUNTIME` is missing, if it authenticates as the migrator, or if the server is not a replica set (atomicity precondition) — fail closed.

---

## R-M18 — Carried-over work from feature 005 (spec A-12)

The 38 unfinished tasks map to phases 7, 9 and 10 of the plan (US8 T136–T155, US9 T156–T166, polish T167–T173). Each is re-expressed for MongoDB in `/speckit-tasks`; their matrix IDs (B08-001…084, AT-16/17/20/21/28/29/30, SEC-01…30, AT/RC traceability) stay the same. `T172` (legacy cut-over) is superseded by R-M14.

---

## R-M19 — Alignment with the Scoring & Report Generation master

The scoring master (`docs/Santulan_Scoring_and_Report_Generation_Layman_Master_Audit_ON_v1_0.docx`) was compared line by line with what feature 005 built and what this plan first said. Full contract: [contracts/scoring-and-report.md](contracts/scoring-and-report.md); discrepancy log in its §11.

**Confirmed unchanged**: seven domain means only; subdomains not participant-facing; current valid answers only; no imputation; Q06 hard stop → hold; Q09 never from a score and never leaked; S1 default; T11/T12 neutral copy; report lifecycle and retry without retake/rescore; hidden prescriptive layers; P5 exempt; immutable snapshots; positive keying only.

**Changed by this alignment**
1. *Exact status boundaries*: four `completeness_status` values with integer-arithmetic thresholds; **60 % is INSUFFICIENT** (BUILD 01's looser "raw score at 60 %" is dropped). Stored with eligible/valid counts so the result is auditable and BUILD 08's export columns exist.
2. *Store-level consistency*: because these are same-document facts, MongoDB `$expr` validators enforce status ↔ counts ↔ score ↔ evidence (data-model §4) — stricter than the SQL triggers of feature 005.
3. *Fail-closed wording*: an S2+ domain with no approved wording fails the whole report (retryable); previously it was skipped. With default switches nothing is at S2, so an empty library stays safe.
4. *Exactly one approved wording*: `interpretation_rules.layer` plus `uq_one_approved_rule_per_dimension` (a band-specific wording may coexist with a band-less one and wins).
5. *Report fingerprint* (`reports.content_hash`) and a PROFILE payload with per-domain neutral score, completeness and status plus a context snapshot.
6. *Release switches* as audited events with admin endpoints; the pilot-S2 switch is the global promotion gate.
7. *Participant exposure*: the score endpoint is withdrawn; scores reach participants only inside the released report.
8. *Q07* raised for INCOMPLETE/INSUFFICIENT domains; *Q05* stays inactive (discrepancy recorded).
9. `v_candidate_subdomain_scores` carried over as a research-only view (not granted to the runtime credential).

**Open items the master itself lists** (not engineering decisions): approved interpretation content (a per-question-set operational task now — wording is keyed to the set), Q01–Q04 thresholds, Q08/Q09 processes, S2 release approval, the RC0 report-composition gap (closed here by specifying the full descriptive composition).
