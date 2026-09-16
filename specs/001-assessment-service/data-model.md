# Data Model: Assessment Service

**Branch**: `001-assessment-service` | **Date**: 2026-09-16 | **Plan**: [plan.md](plan.md)

## Overview

Seven entities serve the feature. `AssessmentTemplate` is the versioned question set produced from each accepted CSV upload; `Submission`, `Response`, and `Result` record a student's attempt against a specific template version; `CsvImportRecord` audits every upload. `User` is owned by the existing auth/users module and referenced (not created) here.

---

## Entities

### 1. AssessmentTemplate

A versioned definition of the assessment produced from an accepted CSV upload.

| Field          | Type      | Validation                                  | Notes                                               |
|----------------|-----------|---------------------------------------------|-----------------------------------------------------|
| id             | id (PK)   | auto-increment                              |                                                     |
| version        | int       | positive, unique                            | monotonic per feature; 1 = seeded/initial set       |
| title          | string    | required, ≤ 200 chars                       | derived from CSV metadata or file name              |
| description    | string    | optional, ≤ 1000 chars                      |                                                     |
| is_active      | boolean   | default false                               | at most ONE row has `is_active = true` exchange-wide|
| source_file    | string    | required                                     | original `mcq_template.csv`                         |
| csv_import_id  | FK        | required                                    | → CsvImportRecord                                   |
| created_at     | timestamp | immutable                                   |                                                     |
| activated_at   | timestamp | nullable                                    | set when becoming the active version                |
| deactivated_at | timestamp | nullable                                    | set when a newer upload replaces it                  |

**Invariants**:
- Exactly one `is_active = true` template at any time (enforced by a unique partial index).
- Version rows are immutable once created (only the active flags transition).

### 2. Question

A single multiple-choice prompt within a template.

| Field          | Type      | Validation                                    | Notes                              |
|----------------|-----------|-----------------------------------------------|------------------------------------|
| id             | id (PK)   |                                               |                                    |
| template_id    | FK        | required → AssessmentTemplate                 | cascade delete with template        |
| text           | string    | required, ≤ 500 chars                         |                                    |
| sort_order     | int       | required, ≥ 1, unique within template         | question order from CSV (FR-002)   |
| is_mandatory   | boolean   | default true                                  | from CSV mandatory flag (FR-003)   |

**Invariants**: a template must contain ≥ 1 question.

### 3. Option

One selectable choice for a question.

| Field          | Type      | Validation                                | Notes                              |
|----------------|-----------|-------------------------------------------|------------------------------------|
| id             | id (PK)   |                                           |                                    |
| question_id    | FK        | required → Question                       | cascade delete                     |
| text           | string    | required, ≤ 300 chars                     |                                    |
| sort_order     | int       | required, ≥ 1, unique within question     | option order from CSV              |
| is_correct     | boolean   | default false                              |                                    |

**Invariants**: each question must have 2–6 options and EXACTLY one `is_correct = true` (FR-014).

### 4. CsvImportRecord

Audit of a single admin upload.

| Field          | Type      | Validation                               | Notes                                  |
|----------------|-----------|------------------------------------------|----------------------------------------|
| id             | id (PK)   |                                          |                                        |
| filename       | string    | required                                 | `mcq_template.csv` or variant          |
| uploaded_by    | FK        | required → User (admin)                  | role-guarded at API layer              |
| status         | enum      | `accepted` | `rejected`                     |                                        |
| error_summary  | string    | nullable                                  | line/column detail if rejected (FR-014)|
| accepted_at    | timestamp | nullable                                  | set when accepted                      |
| template_id    | FK        | nullable → AssessmentTemplate            | set when accepted                      |
| created_at     | timestamp | immutable                                 |                                        |

### 5. Submission

One student's attempt against a specific template version.

| Field             | Type      | Validation                                  | Notes                                   |
|-------------------|-----------|---------------------------------------------|-----------------------------------------|
| id                | id (PK)   |                                             |                                         |
| student_id        | FK        | required → User (student)                   |                                         |
| template_id       | FK        | required → AssessmentTemplate               | snapshot: never re-pointed (FR-008)     |
| status            | enum      | `in_progress` | `completed`                       |                                         |
| started_at        | timestamp | required                                    |                                         |
| completed_at      | timestamp | nullable                                    | set on submission (FR-005)              |

**Invariants**:
- At most ONE `in_progress` submission per `(student_id, template_id)` (FR-009) — enforced by a unique partial index.
- `template_id` immutable after creation (snapshot of the active set at start — FR-017).

### 6. Response

A student's selected option for one question within a submission.

| Field         | Type      | Validation                            | Notes                              |
|---------------|-----------|---------------------------------------|------------------------------------|
| id            | id (PK)   |                                       |                                    |
| submission_id | FK        | required → Submission                 | cascade delete                     |
| question_id   | FK        | required → Question                   |                                    |
| option_id     | FK        | required → Option                     | the student's chosen option        |
| answered_at   | timestamp | required                              |                                    |

**Invariants**:
- `(submission_id, question_id)` unique (one response per question).
- Option must belong to the referenced question (validated in service; composite FK optional).

### 7. Result

The computed outcome of a completed submission.

| Field               | Type      | Validation                                | Notes                              |
|---------------------|-----------|-------------------------------------------|------------------------------------|
| id                  | id (PK)   |                                           |                                    |
| submission_id       | FK        | required → Submission, unique             | 1:1 with submission                |
| correct_count       | int       | ≥ 0, ≤ total_questions                    |                                    |
| total_questions     | int       | ≥ 1                                       |                                    |
| score               | numeric   | 0–100 (percentage)                        | computed, stored (FR-008)          |
| computed_at         | timestamp | required                                  |                                    |

**Invariant**: created together with the completed submission in a single transaction (FR-011).

---

## Relationships (summary)

```text
CsvImportRecord 1──1→ AssessmentTemplate 1──*→ Question 1──*→ Option
                                           ↑
              User (student) 1──*→ Submission *──1→ Template
                                    │ 1
                                    ├──*→ Response (→ Question, Option)
                                    └──1→ Result
```

## State Transitions

**Template lifecycle**: `created` (from accepted CSV) → `activated` (only one at a time) → `deactivated` (when replaced). Version rows never update except `is_active`/`activated_at`/`deactivated_at`.

**Submission lifecycle**: `in_progress` at start → `completed` at submit (in the same transaction: persist responses + create result + set status/timestamps). Resume: a student re-visiting with `in_progress` continues the same session (edge case: browser close/broken connection).

## Validation Rules (mapped to FRs)

- FR-003: submit blocked if any `is_mandatory` question lacks a Response; error lists missing question ids.
- FR-013/014: CSV parse → per-row validation (schema in `contracts/csv-schema.md`); errors reference row/column.
- FR-009: partial unique index on `(student_id, template_id)` where `status = 'in_progress'`.
- FR-010: all student queries scoped by `student_id`; admin routes role-guarded.
- FR-017: `template_id` on Submission snapshots the active version at start.