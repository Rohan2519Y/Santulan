# API Contract: v3.1 Canonical Alignment (005)

**Branch**: `005-v3-1-canonical-alignment` | **Date**: 2026-09-19 | **Data model**: [../data-model.md](../data-model.md) | **Database contract**: [database-contract.md](database-contract.md)

Semantics come from BUILD 00 §11 and the BUILD 03–08 API tables; URI naming may be refined (BUILD 00 allows it) but **semantics, authorisation, state checks, idempotency, provenance and audit effects are mandatory**. Base path `/api/v1`. All bodies are JSON and validated with **strict** schemas: an unknown key is a `VALIDATION_ERROR`, never ignored (this is how client-supplied scores, `santulan_id`, `participant_id` or DB-context values are refused).

## 1. Conventions

| Topic | Rule |
|-------|------|
| Auth | `Authorization: Bearer <JWT>`; claims carry `sub`, `role` (`participant` \| `admin`), and after the bridge (R-07) `participantId` / `adminUserId`. Participant identity is **always** taken from the token, never from a body/path `participant_id` |
| DB context | Set by server middleware only, per transaction (`app.actor_scope`, `app.participant_id`, `app.admin_user_id`, `app.institution_id`); never from headers, query or body |
| Envelope | Success: resource JSON. Error: `{ "error": { "code", "message", "details" } }` (existing shape) |
| Idempotency | `Idempotency-Key` (16–128 chars) required on registration, research-export request, and any create that documents it; same key + equivalent body → original result (200); different body → `409 IDEMPOTENCY_CONFLICT`. Response save and submit carry their keys **in the body** (`idempotencyKey`, `submissionKey`) |
| Correlation | `X-Correlation-Id` echoed/generated; written to audit rows; never contains identity |
| Logging | Redact `auth_provider_subject_id`, `external_student_id`, OTPs, tokens, credentials |
| Roles | `participant` (own data only), `admin` = ACTIVE `SUPER_ADMIN` only; `internal/*` is worker-only (service context, not reachable with a browser token) |

### Error codes (additions to the existing table)

| Code | HTTP | Meaning |
|------|------|---------|
| `AGE_INELIGIBLE` | 422 | age < 13 or > 25 |
| `SCOPE_INVALID` | 422 | institution/cohort inactive, mismatched or unknown (does not leak cross-tenant existence) |
| `IDEMPOTENCY_CONFLICT` | 409 | key reused with a different payload |
| `DUPLICATE_IDENTITY` | 409 | auth pair or institution-scoped external ID already bound |
| `CATALOG_DRIFT` | 503 | expected assessment version missing or range mismatch (fail closed) |
| `PROTOCOL_UNAPPROVED` | 422 | consent protocol version not approved |
| `CONSENT_TRANSITION_INVALID` | 409 | illegal consent state change |
| `CONSENT_DUPLICATE` | 409 | a non-withdrawn consent already exists for the participant / type / protocol |
| `CONSENT_GATE_CLOSED` | 403 | required VERIFIED records missing (names the missing types, not identity) |
| `ASSESSMENT_NOT_OPEN` | 409 | version `DRAFT`/not `FROZEN`, `participation_state` ≠ `OPEN`, or control plane paused/stopped |
| `SESSION_LIMIT` | 409 | fifth session (controlled, non-diagnostic body) |
| `RESPONSE_KEY_CONFLICT` | 409 | response idempotency key reused with different payload |
| `SUBMIT_KEY_CONFLICT` | 409 | different submission key after submit |
| `ATTEMPT_LOCKED` | 422 | write after SUBMITTED |
| `QUALITY_NOT_CLEAR` | 409 | scoring before/without a CLEAR outcome |
| `REPORT_NOT_READY` | 404 | not REPORT_READY / terminal state |
| `PRIORITY_NOT_ELIGIBLE` | 422 | domain not reportable, held, or > 3 selected |
| `PATHWAY_NOT_ALLOWED` | 422 | score-only P3/P4, ordinary route from hold/invalid |
| `EXPORT_FILTER_UNKNOWN` | 422 | unsupported filter key |
| `AUDIT_UNAVAILABLE` | 503 | audit write failed; operation not performed |

## 2. Authentication and registration (BUILD 00 §11, BUILD 03, AT-01–05, AT-32)

| Method & path | Actor | Purpose | Notes |
|---------------|-------|---------|-------|
| `POST /auth/request-otp` | public (OPEN) | Request OTP by email or mobile | IP/device throttle first, then OTP throttle; never reveals whether the identity exists |
| `POST /auth/verify-otp` | public | Verify OTP, establish participant session | expiry, replay protection; response has no OTP echo |
| `POST /auth/login` | public | Santulan ID + password / temporary password | existing route extended; pending account + correct temp password ⇒ `mustSetPassword: true` (no session until set) |
| `POST /auth/set-password` | authenticated | Set permanent password after temp login | invalidates the temporary credential at once |
| `POST /registration/route` | public | Resolve age → eligibility, track, minor, required consent types, expected version | creates nothing |
| `POST /registrations/open` | public / worker | Create OPEN participant | `Idempotency-Key`; body: `age`, `language`, optional auth pair; **no** institution/cohort/`santulan_id`; returns `{santulanId, track, isMinor, requiredConsents}` (201 new / 200 replay) |
| `POST /registrations/institutional` | admin (roster path) | Create INSTITUTIONAL participant | `Idempotency-Key`; institution + cohort required and ACTIVE/matching; optional `externalStudentId` |
| `POST /participants/age-declaration` | participant | Capture integer age before consent | same routing function; rejects 12/26 |
| `GET /registration/state` | participant | Minimal routing + consent-requirement state, plus `attempt: { attemptId, status }` or `null` (the latest attempt) so the dashboard can resume | never returns auth subject or external ID |

Registration never creates an attempt and never states or implies consent/eligibility.

## 3. Consent (BUILD 04)

| Method & path | Actor | Purpose |
|---------------|-------|---------|
| `GET /consents/requirements` | participant | Required types + current state (derived from stored age) |
| `POST /consents` | privileged consent service | Create `PENDING` bound to an approved `protocol_version` (giver relationship validated; `INSTITUTION_DELEGATED` refused) |
| `POST /consents/{id}/grant` | giver flow | `PENDING → GRANTED` |
| `POST /consents/{id}/verify` | privileged verifier | `GRANTED → VERIFIED`; requires approved `verificationMethod` **code** (never OTP/contact/evidence) |
| `POST /consents/{id}/withdraw` | authorised actor | → `WITHDRAWN`; gate closes; triggers the approved withdrawal workflow hook (no deletion) |
| `GET /consents/gate` | participant | `{open, missingTypes[]}`; creates nothing |

## 4. Delivery (BUILD 05, AT-10–15, RC-01–03/07/08)

| Method & path | Purpose | Key behaviour |
|---------------|---------|---------------|
| `POST /attempts` | Create the one eligible attempt | server picks the version from stored age; consent gate + `FROZEN` version/scale + `participation_state=OPEN` + control plane OPEN; second nonterminal attempt rejected |
| `POST /attempts/{id}/sessions/resume` | Begin/resume | +1 session only on a true boundary; reconnect returns the same session; 5th ⇒ `SESSION_LIMIT` |
| `POST /attempts/{id}/responses` | Save/revise (append-only) | body `{itemId, value, responseTimeMs?, presentedOrder?, idempotencyKey}`; same key + same payload ⇒ same `responseId` |
| `POST /attempts/{id}/pause` | Pause/logout/timeout | `PAUSE` + `SESSION_END` |
| `POST /attempts/{id}/submit` | Atomic idempotent submit | body `{submissionKey}`; ends session, locks writes; replay-safe |
| `GET /attempts/{id}` | Resume model | `{status, progress:{completed,total,percent}, session:{n,of:4}, lastSavedAt, canContinue}` — **no scores** |
| `GET /attempts/{id}/items` | Player content: `{ scale: { points, anchors }, items: [{ itemId, order, domainCode, text }] }` for the attempt's own version | added for the frontend (the spec had no way to read item text); no keying, subdomain, hash or pilot status; participant token, own attempt only |
| `GET /attempts/{id}/responses` | Current answers only | never historical versions |
| `GET /attempts/{id}/scores` | Permitted scores | only rows RLS allows (S1/S0/SH hidden from participants) |

## 5. Reports, growth, pathways (BUILD 07, AT-18/19, RC-09–12)

| Method & path | Actor | Purpose |
|---------------|-------|---------|
| `GET /reports/{id}` | participant | Own released snapshot only, after `REPORT_READY` or T11/T12; otherwise 404 `REPORT_NOT_READY` |
| `POST /internal/attempts/{id}/quality` | worker | Run the approved quality policy; idempotent |
| `POST /internal/attempts/{id}/score` | worker | Body `{scoringVersion}` **only** |
| `POST /internal/attempts/{id}/report` | worker | Begin/generate from frozen inputs |
| `POST /internal/reports/{id}/retry` | worker / admin | Only `FAILED_RETRYABLE`; audited; no retake/rescore |
| `POST /internal/attempts/{id}/pathways` | worker / human workflow | P1–P5 decision logic; P5 not release-gated |
| `GET /growth-plans/{id}` | participant | Own plan — **404 while the prescriptive release is off** (except P5-driven pause state, which is not exposed) |
| `POST /growth-plans/{id}/priorities` | participant | select/reject/replace, ≤ 3, eligible domains only |
| `POST /growth-plans/{id}/goals` | participant | observable goal + editable If-Then |
| `POST /growth-plans/{id}/reviews` | participant | unscored review |

## 6. Admin and research (BUILD 08, AT-06–09, AT-16/17/20/21/27–30)

| Method & path | Purpose | Audit |
|---------------|---------|-------|
| `GET/POST /admin/institutions`, `PATCH /admin/institutions/{id}` | list/create/update/archive (status only) | yes |
| `GET/POST /admin/cohorts` | cohorts under an institution | yes |
| `GET /admin/participants` | filters: route, institution, cohort, status (**unknown keys ⇒ 422**) | read-logged where policy requires |
| `POST /admin/participants/{id}/status` | suspend/reactivate (reason required) | yes |
| `POST /cohorts/import` | body/multipart roster + `institutionId`, `cohortId`, `mode: validate\|commit` | validate returns row errors; commit is all-or-nothing after a clean validate; audit |
| `GET /admin/credentials/export/{importId}` | one-time controlled credential file | yes; not re-downloadable after expiry |
| `POST /admin/participants/{id}/credential-reset` | new temporary credential; previous invalid | yes |
| `GET/POST /admin/assessment-control` | read/change control-plane state `OPEN`/`PAUSED`/`STOPPED`, reason required for pause/stop | yes — fails closed if audit fails |
| `GET /admin/catalog` | version/scale status, counts, hashes, last reconcile receipt | — |
| `POST /admin/catalog/reconcile` | run reconcile (never apply) | yes |
| `GET /admin/monitoring/summary` | counts only (participants by route/status, attempts by state, reports by state/retry queue, exports by state, quality-review counts) | — |
| `GET /admin/quality-flags`, `PATCH /admin/quality-flags/{id}` | review queue; disposition + note only | yes |
| `POST /research-exports` | `Idempotency-Key`; body `{sourceAssessmentVersionId, anonymisationVersion, filters, includeAllVersions}` | yes |
| `GET /research-exports/{id}` | status + metadata | — |
| `GET /research-exports/{id}/download` | only when `READY`; streams the file | download audited; fails closed |
| `GET /admin/audit-logs` | read-only, filters actor/action/target/date | — |

Admin-only, ACTIVE `SUPER_ADMIN` context; a suspended admin gets 403; participants and other roles get 403 (B08-022/023).

## 7. Response shapes that matter

- **Registration** `{ santulanId, participationRoute, assessmentTrack, isMinor, requiredConsents: ["PARENT_GUARDIAN_CONSENT","STUDENT_ASSENT"] }` — never an attempt, never "eligible".
- **Resume model** as §4 — operational state only.
- **Report** `{ reportId, state: "REPORT_READY"|"UNDER_REVIEW"|"NOT_ELIGIBLE", sections: [{type, domain?, locale, contentVersion, order, content}] }` — only `is_released_to_participant` sections; T11/T12 carry the fixed neutral copy and no code, severity or reason detail beyond the safe administrative reason.
- **Export status** `{ exportId, status, createdAt, completedAt?, filters, anonymisationVersion, sourceAssessmentVersionId, dataset: "current-only"|"all-versions" }` — no file path.
- **Roster validate** `{ ok, rows: n, errors: [{row, field, code}], warnings: [...], eligible: {ADOLESCENT: n, EMERGING_ADULT: n} }` — codes, never PII echoes beyond the row number.

## 8. Non-goals of this contract

No endpoint accepts scores, quality dispositions, assessment version IDs from participants, Santulan IDs, DB context, or auth secrets; no endpoint exposes subdomain scores, Low/Average/High, percentiles, norm data or reliable-change claims; no endpoint reveals Q09 detail to participants; there is no delete for responses, audit rows, scores or report snapshots.
