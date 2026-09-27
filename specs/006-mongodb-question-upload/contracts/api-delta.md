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
