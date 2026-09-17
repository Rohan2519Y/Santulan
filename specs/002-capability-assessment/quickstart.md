# Quickstart & Validation Guide: Capability Assessment

**Branch**: `002-capability-assessment` | **Date**: 2026-09-17 | **Contracts**: [contracts/api.md](contracts/api.md), [contracts/item-pool-schema.md](contracts/item-pool-schema.md) | **Data Model**: [data-model.md](data-model.md)

## Setup

Everything runs from the existing `backend/` scaffold (Express app, Docker, Prisma, Jest+Supertest tests) and `frontend/` React scaffold.

```powershell
# backend (from repo root)
npm install                    # adds express, prisma, @prisma/client, multer, xlsx
npm run docker:up              # PostgreSQL 16 via docker-compose
npm run db:migrate             # prisma migrate deploy --schema prisma/schema.prisma
npm run db:seed                # seed ResponseScale, admin + participant users, InterpretationRule base rules
```

Import the frozen item pools before first use (admin flow, FR-013):

```powershell
curl -X POST http://localhost:8000/api/v1/admin/assessments/import `
  -H "Authorization: Bearer $ADMIN_TOKEN" `
  -F "file=@docs/Santulan_Adolescent_Items_TECH_READY.xlsx"
curl -X POST http://localhost:8000/api/v1/admin/assessments/import `
  -H "Authorization: Bearer $ADMIN_TOKEN" `
  -F "file=@docs/Santulan_EmergingAdult_Items_TECH_READY.xlsx"
```

Run the verification suite:

```powershell
npm test                        # backend unit + integration + contract (Jest + Supertest)
cd frontend; npm test           # frontend jest
```

## Scenario Walkthroughs (map to spec user stories)

### Scenario 1 — Full participant flow (P1, P2)

1. Participant logs in (existing auth), declares a profile
   `POST /api/v1/assessments/profile` (age → band + minor + context).
2. Minor or not: record the correct consent combo
   `POST /api/v1/assessments/consents`; minors need verified parent consent + assent (FR-012).
3. `POST /api/v1/assessments/attempts` → `201` with the active frozen version and up to the eligible items grouped into 7 domain sections (C7 = 59 eligible items; FR-002/003).
4. Save answers per item `POST /.../responses` (value 1–5).
5. `POST /.../pause` → `PAUSED`; later `POST /.../resume` (a new session). Repeat up to session 4; a 5th resume returns `409 SESSION_LIMIT` (FR-005).
6. `POST /.../submit` → synchronous scoring + report; status `REPORT_READY` within 10 s (SC-001). `GET /.../scores` shows 7 domain means with completeness + S0–S5 status. `GET /reports/:id` shows released sections.

### Scenario 2 — Idempotency & locking (FR-004/007)

- Re-sending the same save request with the same `Idempotency-Key` returns the original row, never a duplicate; editing creates a new response version and retires the prior CURRENT (`responseVersion` increments, one `is_current` per item).
- After `SUBMIT`, response writes return `422 INVALID_STATE`.

### Scenario 3 — One active attempt (FR-006)

- A second `POST /attempts` while the first is `IN_PROGRESS` returns the existing attempt (resume), not a new row.

### Scenario 4 — Quality & safeguarding (FR-014)

- Q09-triggered attempt → `QUALITY_HOLD`; admin reviews via `PATCH /quality-flags`, never a score, and the participant report is the neutral message (RC-10).

### Scenario 5 — Report release gate (FR-018)

- After assembly, prescriptive layers (priorities/actions/growth) are stored with `is_released_to_participant = false`. Admin flips the flag; the participant sees them without any deploy.

## Key Quality Gates Checklist

- [ ] `1 – Almost never` … `5 – Almost always` anchors fixed (V02).
- [ ] Migrations produce the partial unique indexes: current-response per (attempt,item); one active attempt per (participant,version).
- [ ] Import of both TECH_READY xlsx files yields 175 + 171 items, all ACTIVE, one FROZEN active version at a time; re-import is a no-op reduce.
- [ ] Submit drives `SCORING → SCORED → REPORT_READY`; failure leaves `SCORED` + `FAILED_RETRYABLE` (FR-011); retry works from frozen inputs.
- [ ] Per-domain mean ∈ [1.00, 5.00], completeness rate per missingness rules, score status assigned.
- [ ] No client-supplied scores are ever used (FR-008); responses are append-only once SUBMITTED (FR-007/015).
- [ ] Participant endpoints never expose another participant's data (FR-016); admin routes are role-guarded.
- [ ] All humans translations target the current locale (MP16); evidence-gate = READY before operational output (FR-010).

## Shared Go-Live Checklist (spec SC-001…SC-007)

- [ ] SC-001 performance: 100% valid submissions return results < 10 s.
- [ ] SC-002 admin import → live item set with no code redeploy.
- [ ] SC-003 output deterministic and repeatable for identical inputs.
- [ ] SC-004 data completeness accurate vs saved responses (100% test coverage of the pipeline mapping).
- [ ] SC-005 no percentile/diagnosis/reliable-change claims rendered.
- [ ] SC-006 participant-facing coverage: consent, age, session-limit, hold states, neutral-message report.
- [ ] SC-007 quality/pipeline fixture passes Q01–Q09 including Q09 → human workflow.