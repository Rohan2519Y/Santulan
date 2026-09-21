# Contract: MongoDB Deployment, Credentials and Store Guarantees

**Feature**: 006-mongodb-question-upload | **Constitution**: v3.0.0 III, IV, V, IX, X | **Data model**: [../data-model.md](../data-model.md) | **Research**: [../research.md](../research.md)

This is the checkable contract for everything the store must provide. Each numbered guarantee (G-nn) has at least one failing-first test; the test ID prefix is the matrix the guarantee came from.

## 1. Deployment

| Item | Contract |
|------|----------|
| Server | MongoDB **≥ 8.0** (local install, no Docker); the local install is 8.0.10 |
| Instance | **Dedicated** `mongod` for Santulan: port **27018**, `bindIp 127.0.0.1`, data in `backend/.mongo/data`, config `backend/.mongo/mongod.cfg`, keyFile `backend/.mongo/keyfile` (all git-ignored). The existing `MongoDB` service on 27017 is not used. |
| Topology | **Single-node replica set `rs0`** (required for transactions), `security.authorization: enabled`, `security.keyFile` set |
| Lifecycle script | `backend/scripts/mongo-local.js init|start|stop|status` — `init` writes the config and keyFile, starts `mongod`, runs `rs.initiate`, creates the admin, migrator and runtime users and prints the connection strings once |
| Databases | `santulan` (development/pilot), `santulan_qual` (tests; name must contain `test`, `qual` or `scratch` — the harness and the scratch script refuse any other name) |
| Start-up check | the API refuses to start unless: `MONGODB_URI_RUNTIME` is set; it authenticates as **`santulan_runtime`** (not the migrator or root); `hello().setName` exists (replica set); the data-model version marker equals the code's expected version (§3) |

## 2. Credentials

| User | Database | Roles | Held by |
|------|----------|-------|---------|
| `root_admin` | `admin` | `root` | the person setting up the instance; never used by the application or scripts after `init` |
| `santulan_migrator` | `santulan`, `santulan_qual` | `dbOwner` on those databases only | data-model migrations, seed/verify scripts, tests (fixtures/cleanup), backup drill. **Never present in the API process environment.** |
| `santulan_runtime` | `santulan`, `santulan_qual` | custom role `santulan_runtime` (below) | the API and its workers |

### 2.1 Role `santulan_runtime`

| Resource | Actions |
|----------|---------|
| Tier **A** collections (`audit_logs`, `score_results`, `response_events`, `items`, `participant_cohort_history`, `growth_reviews`, `pathway_decisions`, `pathway_reviews`) | `find`, `insert` |
| Tier **B** collections (see data-model §2) and `dev_identity_credentials` | `find`, `insert`, `update` |
| Views `v_research_*` | `find` |
| View `v_candidate_subdomain_scores` (research-only) | **none** — not granted to the runtime credential; read only by the migrator credential in research scripts |
| Everything else | **none** — in particular **no `remove`, `createIndex`, `dropIndex`, `collMod`, `createCollection`, `dropCollection`, `renameCollection`, user/role actions** on any resource |

## 3. Data-model migrations (replace `backend/migrations/*.sql`)

`backend/db/migrations/NNN_name.js`, applied in order by `scripts/db-migrate.js` **with the migrator credential**; applied names and SHA-256 recorded in a `_data_migrations` collection (bootstrapping metadata, not a canonical entity, writable only by the migrator). Forward-only; an applied file is never edited (constitution III); a fix is a new file.

| File | Content |
|------|---------|
| `001_collections_and_validators.js` | all 27 canonical collections + `dev_identity_credentials` with `$jsonSchema`/`$expr` validators (data-model §3–§4) |
| `002_indexes.js` | the 50 named indexes (data-model §5); idempotent by name |
| `003_research_views.js` | the eight `v_research_*` views and the research-only `v_candidate_subdomain_scores` (data-model §8) |
| `004_runtime_role.js` | role `santulan_runtime` and user (privileges §2.1) |
| `005_reference_framework.js` | none — framework map ships as `framework.json`; reference actions/prompts loaded by `scripts/seed-reference.js` (research R-M13) |

`_data_migrations` also stores `{ dataModelVersion }`; the API compares it at start-up.

## 4. Guarantees (each verified by tests)

**Same-document rules (store-enforced)**

| ID | Guarantee | Test family |
|----|-----------|-------------|
| G-01 | Every collection rejects undeclared fields and wrong types (`121`) | store/validators |
| G-02 | Participants: age 13–25; `developmental_band`, `assessment_track`, `is_minor` are consistent with the age on insert **and** update; OPEN ⇒ no institution/cohort/external id; INSTITUTIONAL ⇒ both; auth provider and subject both-or-neither | T03-007…013, T03-028 |
| G-03 | Consents: type/giver combinations; non-blank protocol; `VERIFIED` ⇒ `verified_at` + method | T04-005…017 |
| G-04 | Sets: age range matches configuration; `FROZEN` ⇒ `frozen_at`; `OPEN` ⇒ `FROZEN`; question options 2–20, positions 1…n, texts distinct | T-B02, new option tests |
| G-05 | Scores: raw 1.00–5.00 or null; counts consistent with completeness; **`completeness_status` exactly per the boundary table (60 % ⇒ `INSUFFICIENT` ⇒ no score, S0; `INCOMPLETE` ⇒ S1/SH only)** | B06-011…015 |
| G-06 | Quality: `Q09 ⇒ CRITICAL`; reviewer pair all-or-none | B06 |
| G-07 | Admin: `ACTIVE ⇒ SUPER_ADMIN` | B08-009/010 |
| G-29 | Reports: a terminal state (`REPORT_READY`/`UNDER_REVIEW`/`NOT_ELIGIBLE`) always carries a 64-hex `content_hash`; `PENDING`/`FAILED_RETRYABLE` never | B07-003, RC-11 |

**Uniqueness (store-enforced)** — every index of data-model §5 exists **by name** and behaves as specified:

| ID | Guarantee | Test family |
|----|-----------|-------------|
| G-08 | Second non-terminal attempt for a participant refused; terminal attempts do not count (`$in` partial index) | B05-001 |
| G-09 | Exactly one current answer per attempt/question; version numbers unique | B05 |
| G-10 | One verified consent per participant/type/protocol; one active per type/protocol | T04 |
| G-11 | Unique Santulan id, auth pair, external id per institution, report per attempt, submit key per attempt, score key, idempotency keys | T03, B05, B06, B07 |
| G-12 | **At most one OPEN set per age group; one live revision per label** | new (constitution II) |
| G-28 | **At most one APPROVED wording per (set, domain, age stage, evidence state, language, layer)** — a second approval is refused by the store | new (scoring master) |

**Privileges (store-enforced, tested with the runtime credential)**

| ID | Guarantee | Test family |
|----|-----------|-------------|
| G-13 | Runtime cannot `update` or `remove` on any Tier A collection (audit, scores, events, questions, growth reviews, pathway decisions/reviews, history) | B08-006, B08-054/055, SEC |
| G-14 | Runtime cannot `remove` from **any** collection | constitution III |
| G-15 | Runtime cannot create/drop collections or indexes, change validators (`collMod`), or manage users/roles | SEC-12 (redefined) |
| G-16 | Runtime can read a research view without rights on its source, and cannot write to a view | B08-025, AT-30 |
| G-17 | The API process cannot start with the migrator, root, or a non-replica-set server | start-up tests |

**Atomicity and concurrency**

| ID | Guarantee | Test family |
|----|-----------|-------------|
| G-18 | A multi-step action either fully applies or leaves no trace, including when a validator, unique index, or the audit insert fails part-way | B05-025/026, B07-076, B08-005 |
| G-19 | Two concurrent saves/submits/retries/exports/claims/uploads converge to one result (compare-and-set + unique indexes + transaction retry) | B05-037…043, B07-077, B08-067…069 |
| G-20 | Every state transition is compare-and-set; a stale source state changes nothing | all machines |

## 5. Scope contract (row-level-security replacement)

The **only** module that imports the driver is `modules/santulan/store/`. It exposes `withScope(scope, fn, { transaction })` and repositories.

| ID | Guarantee | Test family |
|----|-----------|-------------|
| G-21 | With no scope (or an unknown scope) every read returns nothing and every write is refused | SEC-10 |
| G-22 | A participant scope sees only its own attempts, answers, released report sections, consents, growth data; another participant's ids return nothing | SEC-04/05 |
| G-23 | A participant scope cannot read `admin_users`, `research_exports`, `audit_logs`, `quality_flags`, unreleased scores/sections | SEC-06 |
| G-24 | Institution scope needs an exact non-null `institution_id`; OPEN participants (`null`) never match | SEC-01…03 |
| G-25 | Scope values come only from the verified session; a request that carries scope fields is refused/ignored | SEC-08 |
| G-26 | Scope is request-scoped: two interleaved requests never see each other's scope | SEC-11 |
| G-27 | A repository scan fails the build if any file outside `store/` imports the driver or calls `.collection(` | SEC (new) |

## 6. Error mapping

| Store event | API result |
|-------------|-----------|
| duplicate key `11000` on a named index | the earlier per-index code (`DUPLICATE_IDENTITY`, `RESPONSE_KEY_CONFLICT`, `CONSENT_DUPLICATE`, `INVALID_STATE` for the open-attempt index, `OPEN_SET_EXISTS` for `uq_one_open_set_per_age_group`, …) |
| validator failure `121` | `VALIDATION_ERROR` / `INVALID_STATE` by collection (never a 500) |
| `Unauthorized (13)` | `403 FORBIDDEN` **plus a security log entry** — it means code tried something the credential forbids |
| write conflict / transient transaction label | retried by the driver helper; after the retry budget → `503 STORE_UNAVAILABLE` |
| network / not primary / timeout | `503 STORE_UNAVAILABLE`; the action is refused, nothing partial |

## 7. Verification, backup and integrity

| Item | Contract |
|------|----------|
| `scripts/db-verify.js` | checks: the 27 collections + the nine views exist with the expected validators and the 50 indexes (by name and definition); no two APPROVED wordings share a dimension; every terminal report's `content_hash` equals the recomputed hash of its sections; framework map, 216 actions (all inactive by default), 72 prompts (draft), no seeded questions; for every FROZEN set the recomputed `content_hash` equals the stored one; every score/report/growth/pathway row's participant equals its attempt's; exactly one current answer per attempt/question; audit rows exist for every privileged state change. Exit non-zero on any failure. |
| Backup | `mongodump --archive --gzip` of the Santulan database; restore into a clean scratch database with `mongorestore --archive --gzip --drop`; then `db-verify.js`, the store-guarantee suite and a smoke journey; evidence file written by `scripts/backup-restore-drill.js` |
| Release manifest | `scripts/release-manifest.js` hashes the data-model migrations, framework/reference files, config templates, question-set content hashes and the commit; unsigned until the go/no-go decision |
| Environments | development, staging and pilot use separate instances/databases; the dev-only reset script refuses any non-scratch database |

## 8. Out of contract (recorded, not built here)

Field-level immutability inside Tier B collections is **not** store-enforceable (privileges are per collection) — compensated by the single-operation repositories, the repository scan (G-27) and `db-verify.js`; the alternative that moves `responses` to Tier A is decision D-M02. Cross-document invariants (data-model §7) are application-enforced by design.
