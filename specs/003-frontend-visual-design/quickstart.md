# Quickstart & Validation Guide: Frontend Visual Design (003)

**Branch**: `003-frontend-visual-design` | **Date**: 2026-09-18 | **Contracts**: [contracts/design-system.md](contracts/design-system.md), [contracts/screen-inventory.md](contracts/screen-inventory.md) | **Data Model**: [data-model.md](data-model.md)

## Prerequisites

- 002-capability-assessment backend running (per its own quickstart): Postgres + migrations + seed.
- Frontend at `F:\Santulan\frontend` (CRA). Backend ports and JWT flow unchanged.
- Backend `CORS_ORIGINS` (backend/.env) must include `http://localhost:3000` (the CRA dev server's default origin) - without it, every `fetch()` from the browser to the API fails with a CORS preflight error even though the same request succeeds from Supertest/curl (002 research §8). The default already covers this; only change it if the frontend runs on a different port/host.

## Setup & run

```powershell
cd frontend
npm install                        # adds lucide-react (prod); jest-axe (dev)
copy .env* (if any) / or leave CRA defaults with API base set in frontend/src/services/assessmentApi.js
npm run check:contrast             # NEW deterministic WCAG AA token check (research §4) — must exit 0
npm test                           # jest: existing CRA tests + new component/a11y tests (jest-axe) — must pass
npm start                          # dev server; open http://localhost:3000
```

Run the backend first if you want live data; screens also render loading/empty states without it.

## End-to-end verification scenarios (from spec acceptance criteria + SC)

### Scenario 1 — Participant flow (US1, SC-001/002)
1. Phone-width (DevTools 375px) AND specifically **320px**: log in → profile → consent → first assessment questions → pause/resume → submit → results.
2. Check **no horizontal scrolling** and no clipped/overlapping text at 320px; long item text wraps (`overflow-wrap`); touch targets ≥ 48px.
3. Check every participant screen uses the shared palette/type/components — no unstyled native form controls, no browser alert.
4. **FR-005**: confirm no green-check/red-cross styling on response options.

### Scenario 2 — Progress clarity (US1 scenario 2, SC-005)
- Partway through: the `ProgressSummary` shows answered/total + current domain + "session N of 4" via **graphical** indicator (bar width + icons + text), not only text.
- A test user can state "how far along" from the visual alone.

### Scenario 3 — Result & neutral states (US1 scenario 3)
- After a successful submit: 7 domain `ScoreCard`s visually distinguished by domain; scores/completeness shown with simple visual treatment, not a raw table.
- Force a held/under-review attempt (quality-hold in 002): the participant sees the single **neutral** message styled distinctly (icon+label+neutral palette), **not** as an error/red block.

### Scenario 4 — Session limit & validation (US1 scenario 4)
- Use 4 sessions, attempt a 5th → `SESSION_LIMIT` `StatusMessage` styled calm guidance (warning icon + text), not an alert/red text block.
- Trigger a validation error (e.g., skip a required consent) → styled field error, not raw red text.

### Scenario 5 — Admin import (US2 scenario 1, SC-004)
- Upload a valid pool → `StatusMessage` success; upload an invalid file → failure message **with a scannable, styled row/column error list** (not raw dump). Both visually distinct (icon+label+color) and not identical-looking text blocks.
- Toggle participation Open/Paused/Stopped → state chip updates with icon+label.

### Scenario 6 — Admin submissions (US2 scenarios 2–3)
- List: status, session count, and flag presence scannable via chips/icons/badges without reading every cell.
- Detail: domain scores grouped vs. quality flags grouped; a "needs review" flag is visually distinct from a "reviewed" flag (icon+label).
- Empty list (pre-first-submission) → `EmptyState`, not a blank table body. Loading → `Skeleton` (no layout jump).

### Scenario 7 — Consistency & accessibility pass (US3)
- In one sitting navigate **every** screen (participant + admin): same palette, type scale, spacing, components recur; each screen looks part of the same app (SC-004).
- Tab/keyboard: every button/input/link shows a visible `:focus-visible` ring distinct from rest (SC-003b). OS "reduce motion" on → no travel animation, focus ring still visible (WCAG 2.4.7).
- **Color-blind check**: with a deuteranopia simulator, every status is still identifiable from icon+label alone (never color-only, FR-004).

## Automated gates (run in this order after implementation)

- [ ] `npm run check:contrast` exits 0 — every declared text/UI pair in `tokens.css` passes AA (4.5:1 normal / 3:1 large+UI) — **SC-003 proof**.
- [ ] `npm test` (frontend) green: existing CRA tests **and** new component tests incl. `jest-axe` assertions on `StatusMessage`, `ResponseScale`, forms (SC-001/003/005 support), plus layout smoke tests asserting no-660px-horizontal-scroll class usage at minimum.
- [ ] 002 backend test suites still green (regression of FR-009).

## Manual walkthrough sign-off (SC-004/005)

Run Scenarios 1–7 with a person unfamiliar with the build; record:
- Any screen judged visually inconsistent with the rest → fail SC-004.
- Any participant who misidentifies progress or result status from visuals alone → fail SC-005.