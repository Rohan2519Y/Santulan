# Quickstart: Assessment Service Validation Guide

**Branch**: `001-assessment-service` | **Date**: 2026-09-16 | **Plan**: [plan.md](plan.md)

This guide proves the feature works end-to-end against the [API contract](contracts/api.md) and [CSV schema](contracts/csv-schema.md). Run it after the module is implemented, before deeper task-level testing.

## Prerequisites

- Node.js 20, PostgreSQL 16, Docker (for `docker-compose` DB)
- Backend dependencies installed: `npm install` in `backend/`
- Database migrated & seeded: `npm run db:migrate && npm run seed`
- Seed creates: one admin user, one student user, and the initial active template from a fixture `mcq_template.csv`

## 1. Boot the stack

```bash
docker compose up -d   # PostgreSQL (from backend/)
npm run dev            # backend API on :3000
npm start --prefix ../frontend   # React app on :3000 (dev proxy to API)
```

Expected: API responds at `http://localhost:3000/api/v1` (health), frontend loads.

## 2. Obtain tokens

Log in as each role (existing auth endpoints):

```bash
ADMIN_TOKEN=$(curl -s -X POST localhost:3000/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"..."}' | jq -r .token)
STUDENT_TOKEN=$(curl -s -X POST localhost:3000/api/v1/auth/login \
  -d '{"email":"student@example.com","password":"..."}' -H 'Content-Type: application/json' | jq -r .token)
```

Expected: two distinct JWTs; the admin token carries `role: "admin"`, student token `role: "student"`.

## 3. Scenario A — Student takes the seeded assessment (US-1, P1)

```bash
curl -s -X POST localhost:3000/api/v1/assessments/start -H "Authorization: Bearer $STUDENT_TOKEN" | jq
```

Expected: `201 Created`, `status: "in_progress"`, questions from the seeded template in order.

```bash
curl -s -X POST localhost:3000/api/v1/assessments/submit \
  -H "Authorization: Bearer $STUDENT_TOKEN" -H 'Content-Type: application/json' \
  -d '{"submissionId":"<id>","responses":[{"questionId":41,"optionId":201}]}'
```

- Submit with **all** mandatory questions answered → `201`, `result.score` present (≤ 3 s, SC-002).
- Re-submit omitting a mandatory question → `422` with `details.missingQuestionIds` (FR-003).
- Submit a second time on the completed submission → `422 INVALID_SUBMISSION_STATE`.

## 4. Scenario B — Student views history (US-2, P2)

```bash
curl -s localhost:3000/api/v1/assessments/history -H "Authorization: Bearer $STUDENT_TOKEN" | jq
```

Expected: completed submissions with date + result; empty array for a fresh student (no error).

## 5. Scenario C — Admin uploads a new question set (US-3, P3)

```bash
curl -s -X POST localhost:3000/api/v1/admin/assessments/upload \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -F "file=@backend/seeders/fixtures/mcq_template.csv"
```

Expected: `201`, `template.version` incremented, `isActive: true` (SC-004, < 15 min trivially satisfied; validation < 10 s, SC-006).

Upload a **malformed** CSV (missing `question` column) → `422 CSV_VALIDATION_FAILED` with row/column details.

Attempt the upload with `$STUDENT_TOKEN` → `403 FORBIDDEN` (FR-016).

Then Scenario A again: new student sessions must use the new version, while the student's earlier submission still shows its original questions/result (FR-008).

## 6. Scenario D — Admin views all submissions (US-4, P4)

```bash
curl -s localhost:3000/api/v1/admin/assessments/submissions -H "Authorization: Bearer $ADMIN_TOKEN" | jq
curl -s localhost:3000/api/v1/admin/assessments/submissions/<id> -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

Expected: list of all students' submissions; detail shows per-question chosen-option + correctness. Student token → `403` (FR-010).

## 7. Automated confirmation

```bash
npm test                 # backend: unit + integration + contract
npm test --prefix ../frontend    # React: component tests for pages
```

Expected: all green. Contract tests assert the exact request/response shapes in `contracts/api.md`.

## Reference

- Endpoints & payloads: [contracts/api.md](contracts/api.md)
- CSV structure & validation: [contracts/csv-schema.md](contracts/csv-schema.md)
- Entities, invariants, transitions: [data-model.md](data-model.md)