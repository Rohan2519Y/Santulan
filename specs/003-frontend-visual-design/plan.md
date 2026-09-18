# Implementation Plan: Frontend Visual Design (003)

**Branch**: `003-frontend-visual-design` | **Date**: 2026-09-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-frontend-visual-design/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command; its definition describes the execution workflow.

## Summary

Restyle the existing 002-capability-assessment frontend (React 19 / Create React App) into one calm, warm, accessible product. Presentation-layer only (FR-009): no new screens, no functional/data changes. A single design system is established — CSS custom-property tokens, CSS Modules, ~11 shared components, and a status-treatment map enforced to never use color alone — applied to the login, participant assessment/results flow, and admin import/results screens, with mobile (320px+) responsiveness, skeletons/empty states, WCAG AA contrast proved by a deterministic script, focus-visible rings, and reduced-motion support.

## Technical Context

**Language/Version**: JavaScript (ECMAScript, CRA build) — React 19, Create React App (CRA 5, `react-scripts`). No TypeScript migration.

**Primary Dependencies**: `lucide-react` (prod, tree-shakeable ES module icons, ~80–105 B/icon — research §2); `jest-axe` (dev only, component a11y assertions — research §3). CSS: **CSS Modules** (`*.module.css`, CRA-built-in) + global `frontend/src/styles/tokens.css` custom properties + `reset.css`. No CSS framework (Tailwind v4 is incompatible with `react-scripts`; research §1). No font downloads (system font stack — SC-006).

**Storage**: N/A — this feature touches no data layer; all 002 entities/endpoints unchanged (spec Key Entities: no new entities; FR-009).

**Testing**: Jest + React Testing Library (CRA default) plus `jest-axe` for a11y component assertions; new deterministic WCAG AA contrast script `npm run check:contrast` (research §4, SC-003 proof). 002 backend suites untouched and must stay green (regression).

**Target Platform**: Responsive web app in a browser — mobile widths down to 320px, tablet, desktop (spec Assumptions: not native). Chrome/Edge/Firefox/Safari modern evergreen.

**Project Type**: Web application — frontend only (restyle of existing `frontend/`).

**Performance Goals**: SC-006 — no material increase in the assessment question screen's initial load on throttled mobile: static CSS only, only-imported lucide icons, no web fonts, no runtime styling engine.

**Constraints**: FR-001 single calm/warm visual language on every screen; FR-002 progress via graphical indicators; FR-003 styled interactive states with visible focus; FR-004 status never by color alone (icon+label+color); FR-005 no right/wrong visuals on response scale; FR-006 layout usable to 320px without horizontal scroll/clipping; FR-007 loading + empty states on every async view/list; FR-008 WCAG 2.1 AA (4.5:1 normal, 3:1 large/UI); FR-009 presentation-only regression guard.

**Scale/Scope**: 6 existing screens (LoginPage, participant AssessmentPage incl. profile/consent/pause-resume, participant ResultsPage, admin ImportPage, admin ResultsAdminPage), ~11 shared components, 1 tokens file + 1 reset file, 1 contrast-check script.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution file (`.specify/memory/constitution.md`) is the unfilled placeholder template — no concrete principles, constraints, or governance rules have been ratified by the project. **No gates apply.** The plan applies the repo conventions (features as `specs/###-` scoped work, CRA `frontend/`, Jest). **Post-design re-check (after Phase 1)**: no new constraints surfaced in research/data-model/contracts/quickstart; the design stays presentation-layer-only (FR-009) with no data-model changes. Gate remains PASS / nothing to track.

## Project Structure

### Documentation (this feature)

```text
specs/003-frontend-visual-design/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── design-system.md     # Tokens + components + status treatments (UI contract)
│   └── screen-inventory.md  # Per-screen application of the design system
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root → frontend only)

```text
frontend/
├── package.json                     # Bump: add lucide-react (prod) + jest-axe (dev)
├── scripts/
│   └── check-contrast.js            # NEW: deterministic WCAG AA token check (research §4)
├── src/
│   ├── styles/
│   │   ├── reset.css                # global reset
│   │   └── tokens.css               # :root design tokens (research §1)
│   ├── components/
│   │   ├── Button/Button.jsx|.module.css
│   │   ├── Card/Card.jsx|.module.css
│   │   ├── Field/Field.jsx|.module.css
│   │   ├── ResponseScale/ResponseScale.jsx|.module.css   # 1–5 Likert chips, no right/wrong
│   │   ├── ProgressSummary/ProgressSummary.jsx|.module.css
│   │   ├── StatusMessage/StatusMessage.jsx|.module.css   # icon+label+color enforced
│   │   ├── FlagBadge/FlagBadge.jsx|.module.css           # Q01–Q09, review-vs-reviewed
│   │   ├── Skeleton/Skeleton.jsx|.module.css
│   │   ├── EmptyState/EmptyState.jsx|.module.css
│   │   └── ScoreCard/ScoreCard.jsx|.module.css
│   ├── pages/                       # existing screens RESTYLED in place (no new pages)
│   │   ├── LoginPage.jsx|.module.css
│   │   ├── participant/AssessmentPage.jsx|.module.css    # profile/consent/questions/pause-resume
│   │   ├── participant/ResultsPage.jsx|.module.css
│   │   ├── admin/ImportPage.jsx|.module.css
│   │   └── admin/ResultsAdminPage.jsx|.module.css
│   ├── index.js                     # import reset.css + tokens.css once
│   └── tests/                       # component + jest-axe a11y tests
```

**Structure Decision**: Frontend-only web app (spec Assumptions — no new screens; FR-009). Follows CRA's built-in CSS Modules per component folder; global tokens/reset imported once in `index.js`; shared components under `src/components/` consumed by the existing `pages/` (restyled in place, keeping 002 behavior). New `scripts/check-contrast.js` gives the deterministic AA gate. No backend, no data-model changes.

## Complexity Tracking

> No Constitution Check violations exist — this section is intentionally left empty.