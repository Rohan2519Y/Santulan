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
| CR-006-12 | Admin can delete a **draft** question set (`DRAFT → RETIRED`); a frozen/opened set can never be deleted | **OWNER CONFIRMED 2026-09-22** (scope: draft sets only) |
| CR-006-13 | Adult (18+) self-consent: one checkbox creates+grants+verifies `ADULT_SELF_CONSENT` in a single call (`SELF_ATTESTED` method); a minor's existing parent/guardian consent + assent flow is unchanged | **OWNER CONFIRMED 2026-09-22** (scope: adults only) |
| CR-006-14 | Minor self-service: one checkbox creates+grants+verifies both `STUDENT_ASSENT` (`SELF_ATTESTED`) and `PARENT_GUARDIAN_CONSENT` (`STUDENT_ATTESTED_FOR_PARENT`) on the minor's own device; a temporary stand-in until a real parent/guardian portal exists. The admin-mediated flow (a real parent verifying their own consent) is unchanged and still available | **OWNER CONFIRMED 2026-09-22** (scope: minor attests on their own device; distinct verification method so provenance is never confused with an actual parent action) |

## CR-006-12 / CR-006-13 — owner-directed changes (2026-09-22)

Unlike CR-006-1…11 (defaults applied pending confirmation), these two were requested directly by the owner during local
testing and their scope was confirmed by the owner before implementation, so they carry no open confirmation gate.

**CR-006-12 — delete a draft question set.** Owner report: uploading the wrong spreadsheet left no way to remove it from
the admin review list. Scoping question asked and answered: delete reaches **draft sets only**, never a `FROZEN`/`OPENED`
set — constitution IV (immutability & provenance of a frozen set) is non-negotiable and was not amended. Implementation:
`POST /admin/question-sets/{id}/delete` (a `POST` action, never the HTTP `DELETE` verb — store guarantee G-22 stays true),
reusing the existing `DRAFT → RETIRED` compare-and-set transition (`sets.retireDraft`) already used during upload
supersession. `items` stay Tier A (insert-only); nothing is physically removed, the set is simply retired. Audited as
`QUESTION_SET_DELETED`. Files: `backend/src/modules/santulan/domain/questionSetRules.js` (`assertDeletable`),
`questionSetService.js` (`deleteDraft`), `questionSet.controller.js`, `src/routes/v1/santulan.routes.js`,
`frontend/src/services/santulanApi.js`, `frontend/src/pages/admin/QuestionSetsPage.jsx`. Tests:
`backend/tests/santulan/contract/questionSetsLifecycle.test.js` ("CR-006-12" describe block),
`frontend/src/tests/adminDashboard.test.js`.

**CR-006-13 — adult self-consent.** Owner report: could not give an assessment locally because there was no path to
verify consent for a test participant, short of the not-yet-written parent/guardian protocol text. Scoping question asked
and answered: the one-checkbox self-consent applies to **adults only** (`isMinor === false`); a minor's existing
parent/guardian consent + assent flow is completely unchanged — no safeguarding gate was touched or amended.
Implementation: `POST /consents/self-consent` (participant token), which creates, grants and verifies the participant's
own `ADULT_SELF_CONSENT` record in one call using a newly owner-approved verification method, `SELF_ATTESTED`, added to
`ADULT_SELF_CONSENT`'s `allowedVerificationMethods` in `CONSENT_PROTOCOLS_PATH` (deliberately **absent** from the two
minor-facing consent types' allow-lists). A minor's token gets `422 SELF_CONSENT_NOT_AVAILABLE`. No approved
`ADULT_SELF_CONSENT` protocol configured (fail-closed default) → `422 PROTOCOL_UNAPPROVED`, same governance pattern as
every other consent type. Files: `backend/src/modules/santulan/consent/protocolRegistry.js` (`currentApprovedVersion`),
`consentService.js` (`selfConsent`), `consent.controller.js`, `src/routes/v1/santulan.routes.js`,
`backend/config/consent-protocols.example.json`, `backend/config/README.md`,
`frontend/src/services/santulanApi.js`, `frontend/src/pages/participant/AccountPages.jsx` (`PrivacyPage`). Tests:
`backend/tests/santulan/contract/consent.test.js`, `frontend/src/tests/selfConsent.test.js` (new file).

**CR-006-14 — minor self-service.** Owner follow-up after CR-006-13: the same local-testing blocker existed for a minor
participant, since neither `PARENT_GUARDIAN_CONSENT` nor `STUDENT_ASSENT` can be created or completed without an admin,
and there is no separate parent-facing sign-in on this platform. Two scoping questions were asked and answered before any
code was written, because this touches the minor safeguarding gate directly: (1) the owner does **not** want the parent
requirement silently removed for minors — the gate stays exactly as strict (two VERIFIED records still required to open
it); (2) the checkbox is ticked by **the student themselves, on their own device**, as an explicit, deliberate stand-in
for a real parent/guardian portal that does not exist yet, not a dev-only shortcut. Implementation:
`POST /consents/minor-self-service` (participant token, minors only - `422 PARENT_CONSENT_NOT_APPLICABLE` for an adult),
which creates, grants and verifies **both** required records in one call: `STUDENT_ASSENT` with method `SELF_ATTESTED`
(a genuine self-attestation, no safeguarding concern), and `PARENT_GUARDIAN_CONSENT` with a **new, distinct** method,
`STUDENT_ATTESTED_FOR_PARENT`, so the audit trail can never be misread as an actual parent's own action. The two records
are independent (different collections' worth of protocol governance); if one type's protocol is unapproved the other's
completion still stands (not rolled back), matching the system's general small-independent-steps philosophy rather than
one giant cross-type transaction. The existing store-level uniqueness guarantee
(`uq_consent_active_type_protocol` - one active record per participant/type/protocol version) is unchanged and still
governs the real upgrade path: a real parent/guardian who wants to formally take over must first withdraw the
student-attested record (the participant can do this themselves, same as withdrawing any other consent), then the
ordinary admin-mediated flow (`POST /consents` + `POST /consents/:id/verify`) verifies a fresh one exactly as before.
Files: `backend/src/modules/santulan/consent/consentService.js` (`grant` gained an `allowNonSelf` escape hatch used only
by this flow; `ensureVerified`, `minorSelfService`), `consent.controller.js`, `src/routes/v1/santulan.routes.js`,
`backend/config/consent-protocols.example.json`, `backend/tests/santulan/fixtures/consent-protocols.json`,
`backend/config/README.md`, `frontend/src/services/santulanApi.js`,
`frontend/src/pages/participant/AccountPages.jsx` (`PrivacyPage`). Tests:
`backend/tests/santulan/contract/consent.test.js`, `frontend/src/tests/minorSelfService.test.js` (new file),
`frontend/src/tests/selfConsent.test.js` (its stale "minor: unchanged" assertions updated to match).

**CR-006-13 / CR-006-14 — presentation update (2026-09-23).** Owner reference: a consent popup from a different product
(a "relationship" chooser plus consent text in a modal, with "Agree & Approve"). No functional or endpoint change - the
same two calls (`POST /consents/self-consent`, `POST /consents/minor-self-service`), the same two verification methods,
and the same gate rules as above. Only the Privacy page's presentation changed: the checkbox that sat directly on the
page is now inside a popup (the existing `Modal`/`ConfirmDialog` components, already used elsewhere in the admin UI),
opened from a "Review consent form" button, titled "Consent Form" (adult) or "Parent / Guardian Consent" (minor), and
showing a short placeholder consent paragraph above the checkbox - explicitly marked as placeholder text pending the
owner's approved wording, never invented legal copy. The reference's sign-up form (name/email/password) was **not**
adopted: it directly conflicts with the constitution's ban on storing a participant's name, email or password (OPEN
registration stays OTP-only, unchanged). Files: `frontend/src/pages/participant/AccountPages.jsx` (`PrivacyPage`),
`frontend/src/styles/ui.module.css` (`.consentText`). Tests: `frontend/src/tests/selfConsent.test.js`,
`frontend/src/tests/minorSelfService.test.js` (both rewritten for the popup interaction).

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
