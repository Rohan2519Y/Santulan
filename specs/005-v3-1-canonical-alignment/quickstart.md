# Quickstart: v3.1 Canonical Alignment (005)

**Branch**: `005-v3-1-canonical-alignment` | **Date**: 2026-09-19 | **Plan**: [plan.md](plan.md) | **Contracts**: [api](contracts/api.md) · [database](contracts/database-contract.md) · [catalog](contracts/catalog-import.md)

A run-and-verify guide. Commands marked **(planned)** are created by this feature; the rest exist today. Nothing here contains implementation code — bodies live in `tasks.md` and the implementation.

## Prerequisites

- Node.js and npm; PostgreSQL 15+ (local 18.6 or the `postgres:16` container from `backend/docker-compose.yml`); `psql`/`pg_dump`/`pg_restore` on PATH for the restore drill.
- `backend/.env` from `.env.example` (`DATABASE_URL` owner, `RUNTIME_DATABASE_URL` = `app_runtime`, `PLATFORM_DATABASE_URL` legacy only). Roles come from `docker/init-app-role.sql` (extended with `santulan_worker`).
- **Use a scratch database for the checks below** (e.g. `santulan_qual`), never the shared dev database, and never real participant data.

## 1. Schema and fail-closed seeds (US1, SC-001)

```bash
cd backend
npm run db:migrate            # applies 008…024 (planned files) then grant scripts
npm run test:santulan -- database/structure
```

Expected: 28 base tables in `santulan`; both assessment versions `DRAFT`/`CLOSED`; scale `DRAFT`; 216 actions inactive; 72 prompts `DRAFT`; 0 interpretation rules; `app_runtime` not `BYPASSRLS`. Re-running `db:migrate` changes nothing. (Queries: database-contract §6.)

## 2. Catalog verify and reconcile (US1, SC-002)

```bash
npm run catalog:verify        # (planned) offline: counts, coverage, legality, v3_0 cross-check
npm run catalog:reconcile     # (planned) default mode; writes catalog_receipt_*.json
npm run catalog:reconcile     # second run → 0 inserts, 0 updates
```

Expected: 175/171 rows, 72 subdomains each, 124 shared codes, 0 `C4.6`, both versions unchanged, one audit event per run. Negative checks (T-B02-009…019): change one item text, delete/add a row, open a version — each must fail and roll back.

## 3. Registration and age routing (US2, SC-003/004)

```bash
npm run test:santulan -- contract/registration database/registration
```

Register synthetic participants at ages 12, 13, 17, 18, 25, 26: 12/26 rejected; 13/17 → ADOLESCENT + both consents; 18/25 → EMERGING_ADULT + self-consent only. Confirm after each success that `santulan.assessment_attempts` has **no** row. Replay the same `Idempotency-Key` → same participant; change the body → `409`. Send a body containing `santulanId` → `VALIDATION_ERROR`.

## 4. Consent gate (US3)

Drive a minor and an adult through PENDING → GRANTED → VERIFIED (privileged verifier) and every illegal step (T04-005…017). Expected: minor gate opens only with **both** VERIFIED; adult with `ADULT_SELF_CONSENT`; withdrawal closes it at once; `INSTITUTION_DELEGATED` refused. Then confirm a fully consented participant **still cannot** create an attempt while the version is `DRAFT`/`CLOSED` (T04-030).

## 5. Delivery (US5) — needs a test-only opened version

In the scratch DB only, run `scripts/santulan-freeze.js --test-only` (planned; uses a **test** response-scale approval hash and never runs against non-scratch databases) to freeze the scale and one version and open participation.

```bash
npm run test:santulan -- integration/delivery
```

Expected (B05-001…045): one nonterminal attempt; sessions 1–4 and a controlled refusal at 5; reconnect does not change `session_count`; revision creates version 2 and one CURRENT; same key + same payload → same `responseId`; different payload → conflict; two parallel saves → contiguous versions; two parallel submits → one `SUBMIT` event; writes after submit refused; the legacy `submit_attempt(uuid)` function does not exist.

## 6. Quality, scoring, evidence (US6)

Score a known vector (all 1s, all 5s, a mixed vector) and compare each of the seven domain means to hand-calculated values; check missingness at exactly 20 % (no participant interpretation, S1) and exactly 40 % (NULL score, S0); inject a cross-version response (Q06 → INVALID) and an authorised Q09 (QUALITY_HOLD, no score); confirm a REVERSE-keyed test item hard-fails; confirm default evidence state is `S1` and a participant context cannot read those rows; confirm the research-only view is unreachable by participants (B06-001…060).

## 7. Reports, growth, pathways (US7)

Generate a report for a scored attempt → `REPORT_READY` only after snapshots persist; force a failure → `FAILED_RETRYABLE`, attempt still `SCORED`, retry → identical snapshots (byte compare); a `QUALITY_HOLD` attempt → T11 with the neutral copy and no flag data; participant retrieval shows descriptive sections only; flip `is_released_to_participant` for a synthetic PRIORITY section → visible without redeploy; fire the P5 hook with the release flag off → decision created, ordinary plan paused; attempt P3 from a low score → refused (B07-001…080).

## 8. Admin, audit, export (US8)

Stop then reopen participation as SUPER_ADMIN: a new attempt is refused while stopped and allowed after reopening, with two audit rows (actor, previous → new, reason). Simulate an audit-insert failure → the change does not happen. Try `UPDATE`/`DELETE` on `responses` and `audit_logs` as owner and as admin → refused.

Export partitioning (synthetic, no real data):

```bash
npm run test:santulan -- unit/export-partition     # boundary arithmetic: 1,048,575 → 1 sheet; 1,048,576 → 2; 2,220,000 → 3
npm run export:synthetic -- --participants 10000 --items 222   # (planned) end-to-end file; check memory stays flat
```

Expected: ≥ 3 `ITEM_RESPONSES_nn` sheets, none above 1,048,576 rows including header, row totals reconcile, no `participant_id`, `auth_provider_subject_id`, `external_student_id`, email, phone or guardian fields in the default workbook; unknown filter key → `422`; formula-leading text is escaped.

## 9. Sign-in and roster (US4)

```bash
npm run db:seed:platform      # demo accounts (dev only)
npm run test:santulan -- integration/roster
```

Validate the sample roster `docs/Creative Minds Global School- required Students Info_014006.xlsx` against a test institution/cohort: expect the two age-12 rows reported as errors **before** commit and the three age-18 rows counted as EMERGING_ADULT; commit a corrected copy; first login with the temporary password forces a new password; a second temporary credential invalidates the first.

## 10. Security and recoverability (US9)

```bash
npm run test:santulan -- security          # SEC-01…SEC-30 (except SEC-15) that can run locally
npm run drill:backup-restore               # (planned) dump → clean DB → restore → checks → evidence file
```

Expected: institution-scoped contexts never see other institutions' or OPEN rows; no context returns nothing; a payload attempting to set context is ignored; the runtime role has no `BYPASSRLS`; pooled connections do not leak context; OPEN registration beyond the IP/device throttle limits is refused independently of OTP limits; the restored database passes the 28-table, policy, data-reconciliation and smoke checks. The evidence register (`tests/santulan/evidence/register.json`) lists every AT/RC/SEC ID with status; staging-only items read `NOT_EXECUTED` — **launch stays NO-GO until they are PASS with evidence**.

## 11. Frontend (US10)

```bash
cd frontend
npm run check:contrast
npm test
npm start                                   # then walk the screens below at 320, 768 and 1280 px
```

Walk: `/` → `/get-started` → `/register` (steps 1–5) → `/login` → `/student` (each state in dashboards.md §1.2) → assessment → generating → report / T11 / T12 → profile → privacy; then `/admin` pages in dashboards.md §2.3. Compare each provided screen to its rendering; confirm no date-of-birth field, no participant name/photo, no semantic ID, no simulated progress, no prescriptive content while the release flag is off, and no prohibited claim (G9 scan).

## Definition of "done" for this guide

Every section's expected results are observed, the evidence register shows no unexplained `FAIL`, and the remaining `NOT_EXECUTED` entries are exactly the staging/governance gates listed in the spec's Assumptions.
