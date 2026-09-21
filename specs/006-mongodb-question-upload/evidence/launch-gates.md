# Launch gates and release decision — feature 006 (MongoDB, variable-option question sets)

**Current release decision: NO-GO.** Nothing in this feature changes that. Feature 006 replaced the storage layer and the question
format; every piece of runtime evidence that existed for the PostgreSQL build is **stale** (see
`backend/tests/santulan/evidence/register.postgresql-2026-09-20.json`, marked NOT APPLICABLE). A gate becomes anything other than
`NOT_EXECUTED` only with real evidence from an execution the owner can point to — not because a test passed on a developer machine.

Sources: `docs/Santulan 2.0/RELEASE_01_System_Qualification_and_Pilot_Release/…Execution_Control_v1_0.xlsx` (sheets 01_LAUNCH_GATES,
07_GO_NO_GO, 09_EXECUTION_CONTROL, 10_RELEASE_DECISION) and BUILD 09. Constitution v3.0.0.

## 1. Launch gates G1–G10

| Gate | Name | Requirement | Evidence link | Owner | Status |
|------|------|-------------|---------------|-------|--------|
| G1 | Schema | Open / institutional nullability, participation-route rules, parent-institution self-reference tested. | Store validator suites `backend/tests/santulan/store/validators.*.test.js` (developer machine only) | `TODO(GOVERNANCE_OWNERS)` | NOT_EXECUTED |
| G2 | Identity | OTP / password / credential-reset security; age-declaration → consent routing for minor and adult. | — | `TODO(GOVERNANCE_OWNERS)` | NOT_EXECUTED |
| G3 | Assessment | Four-session resume and reconnect; answer versioning with exactly one current answer. | — | `TODO(GOVERNANCE_OWNERS)` | NOT_EXECUTED |
| G4 | Measurement | Frozen question-set / question / option-scale / scoring versions verified (content hash, revision). | `backend/release/manifest.json` (generate with `npm run release:manifest`) | `TODO(GOVERNANCE_OWNERS)` | NOT_EXECUTED |
| G5 | Quality | Quality flags and hard-stop logic verified (Q06 stop, Q07 per incomplete domain, Q09 only from an approved trigger). | — | `TODO(GOVERNANCE_OWNERS)` | NOT_EXECUTED |
| G6 | Reporting | Report ready, retry and reproducibility verified (content hash, fail-closed wording). | — | `TODO(GOVERNANCE_OWNERS)` | NOT_EXECUTED |
| G7 | Research | 10,000 × 222 export partitioning, codebook and anonymisation verified. | `npm run export:synthetic -- --participants 10000 --items 222` (not yet run for the record) | `TODO(GOVERNANCE_OWNERS)` | NOT_EXECUTED |
| G8 | Security | Authorisation, tenant isolation, registration-abuse protection, backup / restore and audit verified on the target environment. | `backend/scripts/backup-restore-drill.js` (not yet run for the record) | `TODO(GOVERNANCE_OWNERS)` | NOT_EXECUTED |
| G9 | Psychometric governance | No prohibited claim exposed in any participant screen, report or export. | `backend/tests/santulan/helpers/claimsScanner.js`, `frontend/src/tests/claimsScan.test.js` | `TODO(GOVERNANCE_OWNERS)` | NOT_EXECUTED |
| G10 | Operational QA | AT-01…AT-32 and RC-01…RC-12 pass; the release manifest is signed off. | — | `TODO(GOVERNANCE_OWNERS)` | NOT_EXECUTED |

## 2. Execution register E1–E11 (RELEASE_01)

All of these need a deployed staging or pilot environment and human approvals that are not available to a development session.

| Item | Workstream | Required action | Evidence required | Status | Blocker / next action |
|------|------------|-----------------|-------------------|--------|-----------------------|
| E1 | Environment | Confirm staging / pilot endpoints, the MongoDB deployment (replica set, authorization, TLS) and the release commit. | Environment ids, commit, migration set (`backend/release/manifest.json`) | BLOCKED | No staging environment. Local development uses a dedicated single-node replica set on port 27018. |
| E2 | Tenant isolation | Run the isolation tests (SEC-01…SEC-12, G-21…G-26) against staging with real institution data shapes. | Test output + role / privilege dump | BLOCKED | Needs the staging database. |
| E3 | Abuse protection | Configure CAPTCHA or an equivalent plus IP / device registration throttles; note that the in-memory throttle needs a **shared store** in any multi-instance deployment. | Configuration record + SEC-13…SEC-18 evidence | BLOCKED | Needs the OPEN-registration deployment. |
| E4 | Canonical QA | Execute AT-01…AT-32 and RC-01…RC-12 (44 records). | 44 PASS / FAIL records with evidence | BLOCKED | Needs a running staging application. |
| E5 | Security QA | Execute SEC-01…SEC-30 (SEC-15 is a documented non-applicable item). | 30 PASS / FAIL records | BLOCKED | Needs running infrastructure. |
| E6 | Backup | Create a full pre-release backup. | Backup id, time, operator | BLOCKED | Needs the target backup platform. |
| E7 | Restore | Restore the E6 backup into a clean recovery environment and verify it. | Restore log + verification (`scripts/backup-restore-drill.js` evidence) | BLOCKED | Needs a recovery environment. The drill exists; it has not been run for the record. |
| E8 | Launch gates | Close G1–G10 with owner sign-off. | Gate evidence + sign-off | BLOCKED | Depends on E2–E7. |
| E9 | Runbook | Obtain the official Launch Day Runbook (Handover 08) and reconcile it with this package. | Reconciliation record | BLOCKED | The official runbook is not among the project sources. |
| E10 | Consent / safeguarding | Confirm the approved consent copy and a live Q09 → P5 human handoff. | Approval + a synthetic trigger run | BLOCKED | Needs protocol and operational approvals from people outside engineering. |
| E11 | Release decision | Sign the Pilot Release Candidate manifest. | Signed go / no-go record | NO-GO | E1–E10 incomplete. |

## 3. NO-GO conditions (any one blocks release)

| Condition | Severity | Current position |
|-----------|----------|------------------|
| Any cross-institution data leakage | CRITICAL | Application-enforced scoped access is built and tested locally; **not** verified on staging. Open. |
| A minor reaches an attempt without the required verified consent | CRITICAL | Consent gate built and tested locally; staging evidence missing. Open. |
| Raw response update or delete is possible | CRITICAL | The runtime credential has no `remove` anywhere and no update on append-only collections; tested locally. Needs re-verification on the target deployment. Open. |
| Q09 / P5 human handoff unavailable | CRITICAL | The hook exists; the human workflow is an owner decision. **Open.** |
| Backup cannot be restored | CRITICAL | Drill script written, not yet executed for the record. **Open.** |
| Any critical AT / RC / security test failure | CRITICAL | 44 + 30 records not executed on the new store. **Open.** |
| OPEN registration abuse protection absent | CRITICAL | In-memory throttle present; CAPTCHA / shared store not configured. **Open.** |
| Unapproved psychometric or diagnostic claim exposed | CRITICAL | Scanner passes locally; the report fails closed without approved wording. Owner approval of wording is outstanding. Open. |
| A privileged operation can occur without audit | CRITICAL | Audit-in-the-same-transaction is built and tested locally. Needs staging evidence. Open. |
| Production assessment / content / scoring version unknown | CRITICAL | The manifest script fingerprints them; no production version exists yet. **Open.** |

## 4. Open governance items

Each is a decision or approval that engineering cannot make. Until it is recorded here with an owner and a date, the related behaviour
stays at its safe default.

| # | Item | Safe default in the build | Owner |
|---|------|---------------------------|-------|
| 1 | Approved legal consent and assent copy, and the approved protocol versions and verification methods | Consent requires an approved protocol id; none is bundled | `TODO(GOVERNANCE_OWNERS)` |
| 2 | Q09 safeguarding trigger source and the human Q09 → P5 workflow | Q09 fires only from an approved trigger source; none is configured | `TODO(GOVERNANCE_OWNERS)` |
| 3 | Evidence promotion and the pilot-S2 approval | All four release switches OFF; every domain stays S1 (research only) | `TODO(GOVERNANCE_OWNERS)` |
| 4 | Approved report wording for every question set, domain and layer (S2 and above) | No wording is seeded; an S2 report fails closed (`WORDING_MISSING`) | `TODO(GOVERNANCE_OWNERS)` |
| 5 | Approval of the scoring rules for variable option counts (value = 1 + (position − 1) × 4 / (options − 1)) | Applied as the documented default; awaiting confirmation (D-M decisions) | `TODO(GOVERNANCE_OWNERS)` |
| 6 | Session inactivity timeout duration | Disabled while `SESSION_INACTIVITY_MINUTES` is unset | `TODO(GOVERNANCE_OWNERS)` |
| 7 | Fifth-session wording | Placeholder in `backend/config/messages.json` | `TODO(GOVERNANCE_OWNERS)` |
| 8 | Registration throttle limits and the CAPTCHA (or equivalent) choice | Limits from configuration; in-memory store only | `TODO(GOVERNANCE_OWNERS)` |
| 9 | RPO and RTO for backup and restore | Not set; the drill records measured durations as an input | `TODO(GOVERNANCE_OWNERS)` |
| 10 | Browser and device support matrix | Not defined | `TODO(GOVERNANCE_OWNERS)` |
| 11 | The official Launch Day Runbook (Handover 08) | Not present in the sources | `TODO(GOVERNANCE_OWNERS)` |
| 12 | Owner confirmation of change record CR-006-1…11 and decisions D-M01…D-M19 | Defaults applied, marked "awaiting owner confirmation" in `change-record-006.md` | `TODO(GOVERNANCE_OWNERS)` |
| 13 | Production deployment of MongoDB (replica set, TLS, at-rest encryption, network rules, backups) | Local development instance only | `TODO(GOVERNANCE_OWNERS)` |

## 5. Decision record

| Field | Value |
|-------|-------|
| Engineering package for feature 006 | Built on the local dedicated MongoDB instance; see `quickstart-results.md` |
| Runtime evidence for G1–G10 | 0 of 10 closed |
| Canonical AT / RC | 0 of 44 executed on the new store |
| Security qualification | 0 of 30 executed on the new store |
| Backup restore | Drill written; **not executed for the record** |
| **Release decision** | **NO-GO** — may change only after every critical prerequisite above has real evidence and a signed owner decision |

## 6. Confirmation at the close of feature 006 (2026-09-21)

Launch status re-checked: **still NO-GO.** All ten gates are `NOT_EXECUTED`, E1–E10 are BLOCKED and E11 is NO-GO; no gate was moved
by the work in this feature. The feature-006 test tasks (evidence-register runs, load export, backup drill, security suites) were
deliberately **not executed** in this closing pass at the owner's instruction ("skip the test for now"), so none of that evidence exists yet.

What remains for the owners before the decision can change:

1. **Approved consent and assent copy** and the approved protocol versions / verification methods (item 1).
2. **The Q09 / P5 human safeguarding workflow** and the approved trigger source (item 2; E10).
3. **Pilot-S2 approval and evidence promotion** — until then every domain stays S1 and all four release switches stay OFF (item 3).
4. **Approved report wording for every question set** (domain × layer, S2 and above) — without it an S2 report fails closed (item 4).
5. **Approval of the scoring rules for variable option counts** — the default (value = 1 + (position − 1) × 4 / (options − 1)) is applied (item 5).
6. **Confirmation of change record CR-006-1…11 and decisions D-M01…D-M19** (item 12) and reconciliation of the locked documents that still
   describe PostgreSQL (`document-reconciliation.md`).
7. **Staging execution of every `NOT_EXECUTED` item** — E1 (MongoDB deployment with replica set, authorization, TLS), E2 (isolation on
   real data shapes), E3 (CAPTCHA / shared throttle store), E4 (AT-01…AT-32, RC-01…RC-12), E5 (SEC-01…SEC-30), E6–E7 (backup and a
   real restore), E8 (gate sign-off), E9 (the official Launch Day Runbook), E10 (consent and Q09 → P5 handoff), E11 (signed decision).
8. Production MongoDB deployment (TLS, at-rest encryption, network rules, backups), RPO/RTO, the inactivity timeout, the fifth-session
   wording, the throttle limits, and the browser / device support matrix (items 6–11, 13).
