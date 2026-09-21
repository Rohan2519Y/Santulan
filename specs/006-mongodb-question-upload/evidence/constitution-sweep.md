# Constitution sweep — feature 006 (constitution v3.0.0)

**Date**: 2026-09-21 · **Task**: T172 (sweep half) · **Scope**: `backend/src/modules/santulan/`, `backend/src/`, `backend/db/`, `frontend/src/`

## Status of this record

| Part of T172 | State |
|--------------|-------|
| Constitution sweep (static review below) | **Done** on 2026-09-21 |
| End-to-end journey (register → consent → open set → answer → submit → score → report → admin export) on the new store | **NOT RUN.** The owner asked for test/execution work to be skipped in this pass ("skip the test for now"). Nothing below claims this journey passed on 2026-09-21. The per-step scenarios recorded in `quickstart-results.md` §1–§8 (2026-09-20) are the latest runtime evidence |

The sweep is a **static** review with targeted searches. It is not a substitute for the test suites; no suite was executed in this pass.

## Checks

| # | Rule (constitution / task text) | Method | Result |
|---|--------------------------------|--------|--------|
| 1 | Only `store/` imports the driver or calls `.collection(` (G-27) | search of `backend/src` for `require('mongodb')`, `from 'mongodb'`, `.collection(` | **PASS.** Driver imported only in `store/client.js`. `.collection(` appears only in `store/client.js` (start-up version marker) and `store/dal.js` (the scoped repository class and its scope-check helpers) |
| 2 | No relational code | search of `backend/src` for `require('pg')`, `from 'pg'`, `withCanonicalTx`, `DATABASE_URL` | **PASS.** No matches. `backend/migrations/`, `backend/docker-compose.yml` and `backend/docker/` were removed by T166 (they show as deleted in the working tree) |
| 3 | Runtime credential cannot remove data or alter the schema | read `backend/db/schema/roles.js` | **PASS.** Tier A: `find`,`insert`. Tier B and dev credentials: `find`,`insert`,`update`. Research views: `find`. `_data_migrations`: `find`. `v_candidate_subdomain_scores` not granted. No `remove`, `createIndex`, `dropIndex`, `collMod`, `createCollection`, `dropCollection`, `renameCollection`, user or role action |
| 4 | Application code cannot remove or change the schema either | search of `backend/src` for `deleteOne`, `deleteMany`, `remove(`, `findOneAndDelete`, `.drop(`, `bulkWrite`, `replaceOne`, `createIndex`, `dropIndex`, `createCollection` | **PASS.** No matches |
| 5 | Migrator credential never used by the API | search of `backend/src` for `MONGODB_URI_ADMIN`, `mongodbUriAdmin`, `santulan_migrator` | **PASS with one observation.** No code under `src/` reads it. `src/config/index.js:9` still declares the key `mongodbUriAdmin` (task T004 required it; the repository-scan test exempts exactly that file). Nothing consumes it. **Recommendation:** delete the unused key so the API process cannot even load the migrator URI, and note that task T155's planned assertion ("`MONGODB_URI_ADMIN` appears nowhere under `backend/src`") cannot pass until it is removed |
| 6 | No new PII field | search of `backend/db/schema` for email, phone, mobile, name fields, date of birth, birth, address, guardian name/contact | **PASS.** No matches |
| 7 | No unscoped data-access path | review of the `.collection(` call sites (check 1) | **PASS.** Every call site is inside the scoped repository class or its scope-check helpers; repositories receive an explicit scope |
| 8 | No client-supplied score, version, Santulan ID, participant ID or scope | search of `backend/src` for `req.body`/`req.query`/`req.headers` reads of `score`, `version`, `santulanId`, `participantId`, `institutionId`, `scope`, `actorScope` | **PASS with two reviewed hits, neither sets a scope.** `admin.controller.js:54` — `req.query.institutionId` is a Super Admin **list filter**, validated as a UUID and passed as a filter through the verified actor. `roster.controller.js:18` — `req.body.institutionId` names the institution whose roster a Super Admin is importing; it is a target, not a scope, and the service requires an ACTIVE institution |
| 9 | No weakened unique or partial-unique index | search of `backend/db` for `$nin`, `$ne`, `unique: false`, index creation outside migration 002 | **PASS.** The only index creation is `migrations/002_indexes.js`; `$ne` hits are validator expressions, not index filters (partial filters use positive `$in` lists, per `indexes.js` header) |
| 10 | No prohibited claim in shipped strings | search of `backend/src` and non-test `frontend/src` for diagnosis, clinical, percentile, norm-referenced, reliable change, "improved", toughness, personality type, attention disorder, IQ, Low/Average/High band wording | **PASS.** Only comments that state the prohibition (`reportRenderer.js`, `PublicPages.jsx`), internal "diagnostics" wording in error handling, and font licence text |
| 11 | Only the change-record-006 additions | compared the collection/index inventory against `change-record-006.md` (CR-006-1…11) | **NOT VERIFIED field by field.** The change record lists the additions; a field-level diff of `db/schema/` against `data-model.md` §9 was not done in this pass. `db:verify` (which checks validators and the 50 indexes by name and definition) last passed on 2026-09-20 (`quickstart-results.md` §2) and was not re-run today |

## Not covered by this sweep

- Behaviour under load, concurrency, isolation over HTTP, abuse throttling and claims scanning on generated exports — these are the
  US6 test tasks (T152–T156, T161), skipped in this pass.
- The staging-only items (`launch-gates.md` E1–E11) — `NOT_EXECUTED`.
- Whether the locked documents agree with this build — see `document-reconciliation.md`.

## Result

No violation of the constitution was found by static review. One hardening recommendation (check 5) and one incomplete cross-check
(check 11) are open. Launch status remains **NO-GO**.
