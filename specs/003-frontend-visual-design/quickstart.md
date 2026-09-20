# Quickstart & Validation Guide: Frontend Visual Design (003)

> **Revision notice (2026-09-19)** — This file was generated before the Santulan 2.0 UI revision of [spec.md](spec.md). It still describes the earlier *calm & warm* cream/terracotta restyle of six existing screens and a system-font-only approach. The current requirements are the revised [spec.md](spec.md), [contracts/design-system.md](contracts/design-system.md) and [contracts/screen-inventory.md](contracts/screen-inventory.md) (25 reference screens, new public/registration/dashboard/profile screens, font budget instead of system-fonts-only). Regenerate this file with `/speckit-plan` / `/speckit-tasks` before implementing; until then treat conflicting details here as superseded.

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

## Per-screen review status (2026-09-20, feature 005 T135)

Legend: **built** = a real page exists and is covered by tests; **reference** = the sample is a design reference only, deliberately not built; **deferred** = not built (no canonical source, or gated). Screens 03 and 10 were compared visually against their PNGs and adjusted; the others were built from the written inventory and have **not** been compared visually.

| Sample | Screen | Status | Where / notes |
|--------|--------|--------|---------------|
| 01-03 | Home, About, Get started | built | `pages/public/PublicPages.jsx`. Screen 03 compared: centred title, two route cards with tick lists and full-width route buttons, help strip, header with Home / About / Support / Sign in. **Gaps**: no lotus logo or wordmark artwork, no decorative lotus/script art, no "For Institutions" nav item (no such page; D-02), footer shows only existing pages |
| 04-08 | Registration steps 1-5 | built | `pages/register/RegisterPage.jsx` (age in years, no date of birth, D-01) |
| 09 | Sign in | built | `pages/LoginPage.jsx` (temporary-password flow) |
| 10 | Student dashboard | built | `pages/participant/DashboardPage.jsx`. Compared: journey band with the action on the right, two-column progress / note-and-help area. **Gaps**: no hero photograph, no dates in the timeline (no source), no user name or bell (D-03, D-05); Resources / Wellbeing / Connect tiles and the sidebar entries for them are deferred (D-05) |
| 11-15 | Profile, interests, four-section questionnaire | reference | replaced by the seven-domain player; registration owns the rest |
| 16-17 | Assessment complete, generating | built | `AfterSubmitPages.jsx` |
| 18 | Recommended resources and next steps | deferred | gated and unsourced (BUILD 07) |
| 19 | Thank you | built (reduced) | `ThanksPage` (Your report, Support, Dashboard; no Take Action / Explore Resources) |
| 20 | Profile | built | `AccountPages.jsx` (Santulan ID, route, age range, language only) |
| 21 | Interests and goals | deferred | no canonical entity |
| 22 | Preferences | built (reduced) | `PreferencesPage`: Language (English only), Theme (light / dark, device only), Reduce motion |
| 24 | Privacy and consent | built | `AccountPages.jsx` (Withdraw and Give my consent) |
| 25 | Resources | deferred | no content source |
| results | Report | partly built | radar from released domain scores; report layers wait for the report backend (US7) |

