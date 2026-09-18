---

description: "Feature implementation task list for Frontend Visual Design"
---

# Tasks: Frontend Visual Design (003)

**Input**: Design documents from `/specs/003-frontend-visual-design/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: The feature spec mandates "User Scenarios & Testing" (each story lists an Independent Test and Acceptance Scenarios; SC-005 requires walkthrough evidence), so each phase includes component/a11y tests written FIRST (fail before implementation). The deterministic `check:contrast` script is the SC-003 proof.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

**Collaboration note**: This feature restyles files in `frontend/src/pages/` that the 002-capability-assessment implementation also writes. Do NOT start the 003 phases until 002 has converged and its frontend work is committed.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Web app**: `backend/src/`, `frontend/src/` at repository root; this feature is **frontend-only** (spec FR-009 — no backend/data changes).
- Tests under `frontend/src/tests/` (CRA Jest + React Testing Library + jest-axe).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and dependencies

- [X] T001 Create the project structure per plan.md: mkdir `frontend/src/styles/`, `frontend/src/components/` (subfolders `Button`, `Card`, `Field`, `ResponseScale`, `ProgressSummary`, `StatusMessage`, `FlagBadge`, `Skeleton`, `EmptyState`, `ScoreCard`), `frontend/src/tests/`, `frontend/scripts/`
- [X] T002 [P] Add dependencies to `frontend/package.json` and install: `lucide-react` (prod, tree-shakeable ES icons per research §2) and `jest-axe` (dev, per research §3); add scripts `"check:contrast": "node scripts/check-contrast.js"` and `"test": "react-scripts test"` (keep CRA default)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared visual foundation — tokens, reset, contrast gate — that MUST be complete before ANY user story (research §1/§4, FR-001)

> **CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 Create `frontend/src/styles/reset.css` per design-system.md §4: global reset (`margin/padding/box-sizing: border-box`), base `font-family: var(--font-sans)`, base 16px/`--lh-relaxed` ink-on-bg, link and button resets, and the default `:focus-visible` ring (`--focus-ring` + `--focus-offset`) so no screen can rely on an unstyled browser focus
- [X] T004 [P] Create `frontend/src/styles/tokens.css` — the `:root` custom properties from contracts/design-system.md §1: the **calm/warm palette** tokens (`--c-bg #FAF6EE`, `--c-surface #F1EADB`, `--c-surface-strong #E7DECC`, `--c-bg-white #FFFFFF`, `--c-ink #332F28`, `--c-ink-muted #5C574B`, `--c-ink-faint #7A7466`, `--c-brand #8C5A3C`, `--c-brand-strong #6F4630`, `--c-brand-soft #EFE1D2`, status colors `--c-status-info #3B5B68 / success #3F6B4F / warning #8A6B2F / error #A3483A / neutral #61656B` plus `--c-status-soft-*` tints), typography, spacing, radius, shadow, motion tokens, and a `@media (prefers-reduced-motion: no-preference)` motion-safe pattern (research §7)
- [X] T005 [P] Create `frontend/scripts/check-contrast.js` (research §4): reads the shipped `tokens.css`, resolves `:root` custom properties including one-level `var()` references and `rgba` compositing over `--c-bg`, computes WCAG 2.1 relative-luminance ratios with the zero-dependency `wcag-contrast` package, and asserts every foreground/background pair from the design-system.md §1 pair manifest at **4.5:1 for normal text, 3:1 for large text/UI components**; exits non-zero with the failing pairs on any violation. Wire it as `npm run check:contrast` (T002 script)
- [X] T006 [P] Write component tests FIRST in `frontend/src/tests/components.test.js` (expect FAIL until components exist): `jest-axe` assertions on `StatusMessage` (`role="alert"` for error/warning, `role="status"` otherwise, renders an icon AND text label — never color-alone per FR-004), `Button` (states + axe-clean), `Field` (`aria-invalid` + `aria-describedby`), `Card`/`Skeleton` (axe-clean)
- [X] T007 [P] Build `Card` in `frontend/src/components/Card/Card.jsx` + `Card.module.css` (surface, `--radius-lg`, `--shadow-2`, padding `--sp-5` — design-system.md §2)
- [X] T008 [P] Build `Button` in `frontend/src/components/Button/Button.jsx` + `Button.module.css` (variants `primary / secondary / quiet-link`, tone `brand / per-status`; `:hover` darken, `:focus-visible` `--focus-ring` + offset, `:active` press, `disabled` with retained label contrast — design-system.md §2, FR-003)
- [X] T009 [P] Build `Field` in `frontend/src/components/Field/Field.jsx` + `Field.module.css` (label + input/select with visible `:focus-visible` ring, `aria-invalid`, `aria-describedby` linking a `StatusMessage`-styled hint — FR-003)
- [X] T010 [P] Build `StatusMessage` in `frontend/src/components/StatusMessage/StatusMessage.jsx` + `.module.css` consuming the status-treatment map (research §5, FR-004): `type` neutral/success/warning/error/info → `--c-status-soft-*` tint bg + `--c-status-*` fg + **lucide icon + text label all required** (reject color-only usage); `role="alert"` (error/warning) / `role="status"` otherwise
- [X] T011 [P] Build `Skeleton` in `frontend/src/components/Skeleton/Skeleton.jsx` + `.module.css` (research §6, FR-007): blocks reserved to the final layout's exact size (`aria-hidden="true"`), shimmer only under `no-preference` motion, intended inside an `aria-busy="true"` region with a `role="status"` sr-only message debounced ~150 ms
- [X] T012 [P] Build `EmptyState` in `frontend/src/components/EmptyState/EmptyState.jsx` + `.module.css` (research §6, FR-007): lucide icon + short message + optional next action, occupying the same reserved space as the content it replaces

**Checkpoint**: Foundation ready — tokens/reset/contrast-gate + 6 core components and their tests green; user story implementation can begin

---

## Phase 3: User Story 1 - Participant sees a polished, calming assessment experience (Priority: P1) — MVP

**Goal**: The participant flow (login → profile → consent → questions → pause/resume → results) uses the shared calm/warm visual design with graphical progress, styled 1–5 scale with NO right/wrong framing (FR-005), distinct neutral vs. normal result treatments, calm session-limit/validation guidance, skeleton loading and 320px+ responsive layouts (FR-001–FR-007 on the participant surface).

**Independent Test**: Load the participant flow end-to-end (login → profile → consent → assessment → pause/resume → submit → results) at 320px phone width and desktop; every screen uses the shared palette/type/components, no unstyled native form elements, and progress is visually clear at every step.

### Tests for User Story 1 (write FIRST, ensure they FAIL before implementation)

- [X] T013 [P] [US1] Write participant UI + a11y tests in `frontend/src/tests/participant.test.js`: `ProgressSummary` renders answered/total + current domain + "session N of 4" with `role="progressbar"` + `aria-valuemin/max/now`; `ResponseScale` exposes 5 selectable options supporting arrow-key navigation and **no green-check/red-cross styling** (FR-005 assertion via absence of success/error icons/classes on options); `ScoreCard` renders normal results distinct from the neutral held/under-review treatment; jest-axe passes on question and results screens
- [X] T014 [P] [US1] Build `ResponseScale` in `frontend/src/components/ResponseScale/ResponseScale.jsx` + `.module.css` (1–5 Likert chips, min height 48px, selected = `--c-brand-soft` chip, keyboard radio-like navigation, FR-003/FR-005 from design-system.md §2)
- [X] T015 [P] [US1] Build `ProgressSummary` in `frontend/src/components/ProgressSummary/ProgressSummary.jsx` + `.module.css` (FR-002: graphical bar whose width = ratio + icon + label, `role="progressbar"` + `aria-valuenow/max/min`, answered/total text, current domain name, "session N of 4")
- [X] T016 [P] [US1] Build `ScoreCard` in `frontend/src/components/ScoreCard/ScoreCard.jsx` + `.module.css` (domain title, large readable score, completeness chip; normal vs. neutral held/under-review treatment distinguished by icon+label+color — never color alone, US1 scenario 3)
- [X] T017 [US1] Restyle `frontend/src/pages/LoginPage.jsx` + new `LoginPage.module.css` and `frontend/src/pages/participant/AssessmentPage.jsx` + `AssessmentPage.module.css` per screen-inventory §1–3: centered `Card`, `Field`s, primary `Button`, `StatusMessage` for login error / `CONSENT_INCOMPLETE` (warning, calm guidance) / `SESSION_LIMIT` (warning, "You've reached the session limit" + restart guidance, never an alert/red text block) / validation errors; `Skeleton` loading for profile/attempt; question screens with `ProgressSummary`, domain header `Card`, large-item text, `ResponseScale`, next/back `Button`s; pause-state calm info message and "Continue Assessment" primary `Button` (002 US2 behavior unchanged)
- [X] T018 [US1] Restyle `frontend/src/pages/participant/ResultsPage.jsx` + `ResultsPage.module.css` per screen-inventory §4: 7 domain `ScoreCard`s (not a raw table) with completeness chips; released descriptive report layers as `Card`s; neutral hold/under-review/insufficient-data via `StatusMessage` (`neutral`, "Under review" / "Not enough data") distinct from normal results; `Skeleton` grid matching the 7 cards while loading; `EmptyState` ("No report yet")
- [X] T019 [US1] Wire the global styles: import `frontend/src/styles/reset.css` + `tokens.css` in `frontend/src/index.js`; remove default `App.css` button/form styling so no screen keeps native unstyled controls; confirm the participant screens consume only tokens and the shared components (SC-001)

**Checkpoint**: Participant flow fully styled and independently verifiable at mobile+desktop widths (MVP)

---

## Phase 4: User Story 2 - Admin sees a clear, efficient operational visual design (Priority: P2)

**Goal**: The admin import/control and submissions screens become a dashboard-like view using the same visual language, with scannable status (active version, participation state), import outcomes with a scannable error list, and per-submission scores/flags visually grouped and distinguished (needs-review vs. reviewed) — distinct in tone from participant, same palette/type/components.

**Independent Test**: Load the admin import screen and the submissions list/detail; import success/failure, participation state, and per-submission score/flag status each distinguishable at a glance without dense text; the two admin sub-views are clearly wayfound.

### Tests for User Story 2 (write FIRST, ensure they FAIL before implementation)

- [X] T020 [P] [US2] Write admin UI + a11y tests in `frontend/src/tests/admin.test.js`: `FlagBadge` renders "needs review" (`ShieldAlert`) vs "reviewed" (`ShieldCheck`) with distinct labels/icons (never color alone, FR-004); import success vs failure render distinct `StatusMessage` treatments with icon+label; submissions list renders status/session-count/flag chips; admin screens pass jest-axe
- [X] T021 [P] [US2] Build `FlagBadge` in `frontend/src/components/FlagBadge/FlagBadge.jsx` + `.module.css` (Q01–Q09 chip, `ShieldAlert` needs-review with warning tint vs `ShieldCheck` reviewed with success tint + code + label; dispositioned vs needs-review distinguished by icon and label, not color only — US2 scenario 3)
- [X] T022 [US2] Restyle `frontend/src/pages/admin/ImportPage.jsx` + `ImportPage.module.css` per screen-inventory §5: file `Field` (accept `.xlsx`) + primary `Button`; active-version chip ("Live: <version label>"); import outcome via `StatusMessage` success ("Import complete — N items live") or error ("Import failed") **with a scannable, styled row/column error list** (each row icon + column + message — never a raw dump); participation segmented control (Open/Paused/Stopped) with reason `Field` and a state chip reflecting it (icon+label)
- [X] T023 [US2] Restyle `frontend/src/pages/admin/ResultsAdminPage.jsx` + `ResultsAdminPage.module.css` per screen-inventory §6: submissions list with per-row status/session-count/flag chips and score-status chips (scannable without reading every cell); detail view grouping domain `ScoreCard`s separately from quality `FlagBadge`s + report-generation state chip; `Skeleton` list/table matching row heights; `EmptyState` ("No submissions yet"); inline `EmptyState` where a submission has no quality flags

**Checkpoint**: Admin flow is fully styled and independently verifiable; 002 functionality unchanged (FR-009)

---

## Phase 5: User Story 3 - The whole app reads as one consistent, accessible product (Priority: P3)

**Goal**: Cross-cutting consistency + accessibility pass across every screen — same palette/type/spacing/components everywhere, visible styled focus for all interactive elements, reduced-motion support, color-blind-safe statuses, and WCAG AA proven by the automatic gate and audits.

**Independent Test**: Navigate every screen (participant + admin) in one sitting; the same palette, type scale, spacing rhythm, and component styles recur, and every text/background combination and interactive state passes a standard accessible-contrast check.

### Tests for User Story 3 (write FIRST, ensure they FAIL before implementation)

- [X] T024 [P] [US3] Write the cross-cutting a11y test file `frontend/src/tests/accessibility.test.js`: walk the shared components (`Button`, `Field`, `StatusMessage`, `ResponseScale`, `FlagBadge`) with jest-axe asserting zero axe violations; assert focusables expose a non-default focus-visible style (FR-003); assert status/emphasis elements carry icon or text label in addition to color (FR-004)
- [X] T025 [P] [US3] Run `npm run check:contrast` against `frontend/src/styles/tokens.css` and fix any failing token pair values in the tokens file (or the pair manifest) until ALL pairs pass AA (4.5:1 normal / 3:1 large+UI) — SC-003 proof (research §4)
- [X] T026 [US3] Reduced-motion + focus audit across `frontend/src/pages/` and components: every animation/transition is gated inside `@media (prefers-reduced-motion: no-preference)`; under `reduce`, essential indicators (spinner, focus ring) remain and travel is replaced by crossfade; focus ring is never removed under reduced motion (WCAG 2.4.7 — research §7)
- [X] T027 [P] [US3] Color-blind audit: scan every status/flag/progress surface with a deuteranopia simulator and confirm each is identifiable from icon + label alone, not color (FR-004, edge case); fix any color-only reliance found
- [X] T028 [US3] Consistency audit: side-by-side review of all six screens confirming the same palette/type/spacing/component styles recur; replace any per-screen duplicated colors/fonts with the shared tokens/components (SC-004)
- [X] T029 [P] [US3] 320px responsive pass: verify all screens render at 320px, a common tablet width, and desktop with no horizontal scrolling or clipped/overlapping content; ensure long item text wraps (`overflow-wrap: anywhere`) and touch targets ≥ 48px (FR-006, SC-002)

**Checkpoint**: Every screen passes the consistency + accessibility audits; all automated gates green

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, performance guard, cleanup

- [X] T030 [P] Performance guard (SC-006): confirm the assessment question screen imports only the lucide icons/components it uses (named imports, tree-shaking), no web-font downloads, no runtime CSS engine; log the diff of the CRA bundle budget before/after the restyle
- [X] T031 [P] Run `specs/003-frontend-visual-design/quickstart.md` end-to-end: Scenarios 1–7 (participant flow at 320px + desktop, progress clarity, result/neutral states, session limit/validation, admin import, admin submissions, consistency+accessibility) + automated gates
- [X] T032 Final hardening: full `npm test` (frontend) green covering `components.test.js`, `participant.test.js`, `admin.test.js`, `accessibility.test.js` + existing CRA tests; `npm run check:contrast` exits 0; confirm 002 backend test suites still green (FR-009 regression); remove dead `App.css` leftovers and any leftover unstyled-native-control paths

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately (but see collaboration note — only the 002-unrelated files)
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-5)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1) MVP**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Reuses the core components (Foundational) but touches only admin pages; independently testable
- **User Story 3 (P3)**: Depends on US1 AND US2 being complete (it is the cross-cutting audit over both surfaces - its value requires them to exist)

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Shared components (ResponseScale/ProgressSummary/ScoreCard or FlagBadge) BEFORE page restyles that consume them
- Page restyle BEFORE the global-wiring/integration step (e.g., index.js styles import comes last in US1)
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (token/reset/contrast-script/tests/components)
- All participant components in US1 marked [P] can run in parallel
- US1 and US2 page restyles can run in parallel once Foundational is done (separate page files)
- US3 audit tasks marked [P] can run in parallel (they read/fix different dimensions)

---

## Parallel Example: User Story 1

```bash
# Launch the participant component tests + components together:
Task: "Write participant tests frontend/src/tests/participant.test.js"
Task: "Build ResponseScale frontend/src/components/ResponseScale/ResponseScale.jsx"
Task: "Build ProgressSummary frontend/src/components/ProgressSummary/ProgressSummary.jsx"
Task: "Build ScoreCard frontend/src/components/ScoreCard/ScoreCard.jsx"

# After components are green, restyle the screens (sequential, shared files):
Task: "Restyle LoginPage + AssessmentPage (participant)"
Task: "Restyle ResultsPage (participant)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Run participant tests + `npm run check:contrast`; visually walk Scenario 1–4 at 320px and desktop
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready (tokens + core components + contrast gate green)
2. Add User Story 1 → Test independently → Demo (MVP!)
3. Add User Story 2 → Test independently → Demo
4. Add User Story 3 → Audits + fixes → Final gates
5. Each story adds value without breaking previous stories (FR-009 regression checked every step)

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (participant flow)
   - Developer B: User Story 2 (admin flow)
3. After US1+US2: Developer C: User Story 3 (cross-cutting audits)
4. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
- **Collaboration**: 003 modifies the same `frontend/src/pages/` files as 002 — only start US1/US2 page restyles after 002's frontend work has converged and been committed (results/details pages depend on the 002 screens existing and stable)
- Token/component values are the contract; `frontend/scripts/check-contrast.js` is the authority for color pairs — adjust token hexes in `tokens.css` to satisfy AA, never lower the 4.5:1 / 3:1 targets