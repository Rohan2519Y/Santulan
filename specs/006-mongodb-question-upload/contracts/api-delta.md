# Contract: API Delta (feature 005 → feature 006)

**Feature**: 006-mongodb-question-upload | **Base**: `specs/005-v3-1-canonical-alignment/contracts/api.md` | **Spec**: [../spec.md](../spec.md)

The REST surface of feature 005 (registration, consent, delivery, quality/scoring, reports, growth, pathways, admin, research export — `/api/v1`) is **unchanged in paths, auth model, envelopes and error shape** except where this document says otherwise. Storage leaves no trace in the API. Authorization, idempotency, strict request schemas (unknown keys → `400 VALIDATION_ERROR`), correlation ids and the rule that no endpoint accepts scores, versions, Santulan IDs, participant ids or store scope all carry over.

## 1. New endpoints — question sets (active Super Admin only)

| Endpoint | Purpose | Notes |
|----------|---------|-------|
| `GET /admin/question-sets/template` | Download the blank template workbook | `Content-Disposition` attachment; generated |
| `POST /admin/question-sets` | Upload a spreadsheet as a draft set | `multipart/form-data`: `file` (`.xlsx`, ≤ 2 MB), `ageGroup` (`ADOLESCENT`\|`EMERGING_ADULT`). `201` created / `200` identical no-op |
| `GET /admin/question-sets` | List sets and revisions | filter `ageGroup`, `status`; each row: id, label, revision, ageGroup, status, participationState, questionCount, optionCount, contentHash, sourceFileHash, frozenAt, createdAt |
| `GET /admin/question-sets/{id}` | One set with all questions and options | for review before freezing |
| `POST /admin/question-sets/{id}/freeze` | `DRAFT → FROZEN` | body `{}`; prerequisites in upload-format §4; audited |
| `POST /admin/question-sets/{id}/open` | open for participation | body `{ reason }`; audited; `409 OPEN_SET_EXISTS` |
| `POST /admin/question-sets/{id}/close` | close participation | body `{ reason }` (required); existing attempts unaffected; audited |
| `POST /admin/question-sets/{id}/delete` | **CR-006-12**: `DRAFT → RETIRED`, a draft set only | body `{}`; a `POST` action, never the HTTP `DELETE` verb (store guarantee G-22: no HTTP DELETE route exists anywhere in the API); a `FROZEN`/`OPENED` set can never be deleted (`409 SET_NOT_DRAFT` — constitution IV, no amendment); items are Tier A insert-only so nothing is physically removed, the set is simply retired and never offered for freeze/open again; audited as `QUESTION_SET_DELETED` |
| `POST /admin/question-sets/{id}/items/{itemId}/status` | **Built after feature 006 (ASSUMED addition, no change record was raised at the time)**: shows or hides one question from participants (`items.status` `ACTIVE`↔`RETIRED`) | body `{ status: 'ACTIVE'\|'RETIRED', reason }` (reason required, 3–300 chars); only on a `FROZEN` set (`409 SET_NOT_FROZEN` on a draft); refused (`409 SET_INCOMPLETE`) if hiding would leave the question's domain with no question showing for its age group; only a `CORE` layer question has this choice (`422 INVALID_STATE` otherwise — a non-core question is never delivered regardless of status); the question's text and options never change either way; migration 005 is the one documented exception to "Tier A has no update path", narrowed to this single field at the application layer (`access.js`); audited as `QUESTION_ITEM_HIDDEN`/`QUESTION_ITEM_SHOWN` |
| `GET /admin/question-sets/{id}/response-distribution` | **Built after feature 006 (ASSUMED addition, no change record was raised at the time)**: per-question response distribution for one assessment | for every question in the set: how many completed attempts (status `SUBMITTED` or later — one still in progress hasn't skipped anything, it just hasn't reached that question yet) chose each option, and how many left it unanswered; response shape `{ ...set summary, totalAttempts, items: [ { itemId, itemCode, domainCode, displayOrder, questionText, status, options: [ { position, text, count } ], answeredCount, skippedCount } ] }`; aggregate counts only — no participant's individual answer appears, so unlike the submissions raw-answers view above, the read is **not audited** |
| `GET /admin/question-sets/{id}/response-distribution/export` | same report as a downloadable `.xlsx` workbook | two sheets, same numbers: **"Response distribution"** is a flat, pivot-friendly table (one row per question/answer, every option plus a trailing "Skipped" row); **"Chart view"** lays out the same rows per question with an Excel-native Data Bar (conditional formatting, not a picture or a chart object — neither `xlsx`/SheetJS's free tier nor `exceljs` can write true chart objects) on the response count, scaled `0`..`totalAttempts` so every bar is comparable across every question on the sheet; filename `santulan-response-distribution-{versionLabel}-r{revision}.xlsx`; not audited, same reasoning as the JSON endpoint above |
| `GET /admin/question-sets/{id}/unified-export` | **Built after feature 006 (ASSUMED addition, no change record was raised at the time)**: the "unified report+research workbook" (`santulan-report-research-format-v1`) that the external Santulan pilot kit's own report generator and verifier read (`docs/Santulan 2.0/santulan_pilot_kit/TECH_TEAM_GUIDE.md`) | synchronous (no `REQUESTED`/`GENERATING`/`READY` lifecycle — this is pilot-scale, one admin click, one file); covers every attempt ever made against this set (any status past `CREATED`/`STARTED`/`IN_PROGRESS`/`PAUSED`), plus every participant referenced by those attempts; sheets: `README`, `DATA_DICTIONARY`, `PARTICIPANTS`, `IDENTITY`, `ATTEMPTS`, `DOMAIN_RESULTS`, `REPORT_SETTINGS`, `ITEM_RESPONSES_LONG_01`, `ITEM_CODEBOOK`, `CONFIG` — the exact set the kit expects; **a SEPARATE export from `/research-exports` below**: this one carries real names (`IDENTITY`, joined from `participant_pilot_details`) and real per-domain means (`DOMAIN_RESULTS`), because it feeds report generation, not research distribution, and `participant_pilot_details` is otherwise never joined into any export; `DOMAIN_RESULTS.domain_mean`/`items_expected`/`items_answered` are recomputed from current item responses (not read from `score_results`) specifically to hold out subdomain `C4.2` from the mean (the kit's own rule A12) — found dynamically per set from each set's own item catalog (`subdomain_code = 'C4.2'`), never a fixed item-code list, because the two held-out item codes differ between the adolescent and emerging-adult forms; the live `score_results` collection (and therefore real reports, growth plans, pathway decisions) is untouched by this recomputation; filename `santulan-unified-report-export-{versionLabel}-r{revision}.xlsx`; not audited (same reasoning as the response-distribution endpoints: an aggregate-and-identify export read, not a write) |

### 1.1 Upload response

```json
{ "setId": "…", "versionLabel": "…", "revision": 1, "ageGroup": "ADOLESCENT", "status": "DRAFT",
  "participationState": "CLOSED", "questionCount": 10, "optionCount": 50, "contentHash": "…64 hex…",
  "created": true, "supersededRevision": null, "warnings": [ { "code": "DOMAIN_WITHOUT_QUESTIONS", "column": null, "row": null, "message": "…" } ] }
```

### 1.2 Upload rejection

`422` with the standard error envelope and `details`:

```json
{ "error": { "code": "UPLOAD_VALIDATION_FAILED", "message": "The file has 3 problems; nothing was saved.",
  "totalProblems": 3, "details": [ { "row": 4, "column": "domain_code", "code": "DOMAIN_CODE_UNKNOWN", "message": "…" } ] } }
```

`details` is capped at 200; file-level problems have `row: null`.

## 1b. New endpoints — release switches (active Super Admin only; scoring master §15)

| Endpoint | Purpose | Notes |
|----------|---------|-------|
| `GET /admin/release-flags` | current value of the four switches | `{ pilotS2, advancedEvidence, developmentRelease, pathwayRelease }`, each `{ value, changedAt, changedBy?, reason? }`; a switch never changed reads `false` |
| `POST /admin/release-flags/{flag}` | set one switch | body `{ value: boolean, reason }` (reason required, 3–300 chars); audited in the same transaction as the change (`RELEASE_FLAG_CHANGED`); no deployment or restart; unknown flag → `404` |

## 1c. New endpoint — adult self-consent (participant token; CR-006-13)

| Endpoint | Purpose | Notes |
|----------|---------|-------|
| `POST /consents/self-consent` | an adult (18+) participant confirms their own `ADULT_SELF_CONSENT` in one call | body `{}`; creates, grants and verifies the consent record in a single call (`verification_method: SELF_ATTESTED`, an owner-approved method added to `CONSENT_PROTOCOLS_PATH`'s `ADULT_SELF_CONSENT` allow-list); calling it again while already `VERIFIED` returns the existing record unchanged (idempotent no-op, not a duplicate); a minor's token → `422 SELF_CONSENT_NOT_AVAILABLE` and they are told to use the existing parent/guardian consent + assent flow instead, which is completely unchanged; no approved `ADULT_SELF_CONSENT` protocol configured → `422 PROTOCOL_UNAPPROVED` (fail closed, same governance pattern as every other consent type) |

## 1d. New endpoint — minor self-service (participant token; CR-006-14)

| Endpoint | Purpose | Notes |
|----------|---------|-------|
| `POST /consents/minor-self-service` | a minor confirms **both** required consents themselves, on their own device, in one call | body `{}`; creates, grants and verifies `STUDENT_ASSENT` (`verification_method: SELF_ATTESTED` — a genuine self-attestation) and `PARENT_GUARDIAN_CONSENT` (`verification_method: STUDENT_ATTESTED_FOR_PARENT` — a distinct, owner-approved code so the audit trail is never misread as an actual parent/guardian action) in one call; a temporary stand-in until a real parent/guardian portal exists — the ordinary admin-mediated flow (a real parent verifying their own consent through `POST /consents` + `POST /consents/:id/verify`) is completely unchanged and still available; to switch from the student-attested record to a real one, the participant withdraws it first (`uq_consent_active_type_protocol` allows only one active record per participant/type/protocol version), then the admin-mediated flow proceeds as normal; calling this endpoint again is idempotent per consent type (an already-`VERIFIED` one is left untouched, a still-pending one is completed); an adult's token → `422 PARENT_CONSENT_NOT_APPLICABLE`; no approved protocol for either type → `422 PROTOCOL_UNAPPROVED` for that step only, the other consent's completion (if it already succeeded) is not rolled back |

## 1e. New endpoints — report wording (active Super Admin only)

| Endpoint | Purpose | Notes |
|----------|---------|-------|
| `GET /admin/wording` | every `interpretation_rules` row for one question set | query `assessmentVersionId` (required); response `{ set: { setId, versionLabel, revision }, rules: [ { ruleId, assessmentVersionId, domainCode, band, evidenceState, locale, layer, ruleCode, text, version, status, createdAt } ] }`; the admin-UI path alongside the existing CLI script (`scripts/wording-load.js`) — both reuse the same `ruleCode`/`ruleId`/`DOMAINS`/`BANDS`/`STATES`/`LAYERS` helpers so a rule added through either path is identical and never collides with the other |
| `POST /admin/wording` | add one wording rule as `DRAFT` | body `{ assessmentVersionId, domain, band?, evidenceState, locale, layer, version, text }`; `201` created / `200` identical no-op (same text under the same version is left untouched, idempotent exactly like the CLI script); a different text under an already-used version → `409 WORDING_VERSION_CONFLICT` (add it under a new version instead); writes through the normal application store (`SUPER_ADMIN` scope, the runtime credential) — `src/` never reads the migrator credential (`MONGODB_URI_ADMIN`, SEC-30), so this is a parallel write path to the script's, not a wrapper around it; audited as `WORDING_LOADED` |
| `POST /admin/wording/{id}/approve` | `DRAFT → APPROVED` | body `{ reason }` (reason required, 3–300 chars); a second approved rule for the same domain/band/evidence-state/locale/layer dimension is refused (`409 WORDING_ALREADY_APPROVED`, the unique index `uq_one_approved_rule_per_dimension`) — retire the current approved rule first, same rule the CLI script enforces; already-`APPROVED` → idempotent no-op; audited as `WORDING_APPROVED` |

The engine itself never writes this text: the report renderer (`reportRenderer.js`) only copies an `APPROVED` row's `approved_text_template` verbatim into a report section (`requireWording`/`pickWording` in `reportRules.js`) — a domain at `S2`+ with no matching `APPROVED` rule fails the whole report closed (`WORDING_MISSING`). This admin surface exists because, before it, the only way to add or approve wording was `scripts/wording-load.js` run by hand against the database — there was no in-app path at all.

## 1f. New endpoint — ported pilot-kit report engine (active Super Admin only)

| Endpoint | Purpose | Notes |
|----------|---------|-------|
| `GET /admin/attempts/{id}/pilot-report` | a draft PDF for one attempt, from `src/services/reporting/pilotReport/` — a line-for-line Node port of the external Santulan pilot kit's own `santulan_gen/generate.py` report generator (content, config/domain rules, the `Model` decision engine, every HTML page, and Playwright-driven pagination + PDF export), verified byte-for-byte against the Python original on identical input | `Content-Disposition` attachment, filename `{reportId}.pdf` (`reportId` = `SAN-` + the attempt id's first 8 hex characters uppercased, matching the kit's own convention); student data is built directly from this platform's own collections (`fromAttempt.js`: participant, attempt, consent, items, responses) — not from the unified-export workbook, no Excel round-trip; domain means are recomputed from responses with the same `C4.2` exclusion (rule A12) as the unified export (§1); no verified consent → `422 CONSENT_NOT_VERIFIED` (the kit's own `REN-19` rule); always draft (`final: false`) — the ported `content.js` keeps `CONTENT_APPROVED: false` exactly as the kit's own source does, so an approved/final PDF is correctly unreachable until that content is genuinely reviewed; **a third, independent report surface**: distinct from this platform's own in-app report (`GET /reports/{id}`, governed by the Report wording rules above) and from the pilot kit's own separate Python tool — this one runs the kit's exact rendering logic, inside this backend, against real data; not audited (a generated-on-demand read, like the exports above, not a write to governed content) |

Dependency note: this endpoint needs Playwright's Chromium (added to `backend/package.json`; `npx playwright install chromium` downloads the browser binary, ~300 MB) — the same browser-rendering requirement the Python kit itself has for pagination measurement and PDF export, now inside this backend instead of a separate Python process.

## 1f-2. New endpoint — institution cohort report (active Super Admin only)

| Endpoint | Purpose | Notes |
|----------|---------|-------|
| `POST /admin/cohort-reports` | a draft institution cohort report (33-page PDF) for one institution, optionally one cohort, from `src/services/reporting/cohortReport/` — a line-for-line Node port of the pilot kit 2's `santulan_gen/cohort_report.py` (final v1.2 page set, release gates, text checks, headless-browser layout check), verified against the Python original on the kit's own `cohort_sim_unified.xlsx`: the HTML and the manifest are identical | body (strict) `{ institutionCode, cohortCode?, enrolled?, output? }`; `output` is `html` (default), `pdf` or `manifest`; **the admin button requests `pdf`** so the file downloads directly as a PDF. **`html`** returns the report as an attachment `SANT-COH-{institution}-{cohort}-{yyyymmdd}.html` — the exact document the PDF is printed from (same HTML, same A4 page size), built with text work only and **no browser**, so it is light on the server and scales with the database read alone; the admin opens it and prints to PDF (A4, background graphics on). `pdf` starts Chromium once to print the same HTML (no separate layout check, one page load) and runs one at a time. `manifest` returns `{ manifest, failures, warnings }` (QA result and **release blockers**). The Chromium layout check (REN-11) is available in code (`layout: true`) but not used by the endpoint, since the layout was verified identical to the kit's; the text checks run in every mode; data is read straight from this platform's collections (`fromDatabase.js`, same per-attempt numbers and C4.2 exclusion as the unified export), no workbook round-trip and no names are read; one report at a time (each run launches Chromium); nothing is stored on the server; not audited (a read, like the other generated exports) |

Rules enforced in code (kit codes in brackets): at least 10 reportable students, else `422 COHORT_TOO_SMALL` (OD-18); a cohort mixing questionnaire forms → `422 MIXED_FORMS`; only `VERIFIED` consent counts and `WITHDRAWN` is dropped (REN-19); fixed C1–C7 order, no comparison, no ranking, forbidden/retired words, subdomain names and counts under 10 scanned in the finished text (REN-03/07/08/21, MIN-N); layout overlap/overflow checked in Chromium (REN-11) — a failed check returns `422 COHORT_REPORT_QA_FAILED` with the failures and no PDF. Always a **draft**: the endpoint never sends `final`, and the engine itself refuses a final copy while `content.CONTENT_APPROVED` is false (`CONTENT_NOT_APPROVED`) or without approver, sharing grant, safeguarding contacts and helpline date — so a released copy needs a release step built on purpose after the content owner signs off. `SAMPLE`/mixed-test-data refusal depends on a `TEST`/`DEMO` participant status, which this platform's `PARTICIPANT_STATUS` (ACTIVE, SUSPENDED, WITHDRAWN — ASSUMED D-11) does not have, so it does not fire on database data. Admin UI: a "Cohort report" button on each cohort row of the Institutions page downloads the PDF (asks for the optional enrolled count).

Numbers: the Python kit rounds an exact binary tie to the even digit (`round(3.25, 1)` = 3.2, `'%.1f' % 0.125` = `0.12`); JavaScript rounds it up. `src/utils/pyNumber.js` reproduces Python's rule, and the cohort report and the earlier student-report port (§1f: `engine.js` `round1`, `pages.js` figures) both use it.

## 1g. Changed endpoint — OPEN registration and login (no change record yet)

OPEN participants (self-registered, not through a school) no longer use OTP, and no longer get a temporary password to
change on first login - they choose their own email and password at registration and are signed in immediately.
Institutional registration/login (`POST /registrations/institutional`, the temporary-credential + forced-change flow,
AT-27) is **completely unchanged** - this section only touches the OPEN route.

| Endpoint | Change |
|----------|--------|
| `POST /registrations/open` | body is now `{ age, language?, email, password }` (was `{ age, language? }`, completed afterwards by `POST /participants/age-declaration` via an OTP-verified purpose token). `email` becomes the participant's `auth_provider_subject_id` directly - it is what they type back at `POST /auth/login`, no Santulan-ID lookup needed for them specifically. `password` is validated (`provider.passwordProblem`) and stored as an **active, non-temporary** credential (`createOwnPassword` in `devProvider.js`, built on the same `upsertPermanent` the dev seeder uses) - `must_change` is never set to true for this route. Response adds **`accessToken`** (a real session, immediately) and drops `temporaryPassword` - registering is signing in. `201` created / `200` identical replay, unchanged. Registering twice with the same email → the generic insert-conflict error, from `dev_identity_credentials`' existing unique `(provider, subject)` index. |
| `POST /auth/login` | unchanged route and schema (`{ subject, password }`); `credentialSubject()`'s existing fallback (anything not shaped like a Santulan ID is used as the literal provider subject) already resolves an OPEN participant's email with no new lookup code - only `openSchema`'s producer (registerOpen above) changed, not login's consumer. Institutional/admin login (Santulan ID → `authProviderSubjectId` lookup) is this same function, untouched. |
| `POST /auth/request-otp`, `POST /auth/verify-otp`, `POST /participants/age-declaration` | **routes commented out** in `santulan.routes.js` (controllers and `api.*` client functions kept, unused) - OPEN registration no longer needs them. No real OTP/SMS provider exists in this codebase either way (`services/identity/index.js`), so this is not a regression from something that worked. |

New endpoint:

| Endpoint | Purpose | Notes |
|----------|---------|-------|
| `POST /auth/forgot-password` | OPEN participants only, self-service password reset by email | body `{ email }`; always `202 {sent: true}` whether or not the email matches an OPEN participant, same "never reveal" pattern as `request-otp` (resolved via `findParticipantByAuthSubject`, since email already is the subject); issues a fresh **temporary** credential (`must_change: true`, same mechanism as the admin's `credential-reset`) and a `set-password`-purpose token embedded in a reset link; no real email provider exists, so the dev provider logs the link instead of sending it (`requestPasswordReset` in `devProvider.js`, shares the OTP code's dev-log callback - relabelled from `[dev identity] OTP` to the now-generic `[dev identity] code/link`); the link completes through the **existing, unchanged** `POST /auth/set-password` endpoint. Institutional participants and admins: silently no-op (`participationRoute !== 'OPEN'`), they still go through the admin-mediated `credential-reset`. |

Frontend consequence (not an API contract, noted for traceability): `RegisterPage.jsx` is now a 3-step wizard (age+email+password → consent → done, already signed in) instead of 5 (contact → OTP → age → consent → done); `LoginPage.jsx`'s single ID field accepts either a Santulan ID or an email, with two sign-in buttons calling the same `/auth/login` - one framed for self-registered (email) use, one explicitly labelled for institutional temporary-password use - since the backend does not distinguish between them either.

## 2. Changed endpoints

| Endpoint | Change |
|----------|--------|
| `GET /attempts/{id}/items` | each item now also carries **`options`**: `[ { "position": 1, "text": "Almost never" }, … ]` in participant display order. Item shape: `{ itemId, order, domainCode, text, options }`. The fixed 5-point scale is no longer implied. |
| `POST /attempts/{id}/responses` | body unchanged: `{ itemId, value, responseTimeMs?, presentedOrder?, idempotencyKey }`. **`value` is the chosen option's position** as a string (`"1"`…`"20"`); a position outside that question's options → `422 OPTION_OUT_OF_RANGE`; nothing stored. |
| `POST /attempts` | the version is chosen by the server as the **single open set of the participant's age group**; none open → `409 ASSESSMENT_NOT_OPEN`. Body still accepts no version. |
| `GET /attempts/{id}/responses` | `value` is the position; unchanged otherwise |
| `GET /attempts/{id}/scores` (feature 005) | **withdrawn** (scoring master: no raw/research score endpoint before the authorised report). The seven-axis chart and each plotted domain's neutral score, completeness and status are read from the **PROFILE** section of `GET /reports/{id}`. |
| `GET /reports/{id}` | section `PROFILE` content is the JSON payload of [scoring-and-report §7](scoring-and-report.md) (exactly seven domains; `display` `PLOTTED` \| `NOT_ENOUGH_DATA` with the message "Not enough data yet"); other sections and T11/T12 as in feature 005 |
| `GET /attempts/{id}` | adds `reportId` (**ASSUMED, D-M18**): the id of the participant's own report once it is visible to them (`REPORT_READY`, `UNDER_REVIEW`, `NOT_ELIGIBLE`), otherwise `null`; an id only, no state or content. Needed because the score endpoint is withdrawn and the results page must find `GET /reports/{id}`. |
| `POST /internal/attempts/{id}/report`, `POST /internal/reports/{id}/retry` | unchanged paths; a report whose S2+ domain has no approved wording ends `FAILED_RETRYABLE` with `last_error_code = WORDING_MISSING` (internal only, never shown to participants) |
| `GET /admin/credentials/export/{importId}` (feature 005) | **ASSUMED change (no change record yet)**: the one-time credential download is now a real `.xlsx` workbook, not a CSV (`Content-Type` the spreadsheetml type, filename `santulan-credentials-{importId}.xlsx`). One sheet, `Credentials`, with the roster's own columns first — Student's Name, Date of Birth, Gender, Age, Current Grade, Section/ Course, Reg. Number — then Santulan ID and Temporary Password (the old file had only the last two). Headings are bold on a shaded row, frozen so they stay visible, and each column is as wide as its longest value; text goes through `escapeCell` so a value starting with `=`/`+`/`-`/`@` is stored as text and can never run as a formula. Everything else is unchanged: single download (`404` once consumed or expired), audited first as `CREDENTIAL_EXPORTED`, plaintext passwords held only in process memory (`credentialExport.js`) for the short window. Because the roster fields are now held in that same in-memory entry alongside the password, they are covered by the same one-download/expiry rule. |
| `GET /admin/catalog`, `POST /admin/catalog/reconcile` (planned in 005, never built) | **withdrawn** — replaced by the question-set endpoints above |
| `POST /cohorts/import`, credential export, admin/participant/institution/monitoring/audit/export endpoints | unchanged (still to be built as planned in 005 US8) |

## 3. Error codes

| Code | HTTP | Meaning |
|------|------|---------|
| `UPLOAD_VALIDATION_FAILED` | 422 | one or more file/row problems; nothing saved |
| `UPLOAD_TOO_LARGE` | 413 | existing code, file > 2 MB |
| `INVALID_FILE_TYPE` | 415 | existing code, not an `.xlsx` |
| `SET_NOT_DRAFT` | 409 | the label's latest revision is frozen/retired |
| `SET_NOT_FROZEN` | 409 | open/close attempted on a set that is not frozen |
| `SET_INCOMPLETE` | 409 | freeze blocked: a domain has no eligible question (lists the domains) |
| `OPEN_SET_EXISTS` | 409 | another set is open for that age group |
| `OPTION_OUT_OF_RANGE` | 422 | answer outside the question's options (**replaces** `SCALE_OUT_OF_RANGE`) |
| `STORE_UNAVAILABLE` | 503 | the data store cannot confirm the operation (fail closed) |
| `SELF_CONSENT_NOT_AVAILABLE` | 422 | **CR-006-13**: self-consent called by a minor's token; use the parent/guardian consent + assent flow instead |
| `PARENT_CONSENT_NOT_APPLICABLE` | 422 | **CR-006-14**: minor-self-service called by an adult's token; use self-consent instead |
| `COHORT_TOO_SMALL` / `MIXED_FORMS` / `MIXED_SAMPLE_REAL` / `NO_PARTICIPANTS` / `COHORT_REPORT_QA_FAILED` | 422 | cohort report refused (§1f-2) |
| `PROTOCOL_UNAPPROVED` | 422 | existing code (consent governance), reused by self-consent and minor-self-service when the relevant consent type has no approved protocol configured |

All other codes of 005 `api.md` §1 are unchanged. The frontend mapping for `SCALE_OUT_OF_RANGE` is updated to `OPTION_OUT_OF_RANGE` in the same change.

## 4. Behaviour that must not change (regression contract)

Age routing (13–17 adolescent, 18–25 emerging adult, age 18 emerging adult); consent/assent gate; four sessions per attempt and the fifth-session response; idempotent save/submit; quality-first scoring, evidence default S1, missingness rules; T11/T12 neutral report copy; P5 unconditional; hidden prescriptive layers behind the data flag; participant sees only own data; audit fail-closed. Every one has an existing test ID that is **re-executed** on the new store (spec SC-004, constitution X).

## 5. Traceability

| Spec | Endpoint / behaviour |
|------|----------------------|
| FR-011…FR-018, FR-021, FR-022 | §1 |
| FR-019 | §2 items/responses |
| FR-024…FR-033 (admin, research) | 005 `api.md` §5–§6 (unchanged paths), plan phase 7 |
| FR-003, FR-006 | §4 |
| FR-042…FR-058 (scoring, evidence, reports, switches) | §1b, §2 and [scoring-and-report.md](scoring-and-report.md) |
