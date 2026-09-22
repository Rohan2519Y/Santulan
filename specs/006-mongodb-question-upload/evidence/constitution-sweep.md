# Constitution sweep — feature 006 (constitution v3.0.0)

**Date**: 2026-09-21 (sweep), 2026-09-22 (journey) · **Task**: T172 · **Scope**: `backend/src/modules/santulan/`, `backend/src/`, `backend/db/`, `frontend/src/`

## Status of this record

| Part of T172 | State |
|--------------|-------|
| Constitution sweep (static review below) | **Done** on 2026-09-21 |
| End-to-end journey (register → consent → open set → answer → submit → score → report → admin export) on the new store | **DONE on 2026-09-22.** `backend/tests/santulan/integration/e2eJourney.test.js` runs the whole chain once, over the real HTTP app, on the scratch database (`santulan_qual`) with the runtime credential doing the work: an adult participant registers, confirms their own consent via the new self-consent endpoint (CR-006-13), the admin uploads/freezes/opens a fresh question set, the participant answers every item and submits, quality and scoring run through the internal endpoints, a report generates and the participant reads their own PROFILE section (seven domains), and the admin requests, generates and downloads a research export. Acceptance 3 (immutability: re-saving an answer versions it, never edits it in place) and acceptance 4 (isolation: a second participant gets `404` on the attempt, its responses and the report) are asserted inline in the same run. Acceptance 5 (40 concurrent participants, no lost/duplicated answers) and acceptance 6 (audit write failure fails the action closed) are covered by their existing dedicated suites (`integration/deliveryConcurrency.test.js`, the atomicity assertions in `store/` and `contract/` suites), re-confirmed by the same full-suite run below, not repeated in the journey test. Full suite at the time of this run: 77 suites, 847 tests, 0 unexpected failures (1 `RUN_LOAD` skip, the documented informational load case) |

The sweep is a **static** review with targeted searches. It is not a substitute for the test suites; no suite was executed in this pass.

## Checks

| # | Rule (constitution / task text) | Method | Result |
|---|--------------------------------|--------|--------|
| 1 | Only `store/` imports the driver or calls `.collection(` (G-27) | search of `backend/src` for `require('mongodb')`, `from 'mongodb'`, `.collection(` | **PASS.** Driver imported only in `store/client.js`. `.collection(` appears only in `store/client.js` (start-up version marker) and `store/dal.js` (the scoped repository class and its scope-check helpers) |
| 2 | No relational code | search of `backend/src` for `require('pg')`, `from 'pg'`, `withCanonicalTx`, `DATABASE_URL` | **PASS.** No matches. `backend/migrations/`, `backend/docker-compose.yml` and `backend/docker/` were removed by T166 (they show as deleted in the working tree) |
| 3 | Runtime credential cannot remove data or alter the schema | read `backend/db/schema/roles.js` | **PASS.** Tier A: `find`,`insert`. Tier B and dev credentials: `find`,`insert`,`update`. Research views: `find`. `_data_migrations`: `find`. `v_candidate_subdomain_scores` not granted. No `remove`, `createIndex`, `dropIndex`, `collMod`, `createCollection`, `dropCollection`, `renameCollection`, user or role action |
| 4 | Application code cannot remove or change the schema either | search of `backend/src` for `deleteOne`, `deleteMany`, `remove(`, `findOneAndDelete`, `.drop(`, `bulkWrite`, `replaceOne`, `createIndex`, `dropIndex`, `createCollection` | **PASS.** No matches |
| 5 | Migrator credential never used by the API | search of `backend/src` for `MONGODB_URI_ADMIN`, `mongodbUriAdmin`, `santulan_migrator` | **PASS, hardened 2026-09-22.** No code under `src/` reads it, and `src/config/index.js` no longer even declares the key (the 2026-09-21 recommendation was acted on); `security/platform.test.js` (T155) now passes its "`MONGODB_URI_ADMIN` appears nowhere under `backend/src`" assertion, confirmed by the full-suite run this pass |
| 6 | No new PII field | search of `backend/db/schema` for email, phone, mobile, name fields, date of birth, birth, address, guardian name/contact | **PASS.** No matches |
| 7 | No unscoped data-access path | review of the `.collection(` call sites (check 1) | **PASS.** Every call site is inside the scoped repository class or its scope-check helpers; repositories receive an explicit scope |
| 8 | No client-supplied score, version, Santulan ID, participant ID or scope | search of `backend/src` for `req.body`/`req.query`/`req.headers` reads of `score`, `version`, `santulanId`, `participantId`, `institutionId`, `scope`, `actorScope` | **PASS with two reviewed hits, neither sets a scope.** `admin.controller.js:54` — `req.query.institutionId` is a Super Admin **list filter**, validated as a UUID and passed as a filter through the verified actor. `roster.controller.js:18` — `req.body.institutionId` names the institution whose roster a Super Admin is importing; it is a target, not a scope, and the service requires an ACTIVE institution |
| 9 | No weakened unique or partial-unique index | search of `backend/db` for `$nin`, `$ne`, `unique: false`, index creation outside migration 002 | **PASS.** The only index creation is `migrations/002_indexes.js`; `$ne` hits are validator expressions, not index filters (partial filters use positive `$in` lists, per `indexes.js` header) |
| 10 | No prohibited claim in shipped strings | search of `backend/src` and non-test `frontend/src` for diagnosis, clinical, percentile, norm-referenced, reliable change, "improved", toughness, personality type, attention disorder, IQ, Low/Average/High band wording | **PASS.** Only comments that state the prohibition (`reportRenderer.js`, `PublicPages.jsx`), internal "diagnostics" wording in error handling, and font licence text |
| 11 | Only the change-record-006 additions | compared the collection/index inventory against `change-record-006.md` (CR-006-1…13) | **PASS, extended 2026-09-22.** Two further changes since the 2026-09-21 sweep, both owner-directed and recorded as CR-006-12 (draft question-set delete, `DRAFT → RETIRED`, no new enum value, no new field) and CR-006-13 (`SELF_ATTESTED` added to `ADULT_SELF_CONSENT`'s approved verification methods in `CONSENT_PROTOCOLS_PATH`, no schema change; new participant-facing self-consent endpoint). Neither adds a collection, a field, an index or a PII surface - see `data-model.md` §9 and `change-record-006.md`. `db:verify` (50 named indexes, validators) ran as part of `setupFromScratch.test.js` in this pass's full suite run and passed |

## Not covered by this sweep

- The staging-only items (`launch-gates.md` E1–E11) — `NOT_EXECUTED`.
- Whether the locked documents agree with this build — see `document-reconciliation.md`.

Behaviour under load, concurrency, isolation over HTTP, abuse throttling and claims scanning on generated exports (US6 test tasks
T152–T156, T161) were skipped on 2026-09-21 and are now **done**: `security/claims.test.js`, `security/isolation.test.js`,
`security/abuse.test.js`, `security/platform.test.js`, `security/atRcTraceability.test.js` all exist and pass, and T161's
backup-restore drill is recorded separately under `backend/release/evidence/`.

## Result

No violation of the constitution was found by static review, and the end-to-end journey now confirms it at runtime too. The one
hardening recommendation (check 5) is applied and the one incomplete cross-check (check 11) is closed. Launch status remains
**NO-GO** (staging-only evidence, `launch-gates.md` E1–E11, is still outstanding by scope, not by any found defect).
