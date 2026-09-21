# Implementation Plan: Document Database Only Platform and Spreadsheet Question Upload

**Branch**: `006-mongodb-question-upload` | **Date**: 2026-09-20 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/006-mongodb-question-upload/spec.md` (clarified 2026-09-20)

## Summary

Move the whole platform from PostgreSQL to a **local MongoDB** and remove SQL completely, then let a Super Admin bring in questions from a spreadsheet in the new sample format, where each question has its own 2–20 answer options. Finish, on the new store, the 38 tasks feature 005 left undone.

Technical approach (details in [research.md](research.md)):

1. **A dedicated local MongoDB instance** for Santulan — the installed 8.0.10 binaries run as a second process on port 27018 as a **single-node replica set with authentication** (no Docker). Verified on this machine: the installed service on 27017 is a standalone with no authentication and already hosts other databases, so it can neither provide transactions nor a least-privilege credential and is left untouched (R-M01).
2. **The store guards what it can, the domain layer guards the rest.** Validators (`$jsonSchema` + `$expr`) and 50 named indexes (unique and partial-unique among them) enforce same-document rules and uniqueness; a **runtime credential without `remove`, index or schema rights**, with append-only (`find`+`insert`) collections for audit, scores, events and questions, makes immutability real at the store; read-only **views** give research-safe projections. Everything that was a SQL trigger or foreign key (cross-document and state rules) becomes a named, transactional **domain rule** with a failing-first test (R-M03, R-M04, data-model §7). All of this was **verified on a throw-away instance** before being planned.
3. **A single scoped data-access layer** is the only code that touches the driver and replaces row-level security: scope comes from the verified session, is request-scoped, and fails closed (R-M05).
4. **Atomic multi-step actions** use driver transactions with compare-and-set state moves and unique-index races (R-M06).
5. **Question sets** are `assessment_versions` documents with immutable `items` that embed ordered `options`; upload is validated all-or-nothing, idempotent by content hash, revisioned without deletion, frozen and opened as separate audited steps, with **one open set per age group enforced by a unique index** (R-M09, R-M10, [contracts/upload-format.md](contracts/upload-format.md)).
6. **Answers store the option position**; scoring converts position to the common 1–5 scale by even spacing (a 5-option question is identical to today) and follows the **Scoring & Report Generation master** exactly: four completeness statuses with integer boundaries (60 % is INSUFFICIENT), no imputation, evidence `S1` by default and `S2` only behind an audited pilot-S2 switch, exactly-one-approved-wording with **fail-closed** rendering, a report fingerprint, and no score outside the released report (R-M08, R-M19, [contracts/scoring-and-report.md](contracts/scoring-and-report.md)).
7. **Port module by module**, delete every SQL artefact last (R-M14); carry the outstanding admin/research, security/QA and polish work into phases 7, 9, 10 (R-M18).

## Technical Context

**Language/Version**: Node.js ≥ 20.19 (machine: 24.13.1); CRA/React 19 frontend; JavaScript (no TypeScript migration).

**Primary Dependencies**: Backend — Express 4, **`mongodb` driver 7.6.0** (new), `zod`, `jsonwebtoken`, `bcryptjs`, `multer`, `xlsx` (SheetJS 0.20.3, upload parsing), **`exceljs` 4.4.0** (new, streaming export, D-12). **Removed**: `pg`. Frontend — React 19, `react-router-dom` 6, `lucide-react`, CSS Modules (unchanged).

**Storage**: **MongoDB 8.0.10, local install, single-node replica set `rs0`, authorization + keyFile**, dedicated instance on port 27018 (research R-M01). Databases `santulan` and `santulan_qual` (tests). No relational database anywhere.

**Testing**: Jest 29 + supertest (`--runInBand`), real local MongoDB, two credentials (migrator for fixtures/cleanup, **runtime for everything under test**); store-guarantee, domain-rule, contract, integration, security and evidence suites keep their matrix IDs; frontend React Testing Library + `jest-axe` + contrast gate (R-M07).

**Target Platform**: Windows local development now (the owner's machine), Linux/Windows server later; responsive web, 320 px phones to desktop.

**Project Type**: Web application — `backend/` modular monolith + `frontend/` SPA.

**Performance Goals** (only those the spec states): upload of ≤ 500 questions reviewable in < 1 min (SC-002); 40 participants saving and two classes of 40 submitting with no lost/duplicated answers (SC-006); 10,000 × 222 = 2,220,000-row export as a partitioned workbook without exhausting memory (SC-010); setup on a fresh machine < 45 min (SC-013). No numeric latency target exists in the sources; none is invented.

**Constraints**: constitution v3.0.0 — no relational database; explicit validators/indexes; no runtime `remove`/index/schema rights; immutable Tier A collections; all multi-step actions atomic; scope from the verified session only; upload files not retained beyond their hash; launch stays NO-GO and prior evidence is stale.

**Scale/Scope**: pilot ≈ 10,000 participants; up to 500 questions × 20 options per set; 27 canonical collections + 1 dev collection + 9 views; ≈ 60 API operations + 7 question-set operations + 2 release-switch operations (1 withdrawn: the participant score endpoint); 25 reference screens + 11 admin pages (the last carried over from feature 005); ≈ 40 backend source files (~3,100 lines) and 32 test files to port; 38 carried-over tasks.

## Constitution Check

*GATE: pass before Phase 0 research; re-checked after Phase 1 design.* Evaluated against `.specify/memory/constitution.md` **v3.0.0**.

| Principle | Pre-research | Post-design | Evidence in this plan |
|-----------|:-:|:-:|----------------------|
| I. Source of truth & change control | PASS | PASS | Change record 006 = spec + [data-model §9](data-model.md); every addition/retirement listed with a reason; unstated values marked assumptions; item wording comes from frozen, hash-checked sets |
| II. One engine, two configurations | PASS | PASS | age group chosen at upload and checked per row; set stored on the attempt; **one open set per age group is a unique index** (`uq_one_open_set_per_age_group`); no preload |
| III. Canonical data model, strictly per the documents | RISK | **PASS with justified deviation** | 27 entities + 1 retirement + the CR-006 additions only; every collection has an explicit validator; every constraint-like rule that MongoDB **can** express is store-enforced; cross-document/state rules **cannot** be (verified) → Complexity Tracking row 1; no runtime `remove` anywhere |
| IV. Immutability & provenance | RISK | **PASS with residual risk** | Tier A collections insert-only at the store (verified); questions/options/scores/events/audit can never be updated by the runtime credential; `responses.is_current` needs `update` on `responses` (field-level immutability is not store-enforceable) → Complexity Tracking row 2, decision **D-M02** with a stronger alternative |
| V. Fail closed, server authority | PASS | PASS | transactions + compare-and-set (verified); audit insert in the same transaction; store unavailable ⇒ refuse (`STORE_UNAVAILABLE`); closed release defaults kept (sets `DRAFT`/`CLOSED`) |
| VI. Consent, assent & safeguarding gates | PASS | PASS | rules ported unchanged into `consentRules`/`pathwayRules` with their T04/B07 tests re-executed; no legal copy or Q09 trigger invented |
| VII. Evidence-gated interpretation | PASS | PASS | scoring master adopted: exact 20 %/40 % missingness boundaries, no imputation, `S1` default with an audited pilot-S2 switch, fail-closed wording, no score outside the released report, held Self-Worth/Savoring answers still counted; claims scanner over reports/exports/API; no bands, percentiles or reliable-change |
| VIII. Privacy minimisation | PASS | PASS | validators forbid undeclared (PII) fields; research views omit private ids; uploaded files stored only as a SHA-256; roster PII discarded as before |
| IX. Security by construction | RISK | **PASS with residual risk** | scoped data-access layer (R-M05) + least-privilege runtime credential (verified) + separate migrator; no store row-level security exists, so an application bug could bypass a scope filter → mitigated by the single-module rule (repository scan G-27), isolation tests G-21…G-26 and the verifier; throttle, TLS/at-rest, restore drill kept |
| X. Audit mode & test-first evidence | PASS | PASS | failing-first tests per guarantee G-01…G-29; evidence from PostgreSQL discarded and regenerated on a live replica set (spec FR-039); matrix IDs preserved |
| Release & launch governance | PASS | PASS | NO-GO unchanged; G1–G10 register carried over; opening participation stays a separate audited step |
| Development workflow | PASS | PASS | forward-only numbered data migrations; PR checklist items mapped to tests; new dependencies (`mongodb`, `exceljs`) assessed in R-M02; frontend holds no scoring logic |

**Result**: no *unjustified* violation. The two residual risks and the constitution-III gap are recorded below and need the owner's acknowledgement (D-M02, D-M06); the additions in data-model §9 need the owner's approval (constitution III: "explicit approval").

## Project Structure

### Documentation (this feature)

```text
specs/006-mongodb-question-upload/
├── plan.md                      # this file
├── research.md                  # Phase 0 — R-M01…R-M18 (verified facts and decisions)
├── data-model.md                # Phase 1 — collections, deltas, validators, 50 indexes, tiers, application-enforced rules
├── quickstart.md                # Phase 1 — runnable validation scenarios (local, no Docker)
├── contracts/
│   ├── upload-format.md         # the spreadsheet format that replaces the TECH_READY import
│   ├── api-delta.md             # changes to the feature-005 REST surface
│   ├── database-contract.md     # deployment, credentials, migrations, guarantees G-01…G-29
│   └── scoring-and-report.md    # scoring, evidence, quality flags, report composition, wording, switches (from the scoring master)
├── checklists/requirements.md
└── tasks.md                     # Phase 2 — /speckit-tasks (NOT created by this command)
```

### Source Code (repository root)

```text
backend/
├── .mongo/                                   # NEW, git-ignored: local instance config, keyfile, data
├── db/
│   ├── migrations/                           # NEW: 001_collections_and_validators.js, 002_indexes.js, 003_research_views.js, 004_runtime_role.js
│   └── schema/                               # NEW: collection definitions (validators, indexes, tier) — single source for migrations, verifier, tests
├── scripts/
│   ├── mongo-local.js                        # NEW: init | start | stop | status  (dedicated instance)
│   ├── db-migrate.js  db-verify.js  seed-reference.js  db-scratch.js        # NEW (migrator credential)
│   ├── questions-convert-catalog.js          # NEW: 346 questions → new spreadsheet format
│   ├── export-synthetic.js  backup-restore-drill.js  release-manifest.js    # NEW (carried over)
│   └── dev-identity-setup.js                 # ported to a Mongo collection
├── seeders/santulan/
│   ├── reference/framework.json              # NEW: the 72-subdomain map used to validate uploads
│   └── dev.seeder.js  participants.seeder.js # ported
├── src/
│   ├── config/index.js                       # + MONGODB_* keys; − DATABASE_URL, RUNTIME_DATABASE_URL, PLATFORM_DATABASE_URL
│   ├── modules/santulan/
│   │   ├── store/                            # NEW: the ONLY code that imports the driver
│   │   │   ├── client.js  scope.js  dal.js  errors.js  transactions.js
│   │   │   └── repositories/                 # one per entity; scope filter + permitted mutations only
│   │   ├── domain/                           # NEW: rules that were SQL triggers/functions
│   │   │   ├── registrationRules.js  consentRules.js  attemptRules.js  responseRules.js
│   │   │   ├── qualityRules.js  scoringRules.js  reportRules.js  growthRules.js  pathwayRules.js
│   │   │   └── controlPlane.js  exportRules.js  adminRules.js
│   │   ├── questionsets/                     # NEW: upload parser/validator, template, freeze/open, service, controller
│   │   ├── registration/ consent/ delivery/ quality/ scoring/ reporting/ growth/ pathways/   # ported: services call repositories/domain rules
│   │   ├── admin/ research/ audit/ identity/ security/ shared/                                # ported; admin + research carried over from 005
│   │   └── context/                          # REMOVED (canonicalTx.js → store/dal.js)
│   ├── shared/db.js                          # REMOVED (pg pool)
│   ├── jobs/workers/                         # inactivity, pipeline, report, export workers (ported)
│   └── routes/v1/santulan.routes.js          # + question-set routes; otherwise unchanged
├── tests/santulan/
│   ├── store/  domain/  unit/  contract/  integration/  security/  evidence/  helpers/     # store/ and domain/ are new; harness rebuilt for MongoDB
└── package.json                              # + mongodb, exceljs; − pg

frontend/src/
├── components/ResponseScale → QuestionOptions/   # variable-option answer control (radio group, accessible, no correctness cues)
├── pages/participant/AssessmentPage.jsx          # renders each item's own options
├── pages/participant/ResultsPage.jsx             # seven-axis chart from the report's PROFILE section; "Not enough data yet"
├── pages/admin/QuestionSetsPage.jsx (+ upload panel, validation table)   # NEW; replaces ItemPoolsPage
├── pages/admin/…                                 # carried over from 005 US8 (participants, institutions, monitoring, exports, audit, control)
└── services/santulanApi.js                       # + question-set calls; options in items; OPTION_OUT_OF_RANGE

REMOVED in the final phase: backend/migrations/, scripts/{migrate,santulan-grant-roles,santulan-scratch-db,santulan-generate-seed-sql,catalog-*,santulan-freeze}.js,
seeders/santulan/*.csv + MANIFEST.json, docker/init-app-role.sql, pg dependency, PostgreSQL env keys and wording.
```

**Structure Decision**: keep the existing web-application layout and module names; add `store/` (driver boundary) and `domain/` (rules) inside `modules/santulan/`, and a new `backend/db/` for data-model migrations. Service and controller files keep their names so the port is a change of what they call, not of the API. `store/` is the only importer of the driver (guarantee G-27).

## Delivery Order (drives `tasks.md`)

Each phase ends with named evidence; the system is runnable after every phase because modules are ported one at a time and the SQL code is deleted only in phase 10. Spec traceability in the right-hand column.

| Phase | Deliverable | Exit evidence | Spec |
|------:|-------------|---------------|------|
| 0 Foundations | dedicated instance script, config keys, driver client, error mapping, transaction helper, migration runner, two-credential test harness, start-up checks | G-17 tests; `db:local:status` shows `rs0` PRIMARY, auth on | FR-001, FR-002 |
| 1 Data model | collection definitions + validators, 50 indexes, views, runtime role, framework map, reference seed, `db-verify` | G-01…G-16 failing-first tests then green | FR-004, FR-005, FR-008…FR-010, FR-023 |
| 2 Scoped access layer | `withScope`, repositories, audit + idempotency services, repository-scan test | G-21…G-27 | FR-006, FR-007 |
| 3 Identity, registration, consent, roster *(feature 005 US2–US4 re-based)* | domain rules + services ported, tests re-executed | T03, T04, AT-01…09, AT-27 | FR-003 |
| 4 Question sets | parser/validator, all-or-nothing store, revisions, freeze/open/close, template, conversion helper, endpoints | upload contract suite, one-open-set, SC-002, SC-014 | FR-011…FR-018, FR-021…FR-023 |
| 5 Delivery with variable options | attempts, sessions, answers with option check, submit, control plane, inactivity worker | B05-001…045, option tests, load 40/80 | FR-019, FR-020, FR-003 |
| 6 Quality, scoring, reports, growth, pathways | scoring per [scoring-and-report §1–§4](contracts/scoring-and-report.md) (statuses, counts, evidence decision, Q06/Q07/Q09), release-switch service, report machine + worker with fail-closed wording, PROFILE payload + fingerprint, growth, pathways | B06-001…060, B07-001…080, boundary tests 100/90/80/60 %, scoring n = 2…20, wording exactness | FR-014, FR-042…FR-058, FR-003 |
| 7 Admin and research *(carried over: 005 T136–T155)* | control plane, institutions/participants, monitoring, quality review, audit log, export lifecycle + workbook + partition, synthetic 10k×222 | B08-001…084, AT-16/17/20/21/28/29/30 | FR-024…FR-033 |
| 8 Frontend | option player, question-set admin page, admin pages from 005, **Results page reading the PROFILE payload (score endpoint withdrawn; "Not enough data yet")**, release-switch admin control, API delta | frontend tests, contrast gate, build, claims scan of every participant screen | FR-019, FR-029, FR-054, FR-057, FR-058 |
| 9 Security, QA, evidence *(carried over: 005 T156–T166)* | isolation suite, abuse suite, claims scanner, AT/RC/SEC traceability register, backup-restore drill, release manifest, launch-gate register | SEC-01…30 (not 15), evidence register, restore PASS | FR-034…FR-039 |
| 10 Removal and polish *(carried over: 005 T167–T173)* | delete SQL artefacts, README/FLOWCHART/SECURITY notes, quickstart executed and recorded, constitution sweep, document reconciliation | quickstart results file, repo scan clean | FR-002, FR-040, FR-041 |

Parallelism: phases 3 and 4 can run in parallel after phase 2; phase 8 starts once phases 4 and 5 expose their endpoints; phase 7 needs phase 6 data; phase 9 needs all data-bearing phases.

## Decision register (owner confirmation)

Defaults are applied unless the owner objects; each needs a change record if the owner chooses the alternative.

| ID | Decision | Default | Alternative / revisit when |
|----|----------|---------|----------------------------|
| D-M01 | Where MongoDB runs | **dedicated second local instance**, port 27018, replica set + auth | convert the existing 27017 service (affects the other databases on it; needs restart + credentials for every client) |
| D-M02 | `responses.is_current` | keep the BUILD 01 field; update privilege on `responses`; single-operation repository | derive "current" from a supersedes chain → `responses` becomes append-only at the store (removes a BUILD 01 field and two indexes) |
| D-M03 | Retire `response_scales`; `assessment_versions` gains `revision` and loses `response_scale_id` | as data-model §3.1/§9 | keep `response_scales` as an unused entity (violates spec FR-023) |
| D-M04 | One open set per age group, store-enforced | unique partial index (two-step switch: close then open) | allow several open sets with a routing rule (needs a new decision on which participant gets which set) |
| D-M05 | Upload record | `audit_logs` entries, no new collection | a dedicated `question_uploads` collection |
| D-M06 | Cross-document and state rules are application-enforced | transactional domain rules + negative tests + verifier | none exists in MongoDB; the residual is accepted |
| D-M07 | Scoring of variable options | even position spacing onto 1–5; sets start at evidence `S1` | explicit per-option scores in the sheet, or exclude non-5-option questions from scores |
| D-M08 | Upload limits | 20 options, 2 MB, 500 questions per file; freeze requires all seven domains covered (upload only warns) | change the caps by change record |
| D-M09 | Upload strictness | `keying` = Positive only; `layer` = CORE only; `status` = READY only | accept reserved values when an approved transform/layer exists |
| D-M10 | Withdrawn participants in exports | excluded and counted in `EXPORT_METADATA` | per the approved pseudonymisation protocol (B08-AUD-012) |
| D-M11 | New dependencies | `mongodb` 7.6.0, `exceljs` 4.4.0 (D-12) | SheetJS-only export (cannot stream 2.22 M rows) |
| D-M12 | Existing data | none migrated; the old PostgreSQL dump is left untouched | a separate migration feature if real data ever exists |
| D-M13 | Scoring-master alignment additions (`score_results` counts + status, `reports.content_hash`, `interpretation_rules.layer` + one-approved-wording index) | as data-model §9 CR-006-8…10 | keep BUILD 01 columns and derive counts at export time (loses stored auditability; no fail-closed uniqueness at the store) |
| D-M14 | Report wording at S2+ | **fail closed** (whole report `FAILED_RETRYABLE`) when an S2+ domain has no approved wording | skip the section silently (feature 005 behaviour; contradicts the scoring master) |
| D-M15 | Q05 / Q07 | Q05 inactive until its protocol exists; Q07 raised for INCOMPLETE/INSUFFICIENT domains (severity LOW, assumed) | adopt RC0's Q05 warning once the protocol separates invalid duplication from reassessment |
| D-M16 | Release switches | four audited switches, all OFF, changed via `POST /admin/release-flags/{flag}` with a reason | a configuration file (rejected: needs a deploy and is not audited) |
| D-M17 | Participant score endpoint | **withdrawn**; chart read from the report's PROFILE section | keep a participant score endpoint (contradicts "no raw research score before the authorised report") |
| D-M18 | How the participant finds their report (ASSUMED; found in US8) | `GET /attempts/{id}` also returns `reportId` (id only, `null` until the report is visible: REPORT_READY / UNDER_REVIEW / NOT_ELIGIBLE) | a new `GET /reports/latest` endpoint (a new route not in the documents); returning report state in the attempt model (leaks lifecycle detail) |
| D-M19 | Submissions overview for the admin pages (ASSUMED; found in US5) | read-only `GET /admin/submissions` (list) and `GET /admin/submissions/{id}` (domain results with evidence state and completeness status, flags without Q09) | no submissions page (the pre-existing admin feature would be lost); an export-based page (exports are governed files, not a live view) |

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|------|-----------|--------------------------------------|
| **1. Cross-document invariants enforced in application code** (constitution III bullet 3 gap) | MongoDB has no foreign keys, triggers or old-vs-new validator comparisons (verified); the SQL rules (consent gate, response/version checks, report/growth/pathway guards, state machines) must live somewhere | Leaving them out would drop protections for minors; encoding them as validators is impossible. Mitigation: one transaction per action, compare-and-set, unique-index race guards, failing-first tests carrying the original matrix IDs, `db-verify` |
| **2. `update` privilege on Tier B collections; `responses.is_current`** (constitution IV residual) | The contracts allow named mutations (state, release flag, `is_current`); privileges are per collection, not per field | Making everything Tier A would forbid the permitted mutations. Mitigation: single-operation repositories, repository scan, verifier; D-M02 offers the stronger design |
| **3. A second local `mongod` instance** | Transactions and a least-privilege credential need a replica set with authentication; the shared 27017 service has neither and hosts other databases | Reconfiguring the shared service risks the owner's other work (D-M01) |
| **4. New dependencies `mongodb`, `exceljs`** | driver is mandatory; SheetJS cannot stream a 2.22 M-row workbook | hand-written OOXML is larger and riskier (R-M02, R-M11) |
| **5. Additions and one retirement in the canonical model** (data-model §9) | variable options, revisions, one open set per age group, and the scoring-master fields (result counts and status, report fingerprint, wording layer and uniqueness) | none; each is the smallest addition that meets the spec and is listed for approval |
| **6. Large port** (≈ 3,100 backend lines, ≈ 2,900 lines of SQL logic, 32 test files) | "remove SQL completely" requires it | A partial move or dual-database mode would keep the SQL and contradict the owner's decision; mitigated by module-at-a-time porting and the SQL as executable spec |

## Risks

- **Schedule**: the port is the largest single item; phases 3 and 4 in parallel and the SQL-as-spec approach reduce it.
- **Subtle behaviour loss** in SQL-to-JS rule ports (locks, edge cases): every SQL function/trigger gets a rule module and its old test ID; no rule is ported without a failing-first test.
- **Operational**: two local MongoDB processes (27017 and 27018) — the script names, ports and status command make this explicit; a wrong URI is caught by the start-up checks (G-17).
- **Evidence stale**: nothing from the PostgreSQL run counts (FR-039); the evidence register is regenerated and launch remains NO-GO.
- **Content per question set**: approved wording is keyed to the question-set id, so every newly uploaded and frozen set needs its own approved wording before the pilot-S2 switch can be turned on for it; with the default switches nothing is affected (the report is PROFILE-only).
- **Approval gap**: data-model §9 additions need the owner's approval before phase 1 migrations are written (defaults proceed unless the owner objects).
