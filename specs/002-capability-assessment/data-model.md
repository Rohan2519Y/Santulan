# Data Model: Capability Assessment

**Branch**: `002-capability-assessment` | **Date**: 2026-09-17 | **Plan**: [plan.md](plan.md)

## Overview

The assessment module owns its instrument, attempt, response, and scoring data. Identity is owned by the existing users module and referenced (not created) here: a participant is a `User` with role `participant` (or `admin`), extended by a feature-owned `ParticipantProfile`. Instrument content is frozen per `AssessmentVersion` built from the imported TECH_READY item pools. Immutability is structural: responses and scores are append-only, pages of the ERD `03_Non_Negotiable_Rules` and `07_Assessment_Response` are honoured (BF-01 response versioning, REPORT_READY gate).

## Entities

### 1. ResponseScale

Frozen 5-point Likert definition from the OFFLINE booklets.

| Field         | Type      | Validation                      | Notes                                  |
|---------------|-----------|---------------------------------|----------------------------------------|
| id            | id (PK)   |                                 |                                        |
| version       | string    | required, unique                | e.g. `santulan-pilot-v1.0`             |
| scale_points  | int       | required, = 5                   | Frozen at 5 (V02 in ERD)               |
| anchor_labels | json      | required                        | `{1:'Almost never',…,5:'Almost always'}` |
| keying_definition | json | required                     | `{ 'positive': 'higher is higher' }` prototypes |
| frozen_at     | timestamp | immutable                      |                                        |
| status        | enum      | `DRAFT` \| `FROZEN` \| `RETIRED` | Only FROZEN used by versions           |

### 2. AssessmentVersion

One frozen instrument (one TECH_READY pool).

| Field              | Type      | Validation                     | Notes                                        |
|--------------------|-----------|--------------------------------|----------------------------------------------|
| id                 | id (PK)   |                                |                                              |
| version_label      | string    | required, unique               | `santulan-adolescent-pilot-v1.0` / `…emergingadult-pilot-v1.0` |
| response_scale_id  | FK        | required → ResponseScale       |                                              |
| tool_band          | enum      | `ADOLESCENT` \| `EMERGING_ADULT` | drives age-band routing defaults            |
| source_file        | string    | required                       | original xlsx filename                      |
| content_hash       | string    | required                       | integrity check (ERD 08 items)              |
| frozen_at          | timestamp | immutable                      |                                              |
| status             | enum      | `DRAFT` \| `FROZEN` \| `RETIRED` | exactly one FROZEN active at a time (import flips prior to RETIRED) |
| is_active          | boolean   | default false                  | at most one true (partial unique index)     |

### 3. Item

One self-report statement inside a version.

| Field              | Type      | Validation                          | Notes                                   |
|--------------------|-----------|-------------------------------------|-----------------------------------------|
| id                 | id (PK)   |                                     |                                         |
| assessment_version_id | FK     | required → AssessmentVersion        | immutable                             |
| item_code          | string    | required, unique per version        | dash notation e.g. `C4-02` (ERD)      |
| domain_code        | string    | required, ∈ C1–C7                   |                                         |
| subdomain_code     | string    | required                            | period notation e.g. `C4.2` (ERD)     |
| domain_name        | string    | required                            | e.g. `Body & Self-Regulation`            |
| subdomain_name     | string    | required                            |                                         |
| item_text          | string    | required, ≤ 500 chars               |                                         |
| keying             | enum      | `POSITIVE` \| `REVERSE`             | prototype pools are all POSITIVE         |
| age_band           | string    | required                            | `13–25` (General) or `13–18`/`18–25`     |
| context            | string    | required                            | `General` \| `School` \| `College/Work`  |
| layer              | enum      | `CORE` \| `V` \| `SJT` \| `O`       | pilot pools are all CORE                 |
| status             | enum      | `ACTIVE` \| `RETIRED`               |                                         |
| display_order      | int       | required, immutable                 | provided sequence (grouped by domain)    |

**Invariants**: `(item_code, assessment_version_id)` unique (import idempotency, research §3); ≥ 1 item per version.

### 4. ParticipantProfile

Feature-owned extension of a `User` (participant role).

| Field          | Type      | Validation                     | Notes                                   |
|----------------|-----------|--------------------------------|-----------------------------------------|
| id             | id (PK)   |                                |                                         |
| user_id        | FK        | required, unique → User        | external users-module owner            |
| santulan_id    | string    | required, unique               | human-facing/research-safe ID (ERD)    |
| participation_route | enum  | `OPEN` \| `INSTITUTIONAL`      |                                        |
| age_band       | enum      | `D1` \| `D2` \| `D3` \| `D4`   | minimum required for eligibility       |
| is_minor       | boolean   | required                       | drives consent gate (FR-012)           |
| context        | enum      | `SCHOOL` \| `COLLEGE_WORK` \| `GENERAL` | derived; item-routing context    |
| administration_language | string | default `en`               | Per MP16 locale readiness               |

### 5. Consent

Typed, verifiable consent/assent in an approved state.

| Field              | Type      | Validation                     | Notes                                   |
|--------------------|-----------|--------------------------------|-----------------------------------------|
| id                 | id (PK)   |                                |                                         |
| participant_profile_id | FK  | required → ParticipantProfile  |                                         |
| consent_type       | enum      | `ADULT_SELF_CONSENT` \| `PARENT_GUARDIAN_CONSENT` \| `STUDENT_ASSENT` | |
| protocol_version   | string    | required                       |                                         |
| verification_method| string    | nullable                       | e.g. `otp-to-parent-contact`           |
| verified_at        | timestamp | nullable                       | required for PARENT_GUARDIAN_CONSENT    |
| status             | enum      | `PENDING` \| `GRANTED` \| `VERIFIED` \| `WITHDRAWN` | |

**Invariant (FR-012)**: a minor (is_minor = true) cannot reach an active attempt while any of: `adult_self_consent` granted-but-unverified, `parent_guardian_consent` missing or unverified, `student_assent` missing.

### 6. AssessmentAttempt

One participant's resumable engagement with one frozen version.

| Field                | Type      | Validation                             | Notes                                  |
|----------------------|-----------|----------------------------------------|----------------------------------------|
| id                   | id (PK)   |                                        |                                        |
| participant_profile_id | FK      | required → ParticipantProfile          |                                        |
| assessment_version_id | FK       | required → AssessmentVersion            | snapshot, never re-pointed (FR-008)   |
| scoring_version      | string    | required                               | frozen scoring ruleset reference      |
| status               | enum      | `CREATED` \| `STARTED` \| `IN_PROGRESS` \| `PAUSED` \| `SUBMITTED` \| `SCORING` \| `SCORED` \| `REPORT_READY` \| `QUALITY_HOLD` \| `INVALID` \| `EXPIRED` |
| session_count        | int       | 0–4                                    | 5th session rejected (FR-005)         |
| started_at / submitted_at / completed_at | timestamp | nullable, per state |                                  |
| idempotency_key      | string    | required, unique                       | duplicate-submit protection           |

**State machine** (ERD `07_Assessment_Response`):

```text
CREATED → STARTED → IN_PROGRESS ⇄ PAUSED → SUBMITTED → SCORING → SCORED → REPORT_READY
              │                                                            │
              └─ exception states: QUALITY_HOLD | INVALID | EXPIRED ───────┘
```

**Invariants**:
- At most one attempt per participant in an active state (`CREATED/STARTED/IN_PROGRESS/PAUSED/SCORING`) for a given version — partial unique index `(participant_profile_id, assessment_version_id) WHERE status IN ('CREATED','STARTED','IN_PROGRESS','PAUSED')` (FR-006).
- `session_count ≤ 4` enforced at session start (FR-005).

### 7. Response

Immutable, versioned answer to one item (BF-01).

| Field                 | Type      | Validation                       | Notes                                  |
|-----------------------|-----------|----------------------------------|----------------------------------------|
| id                    | id (PK)   |                                  |                                        |
| attempt_id            | FK        | required → AssessmentAttempt     |                                        |
| item_id               | FK        | required → Item                  | must belong to the attempt's version   |
| participant_profile_id| FK        | required → ParticipantProfile    | denormalized for RLS/scope             |
| response_value        | int       | 1–5                              | on the frozen scale                   |
| response_version      | int       | ≥ 1, monotonic within (attempt_id, item_id) | every edit = new row        |
| is_current            | boolean   | default false                    | exactly one true per attempt/item      |
| supersedes_response_id| FK        | nullable, self → Response        | chain for audit (BF-01)               |
| response_time_ms      | int       | nullable                         |                                       |
| answered_at           | timestamp | required                         |                                       |
| idempotency_key       | string    | required, unique                 | retry-safe writes (research §4)        |

**Invariants**:
- Partial unique index `(attempt_id, item_id) WHERE is_current = true` → exactly one CURRENT per attempt/item (BF-01). Declared via the `partialIndexes` preview (research §1).
- After `SUBMITTED`, participant endpoints cannot modify responses (FR-007).
- `response_value` validated against the attempt's frozen scale (1–5).

### 8. ResponseEvent

Session/event boundary record (ERD `07_Assessment_Response` — no dedicated sessions table).

| Field        | Type      | Validation | Notes                                  |
|--------------|-----------|------------|----------------------------------------|
| id           | id (PK)   |            |                                        |
| attempt_id   | FK        | required → AssessmentAttempt |                              |
| item_id      | FK        | nullable → Item              |                                        |
| event_type   | enum      | `SESSION_START` \| `SESSION_END` \| `PAUSE` \| `RESUME` \| `RESPONSE_SAVED` \| `SUBMIT` \| … |
| session_number | int     | 1–4        |                                        |
| occurred_at  | timestamp | required   |                                        |
| metadata     | json      | nullable   | approved admin metadata only          |

### 9. QualityFlag

Q01–Q09 records, separate from raw responses.

| Field        | Type      | Validation | Notes                                  |
|--------------|-----------|------------|----------------------------------------|
| id           | id (PK)   |            |                                        |
| attempt_id   | FK        | required → AssessmentAttempt |                              |
| domain_code  | string    | nullable, ∈ C1–C7 |                            |
| flag_code    | enum      | `Q01`…`Q09` | Q09 = safeguarding trigger           |
| severity     | string    | required   |                                        |
| detected_at  | timestamp | required   |                                        |
| disposition  | string    | nullable   | review outcome                        |
| reviewed_by / reviewed_at | FK/timestamp | nullable → admin user |          |

**Invariant (FR-014)**: `Q09` routes to the human safeguarding workflow and never becomes a score or ordinary report state.

### 10. ScoreResult

Per-domain outcome of a scored attempt.

| Field                 | Type        | Validation              | Notes                                   |
|-----------------------|-------------|-------------------------|-----------------------------------------|
| id                    | id (PK)     |                         |                                         |
| attempt_id            | FK          | required → AssessmentAttempt | unique per (attempt, domain)      |
| participant_profile_id| FK          | required                | for RLS/scope                          |
| domain_code           | string      | ∈ C1–C7                 |                                         |
| raw_score             | numeric(3,2)| 1.00–5.00               | mean of valid item responses           |
| valid_response_count  | int         | ≥ 0                     |                                         |
| eligible_item_count   | int         | ≥ 1                     | completeness denominator               |
| completeness_rate     | numeric     | 0–1                     | per missingness rules (A07)            |
| score_status          | enum        | `S0`…`S5`, `SH`, plus quality/insufficiency states | derived (evidence-gated) |
| scoring_version       | string      | required, frozen        | any formula change = new version (V03) |
| calculated_at         | timestamp   | required, immutable     |                                         |

### 11. InterpretationRule

Versioned, evidence-gated translation template (ERD `interpretation_rules`).

| Field              | Type      | Validation | Notes                                 |
|--------------------|-----------|------------|---------------------------------------|
| id                 | id (PK)   |            |                                       |
| assessment_version_id | FK    | required   |                                       |
| domain_code        | string    | ∈ C1–C7    |                                       |
| developmental_band | string    | D1–D4      |                                       |
| evidence_state     | string    | S0–S5, SH  | only permitted states drive output    |
| locale             | string    | default `en` | MP16 readiness                     |
| rule_code          | string    | required   |                                       |
| approved_text_template | string| required   | plain-language copy                  |
| version / status   | string/enum | required | immutable once live                 |

### 12. Report

Attempt-level generated report (BF-05).

| Field              | Type      | Validation | Notes                                 |
|--------------------|-----------|------------|---------------------------------------|
| id                 | id (PK)   |            |                                       |
| attempt_id         | FK        | required, unique → AssessmentAttempt |                      |
| participant_profile_id | FK    | required   |                                       |
| report_version     | string    | required   |                                       |
| generation_status  | enum      | `PENDING` \| `REPORT_READY` \| `FAILED_RETRYABLE` | |
| generated_at       | timestamp | nullable   |                                       |
| retry_count        | int       | default 0  | controlled retry (BF-05)              |

**Invariant (FR-011)**: participant cannot see report content before `REPORT_READY`; `FAILED_RETRYABLE` leaves attempt `SCORED` and allows retry from frozen inputs.

### 13. ReportSection

Snapshot of one report layer (MP17 staged release).

| Field                       | Type      | Validation | Notes                            |
|-----------------------------|-----------|------------|----------------------------------|
| id                          | id (PK)   |            |                                  |
| report_id                   | FK        | required → Report | cascade                |
| section_type                | enum      | `T01_DOMAIN_RESULT` … `T12_NOT_ELIGIBLE` | matches T-series |
| domain_code                 | string    | nullable   |                                  |
| content_version             | string    | required   | frozen interpretation version    |
| display_order               | int       | required   |                                  |
| content_snapshot            | json      | required   | exact displayed text             |
| is_released_to_participant  | boolean   | default false | MP17 flag (FR-018)         |

### 14. ContentImportRecord

Audit of each admin import / version activation.

| Field        | Type      | Validation                    | Notes                             |
|--------------|-----------|-------------------------------|-----------------------------------|
| id           | id (PK)   |                               |                                   |
| filename     | string    | required                      | original xlsx filename           |
| version_label| string    | required                      |                                   |
| imported_by  | FK        | required → User (admin)       | role-guarded                      |
| status       | enum      | `accepted` \| `rejected`      |                                   |
| error_summary| string    | nullable                      | row-level detail on rejection     |
| created_at   | timestamp | immutable                     |                                   |

## Relationships (summary)

```text
ResponseScale 1──*→ AssessmentVersion 1──*→ Item
ParticipantProfile 1──*→ Consent
ParticipantProfile 1──*→ AssessmentAttempt *──1→ AssessmentVersion
AssessmentAttempt 1──*→ Response (*→ Item; self-referencing supersedes)
AssessmentAttempt 1──*→ ResponseEvent
AssessmentAttempt 1──*→ QualityFlag
AssessmentAttempt 1──*→ ScoreResult
AssessmentVersion 1──*→ InterpretationRule
AssessmentAttempt 1──1→ Report 1──*→ ReportSection
```

## Validation Rules (mapped to FRs)

- FR-002/003: eligibility — General items always eligible; variant items eligible when participant `age_band`/`context` matches; `display_order` sequence preserved.
- FR-004: unique partial index `(attempt_id, item_id) WHERE is_current` enforces exactly one current response; versioning via `response_version` + `supersedes_response_id`.
- FR-005: `session_count` increment guarded to ≤ 4 (checked in the session-start service).
- FR-006: unique partial index on active attempt states per (participant, version).
- FR-007: submit transitions status → `SUBMITTED` and rejects response writes by state.
- FR-008: scoring service runs server-side; any client score in a request is ignored.
- FR-009/010: scoring + interpretation gated on evidence state; held constructs (`SH`, e.g. C4 Self-Worth) produce no operational output.
- FR-012: consent check service requires the consent invariants above before `CREATE`/`START`.
- FR-013: import parses xlsx (contract `item-pool-schema.md`), inserts items transactionally, flips active flag, records ContentImportRecord.
- FR-014: quality flags recorded separately; Q09 → human flow, attempt → `QUALITY_HOLD`.
- FR-015: no UPDATE/DELETE paths for Response/ScoreResult outside the versioning insert; archival via status.
- FR-016: all participant-scoped queries filter by `participant_profile_id`; admin routes role-guarded; RLS `set_config` hardening on writes (research §2).
- FR-017: ReportSection stores `content_version` + `content_snapshot` (immutable copy of displayed text).
- FR-018: `is_released_to_participant` gates participant rendering; toggling requires no deploy.
- FR-019: admin transcription flow writes the exact marked `response_value`; blanks → no response row.