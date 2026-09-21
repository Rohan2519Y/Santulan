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
