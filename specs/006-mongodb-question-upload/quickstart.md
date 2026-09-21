# Quickstart: Validate the MongoDB Platform and Question Upload

**Feature**: 006-mongodb-question-upload | **Plan**: [plan.md](plan.md) | **Contracts**: [upload-format](contracts/upload-format.md) · [api-delta](contracts/api-delta.md) · [database-contract](contracts/database-contract.md) | **Data model**: [data-model.md](data-model.md)

Runnable scenarios that prove the feature end to end. Scripts named here (`mongo-local.js`, `db-migrate.js`, `db-verify.js`, …) are **created by the tasks**; until they exist this file is the acceptance script. Everything is local — **no Docker**. Commands are shown for PowerShell from `F:\Santulan\backend` unless stated. Placeholders in `<angle brackets>` are printed once by the setup script; never commit them.

## 0. Prerequisites

- MongoDB Server 8.0+ installed locally with `mongosh` and the Database Tools (present on this machine: `mongod`, `mongosh`, `mongodump`, `mongorestore`).
- Node.js ≥ 20.19 (this machine: 24.13). `npm install` in `backend/` and `frontend/`.
- **PostgreSQL is not needed** and must not be referenced by any command below.
- The existing `MongoDB` Windows service on port **27017** is left alone (it hosts other databases and has no authentication).

## 1. Start the dedicated local instance (single-node replica set, authentication on)

```powershell
npm run db:local:init      # first time: writes backend/.mongo/{mongod.cfg,keyfile}, starts mongod on 27018,
                           # runs rs.initiate, creates root_admin / santulan_migrator / santulan_runtime, prints the URIs once
npm run db:local:start     # later sessions        (stop: npm run db:local:stop, state: npm run db:local:status)
```

Put the printed URIs in `backend/.env`: `MONGODB_URI_RUNTIME` (runtime user), `MONGODB_URI_ADMIN` (migrator, scripts/tests only), `MONGODB_DB=santulan`, `MONGODB_TEST_DB=santulan_qual`.

**Expect**: `db:local:status` reports port 27018, replica set `rs0` PRIMARY, authorization enabled. `Get-Service MongoDB` still shows the original service running on 27017, untouched.

## 2. Build the data model and load reference content

```powershell
npm run db:migrate         # applies backend/db/migrations/001…004 with the migrator credential
npm run db:seed:reference  # 216 development actions (inactive), 72 reflection prompts (draft); NO questions
npm run db:verify          # integrity check: collections, validators, 50 indexes, counts, hashes
npm run db:seed:dev        # three synthetic accounts (SUPER_ADMIN + one participant per track)
```

**Expect**: `db:verify` exits 0 and reports 27 collections + 1 dev collection + 9 views, 50 indexes, 216/72 reference rows, **0 question sets** (none is preloaded), all actions inactive. Re-running each command changes nothing.

## 3. Start the platform and prove it never asks for SQL

```powershell
npm run dev                # API on APP_PORT; refuses to start if the runtime URI is missing, points at the migrator,
                           # or the server is not a replica set
```

**Expect**: startup succeeds with only the MongoDB variables set. `Select-String -Path package.json -Pattern '"pg"'` and a search for `DATABASE_URL` in `backend/src` return nothing (spec SC-001). *(Final state after phase 10; earlier phases may still contain the old code.)*

## 4. Store guarantees (database contract §4)

```powershell
npm run test:santulan -- tests/santulan/store
```

**Expect** all G-01…G-20 tests pass. To see the least-privilege claim by hand:

```powershell
mongosh "<MONGODB_URI_RUNTIME>" --eval "db.audit_logs.updateOne({}, {\$set:{x:1}})"      # Unauthorized
mongosh "<MONGODB_URI_RUNTIME>" --eval "db.participants.deleteMany({})"                  # Unauthorized
mongosh "<MONGODB_URI_RUNTIME>" --eval "db.items.createIndex({zz:1})"                    # Unauthorized
```

## 5. Upload the sample questions (spec US2)

1. Sign in as the SUPER_ADMIN dev account (README "Dev login credentials").
2. `GET /api/v1/admin/question-sets/template` — a workbook opens with the header and three example rows.
3. `POST /api/v1/admin/question-sets` with `docs/Santulan_Sample_Questions.xlsx` and `ageGroup=ADOLESCENT`.

**Expect**: `201`, `questionCount 10`, `optionCount 50`, `status DRAFT`, `participationState CLOSED`, a `DOMAIN_WITHOUT_QUESTIONS` warning **absent** (all seven domains are present), and one `QUESTION_SET_UPLOADED` audit row with the file's SHA-256. A second identical upload returns `200`, `created:false`.
4. Break the file: set `keying` to `REVERSE` in one row, repeat an `item_code`, blank all but one option in another row, put `=1+1` in an `item_text` as a formula, and upload again.

**Expect**: `422 UPLOAD_VALIDATION_FAILED` listing **every** problem with row and column (`KEYING_NOT_SUPPORTED`, `ITEM_CODE_DUPLICATE`, `OPTIONS_TOO_FEW`, `FORMULA_NOT_ALLOWED`); **no** new set exists; one `QUESTION_SET_UPLOAD_REJECTED` audit row. The old 13-column workbook (`docs/Santulan_Adolescent_Items_TECH_READY.xlsx`) is refused with `OLD_FORMAT_NOT_SUPPORTED` and a pointer to the template.

## 6. Review, freeze, open (spec US4)

1. Try to start an attempt as the adolescent dev participant while the set is a draft → `409 ASSESSMENT_NOT_OPEN`.
2. `POST …/{id}/freeze` → `FROZEN`; editing/re-uploading the same label → `409 SET_NOT_DRAFT`.
3. `POST …/{id}/open` with a reason → `participationState OPEN`; a second frozen set for the same age group cannot be opened (`409 OPEN_SET_EXISTS`).
4. `POST …/{id}/close` with a reason → new attempts refused; existing answers untouched.

**Expect** one audit row per step (actor, action, previous/new state, reason, time).

## 7. Answer variable options and check scoring (spec US3)

Upload and open a set whose questions have **2, 3, 5 and 9** options (add rows to the sample). As the participant (consents verified via the dev tooling):

1. `GET /attempts/{id}/items` → every item lists exactly its own options in the uploaded order.
2. Answer with valid positions; answer a 3-option question with `"5"` → `422 OPTION_OUT_OF_RANGE`, nothing stored.
3. Change an answer → the earlier one is kept as history, the new one is current (`uq_current_response`).
4. Submit → quality → score (`npm run pipeline:once` or the internal endpoints).

**Expect**: a 5-option question scores exactly as before (positions 1–5 → 1–5); positions on a 3-option question count as 1, 3, 5; a 2-option question as 1 or 5; every domain result is `S1` (research-only) unless the audited pilot-S2 switch promotes it (§7b), so **the participant sees no scores** (constitution VII). Unit test: the scoring function for n = 2, 3, 4, 5, 9, 20.

## 7b. Scoring boundaries, evidence and the report (spec US8; [scoring-and-report](contracts/scoring-and-report.md))

Using the sample set (10 questions, 5 options) and the internal quality/score endpoints, score attempts that leave 0, 1, 2 and 4 of 10 answers missing **in one domain** (add questions or use a domain with 10 eligible questions):

| Answered of 10 | Expect |
|---|---|
| 10 | COMPLETE, mean of all ten |
| 9 | COMPLETE_WITH_MISSING, mean of the nine, **nothing imputed** |
| 8 | INCOMPLETE, score kept, evidence `S1`, one `Q07` flag for the domain, no participant interpretation |
| 6 | INSUFFICIENT, **no score**, evidence `S0`, `Q07` flag; the report shows "Not enough data yet" for that domain |

1. Switches: `GET /admin/release-flags` → all four `false`. Score a complete attempt → every domain `S1`; `GET /reports/{id}` returns the PROFILE section only (seven domains, all `NOT_ENOUGH_DATA`) and no capability wording.
2. Turn `pilotS2` on (`POST /admin/release-flags/pilotS2` with a reason) and score a new complete attempt → domains above 80 % are `S2`. Generate its report **with no approved wording loaded** → the report ends `FAILED_RETRYABLE` (`WORDING_MISSING`), the attempt stays `SCORED`, the participant sees nothing partial.
3. Load one approved wording per S2 domain and layer for that question set, retry (`POST /internal/reports/{id}/retry`) → `REPORT_READY`, the attempt becomes `REPORT_READY`, `content_hash` is present. Try to approve a second wording for the same domain/stage/state/language/layer → refused by the store.
4. Request `GET /attempts/{id}/scores` as the participant → `404` (withdrawn); the score is available only inside the report's PROFILE payload.
5. Each switch change appears in the audit log with actor, value and reason; turning `pilotS2` back off returns new attempts to `S1`.

## 8. Behaviour parity, concurrency, isolation

```powershell
npm run test:santulan                           # full suite on the dedicated instance, scratch database santulan_qual
$env:RUN_LOAD='1'; npm run test:santulan -- tests/santulan/integration/deliveryLoad.test.js
```

**Expect**: every previously passing matrix ID (T03, T04, B05–B08, AT/RC, SEC) passes again on the new store with a recorded evidence entry; the load test shows 40 simultaneous participants saving and two classes of 40 submitting with **no lost or duplicated answers** (SC-004/005/006).

Isolation spot check: as participant A request participant B's attempt, report and answers → `403/404`; as a participant read `/admin/*` → `403`.

## 9. Admin operations and research export (carried over, spec US5)

1. Stop participation with a reason → new attempts refused, existing data unchanged, audit row present; reopen → works.
2. Request an export filtered to one institution (with `anonymisationVersion` and a source set) and poll until `READY`; download it.
3. `npm run export:synthetic -- --participants 10000 --items 222` (scratch database only).

**Expect**: the workbook has the eleven fixed sheets in order and no `participant_id`, auth subject, external student id, contact or guardian column; every participant-derived sheet contains only the chosen institution; the synthetic export produces **≥ 3** `ITEM_RESPONSES_nn` sheets, none over 1,048,576 rows including the header, and the row reconciliation reports 2,220,000 rows once each (SC-010). Kill the worker mid-export → status `FAILED`, no downloadable partial file.

## 10. Backup and restore drill (spec FR-037)

```powershell
npm run drill:backup-restore    # mongodump --archive --gzip → restore into a clean scratch database → verify → smoke journey
```

**Expect**: an evidence file under `backend/release/evidence/` with operator, timestamps, hashes and PASS for: `db:verify`, the store-guarantee suite, and a registration → consent → answer → submit → report journey on the restored copy.

## 11. Convert the existing catalog to the new format (spec US7)

```powershell
npm run questions:convert       # writes two new-format workbooks from the frozen v3.1 catalog
```

**Expect**: uploading both files yields two draft sets with **175 and 171** questions, five options each, **0 validation errors** (SC-014).

## 12. Clean-up check (final phase)

- No file under `backend/migrations/`, no `pg` dependency, no `DATABASE_URL`/`RUNTIME_DATABASE_URL`/`PLATFORM_DATABASE_URL`, no `docker/init-app-role.sql`; README/quickstart/FLOWCHART/SECURITY notes describe MongoDB and the upload flow; each scenario in this file was executed once and its result recorded in `specs/006-mongodb-question-upload/evidence/quickstart-results.md`.
- Launch status remains **NO-GO**; the evidence register lists every AT/RC/SEC test with an entry, none PASS without evidence, staged-only items `NOT_EXECUTED` (spec FR-038/039).
