# API Contract: Assessment Service (v1)

**Branch**: `001-assessment-service` | **Date**: 2026-09-16 | **Data Model**: [../data-model.md](../data-model.md)

## Conventions

- Base URL: `/api/v1`
- Auth: `Authorization: Bearer <JWT>` on all endpoints; role claim = `admin` | `student`
- Response envelope:
  - Success: `200/201` with JSON body documented per endpoint
  - Error: `{ "error": { "code": "...", "message": "...", "details": {...} } }`
- Auth failures: `401` (missing/invalid token), `403` (wrong role)

## Endpoints

### Student (role: `student`, authenticated)

#### 1. Start or resume assessment

`POST /api/v1/assessments/start`

- No request body.
- Behavior: if the student has an `in_progress` submission on the active template, return it (resume); else create one against the active template (snapshot) and return it.
- `409` if a new session is impossible (no active template).
- `200 OK` (resumed) / `201 Created` (new):

```json
{
  "submission": {
    "id": "sub_123",
    "status": "in_progress",
    "template": {
      "id": 4,
      "version": 4,
      "title": "General Science",
      "questions": [
        {
          "id": 41,
          "sortOrder": 1,
          "text": "What is H2O?",
          "isMandatory": true,
          "options": [
            { "id": 201, "sortOrder": 1, "text": "Water" },
            { "id": 202, "sortOrder": 2, "text": "Salt" }
          ]
        }
      ]
    }
  }
}
```

#### 2. Submit assessment

`POST /api/v1/assessments/submit`

- Body: `{ "submissionId": "sub_123", "responses": [ { "questionId": 41, "optionId": 201 } ] }`
- Behavior: validates submission belongs to the student and is `in_progress`; checks all mandatory questions answered (FR-003); scores (FR-004); persists responses + result + completion atomically.
- `422` with `details.missingQuestionIds` if mandatory questions missing.
- `201 Created`:

```json
{
  "submission": {
    "id": "sub_123",
    "status": "completed",
    "completedAt": "2026-09-16T10:00:00Z"
  },
  "result": {
    "correctCount": 3,
    "totalQuestions": 5,
    "score": 60
  }
}
```

#### 3. View own history

`GET /api/v1/assessments/history`

- `200 OK` (includes only the calling student's submissions, latest first):

```json
{
  "submissions": [
    {
      "id": "sub_123",
      "completedAt": "2026-09-16T10:00:00Z",
      "templateVersion": 4,
      "result": { "correctCount": 3, "totalQuestions": 5, "score": 60 }
    }
  ]
}
```

- Empty array when never completed (US-2 acceptance 2).

### Admin (role: `admin`, authenticated)

#### 4. Upload question set

`POST /api/v1/admin/assessments/upload`

- Content-Type: `multipart/form-data`; field `file`, required, name `mcq_template.csv`, max 1 MB.
- Behavior: validate + parse CSV (contract `csv-schema.md`); on success create template version + CsvImportRecord(`accepted`), flip active version; on failure CsvImportRecord(`rejected`) with line-level errors.
- `201 Created` on success:

```json
{
  "import": { "id": 12, "status": "accepted" },
  "template": { "version": 5, "id": 5, "isActive": true }
}
```

- `422 Unprocessable Entity` on structural errors:

```json
{
  "error": {
    "code": "CSV_VALIDATION_FAILED",
    "message": "CSV failed validation",
    "details": [
      { "row": 3, "column": "answer_4", "message": "Question must have exactly one correct option" },
      { "row": 8, "message": "Missing required column 'question'" }
    ]
  }
}
```

#### 5. View all submissions

`GET /api/v1/admin/assessments/submissions`

- `200 OK`:

```json
{
  "submissions": [
    {
      "id": "sub_123",
      "student": { "id": 9, "name": "Jane Doe" },
      "completedAt": "2026-09-16T10:00:00Z",
      "templateVersion": 4,
      "result": { "correctCount": 3, "totalQuestions": 5, "score": 60 }
    }
  ]
}
```

#### 6. View submission detail

`GET /api/v1/admin/assessments/submissions/:submissionId`

- `200 OK` — full detail including per-question: question text, chosen option, whether correct:

```json
{
  "submission": {
    "id": "sub_123",
    "student": { "id": 9, "name": "Jane Doe" },
    "templateVersion": 4,
    "startedAt": "2026-09-16T09:58:00Z",
    "completedAt": "2026-09-16T10:00:00Z",
    "result": { "correctCount": 3, "totalQuestions": 5, "score": 60 },
    "responses": [
      { "questionId": 41, "question": "What is H2O?", "chosenOption": "Water", "isCorrect": true }
    ]
  }
}
```

- `404` if not found.

## Error Codes

| Code                      | HTTP | Meaning                                        |
|---------------------------|------|------------------------------------------------|
| UNAUTHENTICATED           | 401  | Missing/invalid token                          |
| FORBIDDEN                 | 403  | Authenticated but wrong role                   |
| ASSESSMENT_UNAVAILABLE    | 409  | No active question set to start against        |
| SUBMISSION_NOT_FOUND      | 404  | Submission id unknown                          |
| ACCESS_DENIED             | 403  | Submission belongs to another student          |
| INVALID_SUBMISSION_STATE  | 422  | Submit on an already-completed submission       |
| MANDATORY_MISSING         | 422  | Mandatory questions unanswered                 |
| CSV_VALIDATION_FAILED     | 422  | CSV structural errors (details carry row/col)   |
| UPLOAD_TOO_LARGE          | 413  | File exceeds 1 MB                              |
| INVALID_FILE_TYPE         | 415  | File is not a `.csv`                           |