# Change Record CR-006: MongoDB as the only system of record, spreadsheet question upload, scoring master

| Field | Value |
|-------|-------|
| change_id | CR-006 |
| date | 2026-09-20 |
| owner | project owner (mentorkuldeep@gmail.com) |
| constitution | amended 2.0.1 -> **3.0.0** (MAJOR) |
| status | implementation in progress; launch remains **NO-GO** |

## Rationale

Owner direction (spec input and clarification, 2026-09-20): remove SQL completely and run on the document database; upload questions from the new spreadsheet format (2-20 options per question) replacing the old import format; carry the undone feature-005 work (T136-T173) into this feature; follow the scoring master `docs/Santulan_Scoring_and_Report_Generation_Layman_Master_Audit_ON_v1_0.docx`.

## Source evidence

`specs/006-mongodb-question-upload/spec.md`, `plan.md`, `research.md` (R-M01...R-M19), `data-model.md` section 9, `contracts/*`.

## Affected artifacts and entities

All 27 canonical collections plus one non-canonical dev collection; 9 views; 50 named indexes; `response_scales` retired; new fields listed in `data-model.md` section 3.

## Migration

`backend/db/migrations/001_collections_and_validators.js`, `002_indexes.js`, `003_research_views.js`, `004_runtime_role.js` (forward-only; SHA-256 recorded in `_data_migrations`).

## Test impact

Every suite is re-executed on MongoDB. Evidence from the PostgreSQL run (333 tests, feature 005) does **not** apply (spec FR-039) and is archived as not applicable.

## Release-gate impact

Launch stays NO-GO. PostgreSQL qualification evidence is stale; every matrix ID must pass again on MongoDB before it is registered as PASS.

## Design-document fingerprints (SHA-256 at the time of task generation)

| File | SHA-256 |
|------|---------|
| `spec.md` | `474f4b3deab2b409146b7d9ec993ccc9126e00f915ef840ffbf32ea986b2fff3` |
| `plan.md` | `4bb42b44d4f9e73dadb1d83132c8ec08c89c0e9cc82e3babd459aa5d9beb1bdd` (revised during implementation — decisions D-M18/D-M19 added; current hash in the final table below) |
| `research.md` | `1344efc0034553b2436389702a24322a0b2ddf9d938560e5bb65d592a5da1607` |
| `data-model.md` | `b60736d44dbf84d484a12a777ce7cf94c3901dd590bb7e58c69dec3285143fea` |
| `quickstart.md` | `7128375826841b74bf89522c24d726677c6b7875829f2f78c50790d5bb94036d` |
| `contracts/upload-format.md` | `9887b83ba04a6ec2b1023dc0609b1c38e1fce5c7604cc77453b3518f5f9af585` |
| `contracts/api-delta.md` | `519c8d5ac0a9b2834778f35796b9f80585a55088d12c4e38740ca8c9b886f4a6` (revised during implementation — current hash in the final table below) |
| `contracts/database-contract.md` | `ff7f8f1e53366247919ebbd1bdf2f6517a21ae819c145781a5a58c0287d6436b` |
| `contracts/scoring-and-report.md` | `30b756ada11f713a7a970e1e8f54f7e831284cc1f8e74cf27557e5a41c35f606` |

## Change items awaiting owner confirmation

| # | Change | Status |
|---|--------|--------|
| CR-006-1 | MongoDB replaces PostgreSQL as the only system of record | DEFAULT APPLIED - awaiting owner confirmation |
| CR-006-2 | Added `items.options` (embedded, immutable, 2-20) | DEFAULT APPLIED - awaiting owner confirmation |
| CR-006-3 | Retired entity `response_scales` and field `assessment_versions.response_scale_id` | DEFAULT APPLIED - awaiting owner confirmation |
| CR-006-4 | Added `assessment_versions.revision`; indexes `uq_one_open_set_per_age_group`, `uq_one_live_revision_per_label` | DEFAULT APPLIED - awaiting owner confirmation |
| CR-006-5 | `response_value` holds the option position; scoring by even position spacing | DEFAULT APPLIED - awaiting owner confirmation |
| CR-006-6 | Upload record realised as `audit_logs` entries (no new collection) | DEFAULT APPLIED - awaiting owner confirmation |
| CR-006-7 | Non-canonical `dev_identity_credentials` collection (dev only) | DEFAULT APPLIED - awaiting owner confirmation |
| CR-006-8 | Added `score_results.eligible_items`, `valid_items`, `completeness_status`; 60 % complete is INSUFFICIENT | DEFAULT APPLIED - awaiting owner confirmation |
| CR-006-9 | Added `reports.content_hash` | DEFAULT APPLIED - awaiting owner confirmation |
| CR-006-10 | Added `interpretation_rules.layer` and index `uq_one_approved_rule_per_dimension` | DEFAULT APPLIED - awaiting owner confirmation |
| CR-006-11 | Release switches recorded as `RELEASE_FLAG_CHANGED` audit events | DEFAULT APPLIED - awaiting owner confirmation |

## Decisions and their outcome

Outcome as of **2026-09-21**: the owner has recorded **no confirmation or change** for any change item (CR-006-1…11) or decision
(D-M01…D-M19). Every default therefore **stands as applied** and stays flagged for confirmation (launch-gates.md, open governance
item 12). The "Applied default" column is the value in force in the code.

| # | Subject | Applied default | Outcome |
|---|---------|-----------------|---------|
| D-M01 | Where MongoDB runs | dedicated second local instance, port 27018, replica set + auth | DEFAULT STANDS - awaiting owner confirmation |
| D-M02 | `responses.is_current` | BUILD 01 field kept; `update` privilege on `responses`; single-operation repository (`retireCurrent`) | DEFAULT STANDS - awaiting owner confirmation |
| D-M03 | Retire `response_scales`; `assessment_versions` gains `revision`, loses `response_scale_id` | as data-model §3.1/§9 | DEFAULT STANDS - awaiting owner confirmation |
| D-M04 | One open set per age group, store-enforced | unique partial index `uq_one_open_set_per_age_group` | DEFAULT STANDS - awaiting owner confirmation |
| D-M05 | Upload record | `audit_logs` entries, no new collection | DEFAULT STANDS - awaiting owner confirmation |
| D-M06 | Cross-document and state rules | application-enforced (transactional domain rules + negative tests + verifier) | DEFAULT STANDS - awaiting owner confirmation |
| D-M07 | Scoring of variable options | even position spacing onto 1-5; sets start at evidence S1 | DEFAULT STANDS - awaiting owner confirmation |
| D-M08 | Upload limits | 20 options, 2 MB, 500 questions per file; freeze requires all seven domains covered | DEFAULT STANDS - awaiting owner confirmation |
| D-M09 | Upload strictness | `keying` Positive, `layer` CORE, `status` READY only | DEFAULT STANDS - awaiting owner confirmation |
| D-M10 | Withdrawn participants in exports | excluded and counted in `EXPORT_METADATA` | DEFAULT STANDS - awaiting owner confirmation |
| D-M11 | New dependencies | `mongodb` 7.6.0, `exceljs` 4.4.0 | DEFAULT STANDS - awaiting owner confirmation |
| D-M12 | Existing data | none migrated; old PostgreSQL dump left untouched (`backend/backups/`) | DEFAULT STANDS - awaiting owner confirmation |
| D-M13 | Scoring-master alignment additions | `score_results` counts + status, `reports.content_hash`, `interpretation_rules.layer` + one-approved-wording index | DEFAULT STANDS - awaiting owner confirmation |
| D-M14 | Report wording at S2+ | fail closed (`FAILED_RETRYABLE`) when an S2+ domain has no approved wording | DEFAULT STANDS - awaiting owner confirmation |
| D-M15 | Q05 / Q07 | Q05 inactive until its protocol exists; Q07 for INCOMPLETE/INSUFFICIENT domains (severity LOW, assumed) | DEFAULT STANDS - awaiting owner confirmation |
| D-M16 | Release switches | four audited switches, all OFF, `POST /admin/release-flags/{flag}` with a reason | DEFAULT STANDS - awaiting owner confirmation |
| D-M17 | Participant score endpoint | withdrawn; chart read from the report's PROFILE section | DEFAULT STANDS - awaiting owner confirmation |
| D-M18 | How the participant finds their report (ASSUMED, found in US8) | `GET /attempts/{id}` also returns `reportId` | DEFAULT STANDS - awaiting owner confirmation |
| D-M19 | Submissions overview for the admin pages (ASSUMED, found in US5) | read-only `GET /admin/submissions` and `/admin/submissions/{id}` | DEFAULT STANDS - awaiting owner confirmation |

The change items CR-006-1…11 above keep the status `DEFAULT APPLIED - awaiting owner confirmation`.

## Migration file fingerprints (final)

SHA-256 of the file bytes, computed the same way `scripts/db-migrate.js` records it in `_data_migrations`. Recorded 2026-09-21.

| Migration | SHA-256 |
|-----------|---------|
| `backend/db/migrations/001_collections_and_validators.js` | `17e9c0783231c6e8d528dccefd7c88e6246d676f10bf6420be9dc7884f6b31ea` |
| `backend/db/migrations/002_indexes.js` | `a1943c9d679fe1fed3394b58af5410a64c958d7583c5592836fd5000e4fa0f69` |
| `backend/db/migrations/003_research_views.js` | `895701229345ee2f41bf27ea1fadb2552d64a29d5549f506073698ac553123a1` |
| `backend/db/migrations/004_runtime_role.js` | `67a3f92ceb1e61ca7b609a771f646bc4137749577e7aa85614a9da78f702f7c8` |

An applied migration is never edited; a fix is a new numbered file. Re-run `sha256sum backend/db/migrations/*.js` and compare before
any release.

## Design-document fingerprints (final, 2026-09-21)

| File | SHA-256 | Changed since task generation |
|------|---------|-------------------------------|
| `spec.md` | `474f4b3deab2b409146b7d9ec993ccc9126e00f915ef840ffbf32ea986b2fff3` | no |
| `plan.md` | `e6921bec742a0efc4b3101d70239b369521a10fbab0d3aa7f1eb9a4b26cb9107` | **yes** (D-M18, D-M19) |
| `research.md` | `1344efc0034553b2436389702a24322a0b2ddf9d938560e5bb65d592a5da1607` | no |
| `data-model.md` | `b60736d44dbf84d484a12a777ce7cf94c3901dd590bb7e58c69dec3285143fea` | no |
| `quickstart.md` | `7128375826841b74bf89522c24d726677c6b7875829f2f78c50790d5bb94036d` | no |
| `contracts/upload-format.md` | `9887b83ba04a6ec2b1023dc0609b1c38e1fce5c7604cc77453b3518f5f9af585` | no |
| `contracts/api-delta.md` | `0032941af0fd3419f872cca788a96cda5e1b65c93f80ced8804a8e4fc814d36c` | **yes** (`reportId` on `GET /attempts/{id}`, D-M18; revised after task generation) |
| `contracts/database-contract.md` | `ff7f8f1e53366247919ebbd1bdf2f6517a21ae819c145781a5a58c0287d6436b` | no |
| `contracts/scoring-and-report.md` | `30b756ada11f713a7a970e1e8f54f7e831284cc1f8e74cf27557e5a41c35f606` | no |
