# Research: Frontend Visual Design (003)

> **Revision notice (2026-09-19)** — This file was generated before the Santulan 2.0 UI revision of [spec.md](spec.md). It still describes the earlier *calm & warm* cream/terracotta restyle of six existing screens and a system-font-only approach. The current requirements are the revised [spec.md](spec.md), [contracts/design-system.md](contracts/design-system.md) and [contracts/screen-inventory.md](contracts/screen-inventory.md) (25 reference screens, new public/registration/dashboard/profile screens, font budget instead of system-fonts-only). Regenerate this file with `/speckit-plan` / `/speckit-tasks` before implementing; until then treat conflicting details here as superseded.

**Branch**: `003-frontend-visual-design` | **Date**: 2026-09-18 | **Plan**: [plan.md](plan.md)

Research that resolves the technical unknowns in the [Implementation Plan](plan.md). This feature restyles the existing 002-capability-assessment frontend only; no backend/data changes.

## 1. CSS architecture for the CRA app

- **Decision**: **CSS Modules** (`*.module.css`, CRA-built-in) for per-component scoping **plus** a single global design-token file `frontend/src/styles/tokens.css` declaring every design value as CSS custom properties on `:root` (palette, type, spacing, radius, shadow, motion, focus). No CSS framework is added.
- **Rationale**: CRA 5 has zero-config support for CSS Modules and already wires Jest's `identity-obj-proxy`, so class names resolve in tests without ejection or build-tooling changes. Tokens as custom properties are consumed by both modules and any global file (global layer, reset). Runtime CSS stays static and small, which keeps the assessment screen's initial load unchanged (SC-006).
- **Alternatives considered**: **Tailwind CSS v4** — does NOT work under `react-scripts` (CRA hardcodes the v3 PostCSS plugin, ignoring `@tailwindcss/postcss`; requires CRACO/eject — see tailwindcss issue #17231); v3 works but adds a scanning/utility layer with no benefit at this scale. **Plain BEM global CSS** — workable but relies on manual naming discipline across screens; CSS Modules give scoping for free.

## 2. Iconography

- **Decision**: **`lucide-react`** (dev-time + runtime dependency) with named imports from the package root. Status/UI icons used for the "not color alone" requirement (FR-004) and interface affordances.
- **Rationale**: lucide-react ships each icon as an isolated ESM module — the official guide states "Only the icons you import are included in your final bundle"; benchmarks show ~80–105 B per icon (gzip) and ~5 KB for 50 icons, so the assessment screen's bundle only grows by the handful of icons it actually imports (SC-006). Contrast: `react-icons` fails clean tree-shaking (~81 KB flat).
- **Alternatives considered**: inline SVGs (cheapest but hand-maintained for every icon/state); `react-icons` (heavy default entry).

## 3. Accessibility / visual-regression test tooling

- **Decision**: Add **`jest-axe`** as a dev dependency and assert WCAG/ARIA violations in component tests (Focusable, but keep coverage to representative components: status treatment, response scale, forms). **Do NOT use `@axe-core/react`** — its README states it does not support React 18+ (this app is React 19); it would be browser-time only, not test-time.
- **Rationale**: jest-axe (wrapping axe-core) is the standard for React component-test assertions; it is dev-only, executes under Jest+jsdom, and never enters the production bundle (no SC-006 impact).
- **Caveat**: jsdom cannot run color-contrast checks — contrast correctness must come from the deterministic token check (decision 4), not jest-axe.

## 4. Deterministic WCAG AA contrast verification (SC-003)

- **Decision**: A tiny zero-dependency Node script `frontend/scripts/check-contrast.js` run as `npm run check:contrast`. It parses the **shipped** `tokens.css`, resolves `:root` custom properties (including one-level `var()` references), computes contrast ratios with the WCAG 2.1 relative-luminance formula, and asserts every declared foreground/background pair from an explicit accessibility-pair manifest: **4.5:1 for normal text, 3:1 for large text/UI components**. Exits non-zero on any failure. `wcag-contrast` (zero-dependency, `hex('#000','#fff') → 21`) may be used for the ratio math.
- **Rationale**: Reading the real CSS (not a mirrored copy) means the test cannot drift from what ships; a declared pair manifest is the accessibility contract. `check:contrast` is fast and portable (no browser). Until this is implemented, pairing failures are caught at build-time, not by eye.
- **Alternatives considered**: axe/pa11y in a real browser (heavier, still needs a browser; jsdom variant can't compute contrast); manual inspection (SC-003 demands deterministic proof).

## 5. Status communication — never color alone (FR-004)

- **Decision**: A single `StatusMessage` treatment defined at the component level where **color + icon (lucide) + text label are all required** (component enforces presence of icon and label; rejects color-only usage). Distinct icon per status type, distinct wording, and a color token per type. This makes it impossible for a future change to introduce color-only status bits.
- **Rationale**: WCAG 1.4.1 ("color is not used as the *only* visual means") — pairing color with icon and explicit words also covers deuteranopia/protanopia (red/green alone fails) and serves screen readers (4.1.2). Status types from the spec: normal result, neutral held/under-review, validation error, session-limit notice, import success, import failure.
- **Alternatives considered**: color-only badges (fails 1.4.1); text-only (unscannable, weaker UI).

## 6. Loading & empty states (FR-007)

- **Decision**: **Skeleton states** for async content that mirror the final layout and reserve the exact width/height (zero layout shift when data lands); gate shimmer animation behind `prefers-reduced-motion`. Region being populated gets `aria-busy="true"`; a `role="status"` (`aria-live="polite"`) screen-reader-only message announces start/settle, debounced ~150 ms; skeleton blocks are `aria-hidden="true"`; the indicator is never focused. **Empty states**: icon + short message + optional next action occupying the same reserved space (no blank table bodies).
- **Rationale**: 4.1.3-documented pattern; skeletons beat spinners for async lists because they reserve space (adrianroselli.com/a11y-examples guidance). Required by FR-007 for the async screens (profile, attempt, scores, report, submissions list).
- **Alternatives considered**: spinners only (layout jump + no structural feedback).

## 7. Reduced motion & focus visibility (FR-003, US3 a11y)

- **Decision**: Define animations only inside `@media (prefers-reduced-motion: no-preference)`; under `reduce`, keep essential indicators (spinner, focus ring) but strip travel (crossfade/opacity instead of slide/scale). Focus: **never `outline: none` without a replacement**; drive a strong focus ring — ≥3 px, `:focus-visible`, with `outline-offset`, at ~3:1 contrast vs. adjacent colors — and never remove the focus indicator under reduced motion (WCAG 2.4.7).
- **Rationale**: 2.4.7/Understanding focus-visible guidance; a calm product still needs obvious, keyboard-visible focus. Reduced motion hides animation, never interaction affordances.
- **Alternatives considered**: removing animations entirely (aesthetic loss, still needs reduced-motion handling); unfocused `:focus`-only styling (over-triggering on mouse click).