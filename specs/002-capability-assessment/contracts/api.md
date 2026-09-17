# API Contract: Capability Assessment (v1)

**Branch**: `002-capability-assessment` | **Date**: 2026-09-17 | **Data Model**: [../data-model.md](../data-model.md)

## Conventions

- Base URL: `/api/v1`
- Auth: `Authorization: Bearer <JWT>` on all endpoints; role claim = `participant` | `admin` (from the existing auth module).
- Response envelope:
  - Success: `200/201` with JSON body documented per endpoint
  - Error: `{ "error": { "code": "...", "message": "...", "details": {...} } }`
- Auth failures: `401` (missing/invalid token), `403` (wrong role or foreign participant data — FR-016).
- Idempotency: mutating endpoints accept an optional `Idempotency-Key` header; responses keyed on it are deduplicated (FR-004/FR-007, research §4).

## Endpoints

### Participant (role: `participant`, authenticated)

#### 1. Get/declare participant profile (age gate before attempts)

`GET /api/v1/assessments/profile`

- Returns the calling participant's profile. `404` if none — the participant must complete profile declaration first.

`POST /api/v1/assessments/profile`

- Body: `{ "age": 15, "participationRoute": "INSTITUTIONAL", "institutionId": "…" | null }` (age drives age band + minor status; route/context validated).
- Behavior: creates/updates the profile and derives `ageBand` (`D1`–`D4`), `isMinor`, and `context` (`SCHOOL` | `COLLEGE_WORK` | `GENERAL`). REQUIRED before `consent` and `attempts` (FR-012).
- `201`/`200`:

```json
{ "profile": { "id": "pf_1", "ageBand": "D1", "isMinor": true, "context": "SCHOOL", "route": "INSTITUTIONAL" } }
```

#### 2. Record consent / assent (minor gate)

`POST /api/v1/assessments/consents`

- Body: `{ "consentType": "ADULT_SELF_CONSENT" | "PARENT_GUARDIAN_CONSENT" | "STUDENT_ASSENT", "protocolVersion": "…" }`
- Behavior: records the typed consent; `PARENT_GUARDIAN_CONSENT` additionally requires `verificationMethod` and cannot reach `VERIFIED` without it. The attempt gate (FR-012) requires the correct combination per `isMinor` (e.g. minor: verified `PARENT_GUARDIAN_CONSENT` + `STUDENT_ASSENT`).
- `422` with `details.requiredConsents` if the combination is still incomplete.

#### 3. Start or resume an attempt

`POST /api/v1/assessments/attempts`

- No request body. Behavior:
  - If the participant has an active attempt on the active version → return it (resume); if `session_count < 4` a resume also opens the next `RESUME` event.
  - Else create a `CREATED` attempt against the active FROZEN version with the eligible item set (FR-002/003) and record `SESSION_START`.
- `409 ATTEMPT_UNAVAILABLE` if no active frozen version.
- `409 SESSION_LIMIT` if resuming requires a 5th session (FR-005).
- `403 CONSENT_INCOMPLETE` if the consent gate is not met (FR-012).
- `201`/`200`:

```json
{
  "attempt": {
    "id": "att_1",
    "status": "IN_PROGRESS",
    "sessionCount": 1,
    "version": { "id": "asv_1", "versionLabel": "santulan-adolescent-pilot-v1.0" },
    "scale": { "points": 5, "anchors": { "1": "Almost never", "5": "Almost always" } },
    "sections": [
      {
        "domainCode": "C1",
        "domainName": "Body & Self-Regulation",
        "items": [
          { "id": "it_1", "code": "C1-01", "order": 1, "text": "I notice when my body feels tense or keyed up." }
        ]
      }
    ],
    "savedAnswers": [ { "itemId": "it_1", "value": 4, "isCurrent": true } ]
  }
}
```

#### 4. Save a response

`POST /api/v1/assessments/attempts/:attemptId/responses`

- Body: `{ "itemId": "it_1", "value": 4, "idempotencyKey": "uuid" }`
- Behavior: validates attempt ownership + state (IN_PROGRESS/PAUSED), item belongs to the attempt's version, value ∈ frozen scale (1–5). Creates a NEW immutable response version and retires the previous CURRENT (BF-01). `ON CONFLICT (idempotency_key) DO NOTHING` makes retries safe (research §4).
- `422 INVALID_STATE` if the attempt is not in an answerable state (FR-007). `201`:

```json
{ "response": { "itemId": "it_1", "value": 4, "responseVersion": 2, "isCurrent": true } }
```

#### 5. Pause / resume events

`POST /api/v1/assessments/attempts/:attemptId/pause` → records `PAUSE`, state `PAUSED`, `200`.
`POST /api/v1/assessments/attempts/:attemptId/resume` → records `RESUME` (session boundary), state `IN_PROGRESS`; `409 SESSION_LIMIT` on a 5th session.

#### 6. Submit an attempt

`POST /api/v1/assessments/attempts/:attemptId/submit`

- No body (or `{ "idempotencyKey": "uuid" }`). Behavior: atomically transitions `IN_PROGRESS/PAUSED → SUBMITTED → (SCORING) → SCORED`, locks responses (FR-007), runs server-side scoring + report assembly (FR-008), sets `REPORT_READY` on success, and `FAILED_RETRYABLE` (attempt stays `SCORED`) on report failure (FR-011).
- `422 INVALID_STATE` on non-submittable state. `200` (synchronous pipeline; SC-001):

```json
{
  "attempt": { "id": "att_1", "status": "REPORT_READY" },
  "report": { "id": "rep_1", "generationStatus": "REPORT_READY", "released": true }
}
```

#### 7. View own scores

`GET /api/v1/assessments/attempts/:attemptId/scores`

- Behavior: returns only the calling participant's attempt (FR-016); hides scores if evidence state disallows operational output (FR-010); includes held-construct status in meta, never as a score.
- `200`:

```json
{
  "attemptId": "att_1",
  "scores": [
    { "domainCode": "C1", "domainName": "Body & Self-Regulation", "rawScore": 3.8, "completenessRate": 0.95, "scoreStatus": "S2" }
  ]
}
```

#### 8. View own report

`GET /api/v1/assessments/reports/:reportId`

- Behavior: `404`/`pending` until `REPORT_READY` (FR-011, RC-10). Returns only sections where `is_released_to_participant = true` (FR-018); under-review/ineligible attempts return the single neutral T11/T12 message (never the trigger).
- `200`:

```json
{ "reportId": "rep_1", "releasedSections": [ { "sectionType": "T01_DOMAIN_RESULT", "domainCode": "C1", "content": { "title": "Your C1 result", "body": "…" } } ] }
```

#### 9. Report retry (controlled, BF-05)

`POST /api/v1/assessments/reports/:reportId/retry`

- Behavior: permitted when `generationStatus = FAILED_RETRYABLE` (attempt stays `SCORED`); regenerates identical content from the frozen attempt + versions; logs actor and reason. `409` if already `REPORT_READY`.

### Admin (role: `admin`, authenticated)

#### 10. Import item pool (xlsx)

`POST /api/v1/admin/assessments/import`

- Content-Type: `multipart/form-data`; field `file` (xlsx).
- Behavior: parse + validate (contract `item-pool-schema.md`), compute content hash, create `FROZEN` AssessmentVersion + items transactionally; the newly imported version becomes active and the previous active version is `RETIRED`/`is_active` flipped (FR-013). Records `ContentImportRecord`.
- `201`:

```json
{ "import": { "id": 1, "status": "accepted" }, "version": { "id": "asv_2", "versionLabel": "…-pilot-v1.0", "itemCount": 175, "active": true } }
```

- `422 ITEM_POOL_VALIDATION_FAILED` with row-level errors (unknown domain/subdomain/age band/context, duplicate code, invalid keying, empty text).
- `413 UPLOAD_TOO_LARGE`, `415 INVALID_FILE_TYPE`.

#### 11. Participation control

`POST /api/v1/admin/assessments/control`

- Body: `{ "action": "PAUSE" | "STOP" | "REOPEN", "reason": "…" }`
- Behavior: sets participation availability; attempt-creation enforces current control (FR-013). Every action is audit-logged (actor + timestamp + reason).

#### 12. View submissions, scores, and quality flags

`GET /api/v1/admin/assessments/submissions`

- `200`: list of attempts (participant santulan ID, version, status, submitted/complete timestamps, session count, scores summary, quality flags).

`GET /api/v1/admin/assessments/submissions/:attemptId`

- `200`: full detail — items, per-response current value + version chain meta, per-domain scores with completeness/status, report generation state, quality flags with disposition.

#### 13. Quality flag review disposition

`PATCH /api/v1/admin/assessments/quality-flags/:flagId`

- Body: `{ "disposition": "…" }`. Behavior: admin-only; reviewed_by/reviewed_at recorded. Q09 remains human-workflow owned and never produces a score (FR-014).

## Error Codes

| Code                              | HTTP | Meaning                                                    |
|-----------------------------------|------|------------------------------------------------------------|
| UNAUTHENTICATED                   | 401  | Missing/invalid token                                      |
| FORBIDDEN                         | 403  | Authenticated but wrong role / foreign participant data    |
| PROFILE_NOT_DECLARED              | 403  | Profile required before consents/attempts                  |
| CONSENT_INCOMPLETE                | 403  | Consent/assent gate not met (FR-012)                       |
| ATTEMPT_UNAVAILABLE               | 409  | No active frozen version                                   |
| SESSION_LIMIT                     | 409  | 5th session attempted (FR-005)                             |
| ATTEMPT_LOCKED                    | 422  | One active attempt per participant per version (FR-006)    |
| INVALID_STATE                     | 422  | Endpoint not valid for the attempt state (FR-007)          |
| ITEM_NOT_ELIGIBLE                 | 422  | Item does not belong to the attempt's version (FR-002/003) |
| SCALE_OUT_OF_RANGE                | 422  | Value outside frozen 1–5 scale                             |
| VERSION_MISMATCH                  | 409  | Request references an outdated/retired version             |
| ITEM_POOL_VALIDATION_FAILED       | 422  | xlsx structural errors (details carry row/column)          |
| UPLOAD_TOO_LARGE                  | 413  | File exceeds size limit                                    |
| INVALID_FILE_TYPE                 | 415  | File is not an .xlsx                                       |
| REPORT_NOT_READY                  | 404  | Report not generated yet (FR-011)                          |
| REPORT_RETRY_NOT_ALLOWED          | 409  | Report already ready / retry not in FAILED_RETRYABLE        |