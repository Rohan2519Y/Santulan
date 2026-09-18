# Screen Inventory Contract: Frontend Visual Design (003)

**Branch**: `003-frontend-visual-design` | **Date**: 2026-09-18 | **Design System**: [design-system.md](design-system.md)

Maps every existing 002 screen in `frontend/src/pages/` to the visual treatment it must receive (tokens, components, and loading/empty states from the design-system contract). **FR-009: no functional behavior, validation, or data change — presentation only.** No new screens are added (spec Assumptions).

## Participant flow

### 1. `frontend/src/pages/LoginPage.jsx`
- Brand-awarded hero banner area (calm warm gradient, product name, sr-only tagline), centered `Card` with `Field`s (email/password) and primary `Button`.
- States: loading on submit (Button disabled + inline spinner); error → `StatusMessage` (`error`, "Login failed – check your details").
- Note: auth route mounts at `/api/v1/auth` (002) — no change to it.

### 2. Profile declaration + consent (rendered by `AssessmentPage.jsx` / shared step UI)
- Step cards: profile fields (`Field`) → consent selection with explanatory copy (`Card`), including the minor gate step (parent consent + assent) with calm wording (never scaring).
- States: `CONSENT_INCOMPLETE` → `StatusMessage` (`warning`, calar guidance listing required consents); validation → `error` `StatusMessage` next to the field.

### 3. Assessment question screens (`AssessmentPage.jsx`)
- Question layout: `ProgressSummary` at top (answered/total + current domain + "session N of 4"), domain header (`Card`, domain name), item text large + readable, `ResponseScale` 1–5 row (no right/wrong visuals), next/back `Button`s.
- States: save-in-flight → inline skeleton only on the scale row; `SESSION_LIMIT` on start/resume → `StatusMessage` (`warning`, "You've reached the session limit" + restart guidance); paused state → calm "Paused – resume when you're ready" (`info`).
- Resume: saved answers restored shown as filled chips exactly as saved; "Continue Assessment" primary `Button` (002 US2 behavior unchanged).
- Loading profile/attempt data → `Skeleton` cards; empty/no-active-version → `StatusMessage` (`warning`, "The assessment is not available right now").

### 4. Participant results (`frontend/src/pages/participant/ResultsPage.jsx`)
- Own 7 domains as `ScoreCard`s; completeness chip per domain; released (descriptive) report layers as `Card`s, gated prescriptive layers never rendered (002 FR-018 unchanged).
- Neutral states (hold / insufficient / under review) use `StatusMessage` (`neutral`, "Under review" / "Not enough data") distinct from normal results — styled as guidance, never error.
- Loading → `Skeleton` grid matching the 7 ScoreCards; empty/no report → `EmptyState` ("No report yet").

## Admin flow

### 5. Admin import + control (`frontend/src/pages/admin/ImportPage.jsx`)
- Import: file `Field` (accept `.xlsx`) + primary `Button`; active-version `FlagBadge`-style chip (e.g., "Live: santulan-adolescent-pilot-v1.0").
- Outcomes: `StatusMessage` `success` ("Import complete – N items live") or `error` ("Import failed") **+ scannable styled list** of row/column errors (never a raw dump), each row icon + column + message.
- Participation control: segmented control (Open / Paused / Stopped) with reason `Field`; resulting state reflected by a state chip (icon+label, never color alone).

### 6. Admin submissions (`frontend/src/pages/admin/ResultsAdminPage.jsx`)
- List: per-row status/session-count/flag presence as chips + icons (`FlagBadge`, score-status chip) — scannable without reading every cell (US2 scenario 2).
- Detail: grouped sections — domain `ScoreCard`s, quality `FlagBadge`s (needs-review vs. dispositioned distinguished), report-generation state chip; flag needing review visually distinct from dispositioned (icon+label).
- States: loading → `Skeleton` table/list matching row heights (zero shift); empty → `EmptyState` ("No submissions yet"); individual flags absent on a submission → `EmptyState` inline ("No quality flags").

## Cross-cutting (applies to all screens)

- `frontend/src/styles/reset.css` + `frontend/src/styles/tokens.css` imported once in `index.js`; components import their `*.module.css` and consume tokens.
- Shared `Button`/`Field`/`StatusMessage`/`Card`/`Skeleton`/`EmptyState` used everywhere — no screen-paged custom CSS for shared affordances (SC-004/FR-001).
- Every interactive element shows a distinct `:focus-visible` state (research §7); motion disabled under `prefers-reduced-motion`; status never by color alone (FR-004).
- Regression guard (FR-009): the functional test suites from 002 must stay green after restyle (run `backend/tests` untouched + `frontend` component tests).