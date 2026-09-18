# Design System Contract: Frontend Visual Design (003)

**Branch**: `003-frontend-visual-design` | **Date**: 2026-09-18 | **Data Model**: [../data-model.md](../data-model.md) | **Research**: [../research.md](../research.md)

This is the UI contract for the 003 feature, per the "UI contracts for applications" case. It defines the concrete tokens, components, and status treatments an implementer must build so every screen shares one visual language and passes WCAG AA (SC-001/003/004). Values below are **candidate defaults**; the `check:contrast` script (research §4) is the authority — any pair that fails AA at implementation time must be adjusted in `tokens.css`, never by lowering the target.

## 1. Design Tokens (`frontend/src/styles/tokens.css`, CSS custom properties on `:root`)

### Palette (calm & warm) — every token carries an explicit AA pair in `check:contrast`'s pair manifest

| Token | Value (candidate) | Intended use |
|-------|-------------------|--------------|
| `--c-bg`          | `#FAF6EE` | page background (cream) |
| `--c-surface`     | `#F1EADB` | raised cards/surfaces |
| `--c-surface-strong` | `#E7DECC` | pressed/nested surfaces |
| `--c-bg-white`    | `#FFFFFF` | form fields on surfaces |
| `--c-ink`         | `#332F28` | primary text (on `--c-bg`, `--c-surface`, `--c-bg-white`) |
| `--c-ink-muted`   | `#5C574B` | secondary text — MUST pass 4.5:1 on its used backgrounds |
| `--c-ink-faint`   | `#7A7466` | tertiary text — MUST pass 4.5:1 on its used backgrounds or not be used for text |
| `--c-brand`       | `#8C5A3C` | primary actions, focus rings (warm terracotta-brown) |
| `--c-brand-strong` | `#6F4630` | hover/active of brand, considered-large-text-safe |
| `--c-brand-soft`  | `#EFE1D2` | brand tint fills / selected response chip bg |
| `--c-status-info`     | `#3B5B68` | info / waiting (deep slate-blue) |
| `--c-status-success`  | `#3F6B4F` | import succeeded, available (deep warm green) |
| `--c-status-warning`  | `#8A6B2F` | session limit, under review (deep amber) |
| `--c-status-error`    | `#A3483A` | validation error, import failure (deep muted red) |
| `--c-status-neutral`  | `#61656B` | held / insufficient data (slate) |
| `--c-status-soft-*`   | light tints of each status (`#E9EEF0` info, `#E6EFE9` success, `#F5EFE3` warning, `#F7E7E4` error, `#ECEEEF` neutral) | status backgrounds |

**Rules**: text-on-filled-status colors goes on `--c-bg-white` or `--c-ink` only; status chips use `--c-status-soft-*` background + `--c-status-*` foreground text (tint pairs are declared in the contrast manifest too). Never pair two reds/greens as the only discriminator (research §5).

### Typography (system-only — no font downloads, SC-006)

```css
--font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
--fs-xs: 12px; --fs-sm: 14px; --fs-base: 16px; --fs-md: 18px;
--fs-lg: 24px; --fs-xl: 30px; --fs-2xl: 40px;
--fw-regular: 400; --fw-semibold: 600; --fw-bold: 700;
--lh-tight: 1.25; --lh-normal: 1.5; --lh-relaxed: 1.6;
```

Base body: 16px/`--lh-relaxed` normal-text ink on `--c-bg` (AA ≥ 4.5:1).

### Spacing, radius, shadow, motion

```css
--sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 24px; --sp-6: 32px; --sp-7: 48px;
--radius-sm: 8px; --radius-md: 12px; --radius-lg: 16px; /* rounded = warm, not pill-everywhere */
--shadow-1: 0 1px 2px rgba(51,47,40,.08);
--shadow-2: 0 4px 12px rgba(51,47,40,.10);
--motion-fast: 150ms; --motion-base: 200ms; --ease: cubic-bezier(.25,.1,.25,1);
--focus-ring: 3px solid var(--c-brand); --focus-offset: 2px;
```

**Motion rule**: transitions/animation defined ONLY inside `@media (prefers-reduced-motion: no-preference)` (research §7). Focus ring and spinner persist under reduced motion; travel (slide/scale) is replaced with crossfade.

## 2. Core Components (`frontend/src/components/…`, one `*.module.css` per component)

Shared, reusable, fully styled (default/hover/focus-visible/active/disabled). No native unstyled form controls on any screen.

| Component | Contract | States / notes |
|-----------|----------|----------------|
| `Button` (`Button.jsx`) | `variant: primary / secondary(ghost) / quiet-link`; `tone: brand / status(per type)` | `:hover` darken, `:focus-visible` ring (`--focus-ring`+offset), `:active` press, `disabled` (reduce opacity + `cursor: not-allowed` but keep label contrast); `aria-disabled`/`disabled` correct |
| `Card` (`Card.jsx`) | surface, `radius-lg`, `shadow-2`, padding `--sp-5` | sections/grouping for results, status cards, form stages |
| `Field` (`Field.jsx`) | label + input/select/textarea with visible focus-visible ring; error text pairs with `StatusMessage` | `aria-invalid` + `aria-describedby`; validation message styled as `StatusMessage` (never raw red text block alone) |
| `ResponseScale` (`ResponseScale.jsx`) | the 1–5 Likert row | 5 options as tappable chips (`≥48px` min height, `--c-brand-soft` selected); **NO right/wrong visual ever** (no green check / red cross on options — FR-005); keyboard support (radio-like arrow keys) |
| `ProgressSummary` (`ProgressSummary.jsx`) | answered/total + current domain + "session N of 4" | graphical bar (width = ratio) + icons + label; not color-only (bar width conveys progress); `role="progressbar"` + `aria-valuenow/max/min`, sr-only text |
| `StatusMessage` (`StatusMessage.jsx`) | `type: neutral / success / warning / error / info` | **color + icon + label all required** (research §5, FR-004); renders `<div role="alert">` for error/warning, `role="status"` otherwise; supports the session-limit recovery, validation errors, import outcomes, held/neutral messages |
| `FlagBadge` (`FlagBadge.jsx`) | quality flag chips (Q01–Q09, needs-review vs. dispositioned) | icon + code + label; review vs. dispositioned visually distinct (icon/label), never color alone |
| `Skeleton` (`Skeleton.jsx`) | async loading blocks | mirrors final layout + reserves exact size (zero shift); parent region `aria-busy="true"`, blocks `aria-hidden="true"`, `role="status"` sr-only message debounced ~150 ms; shimmer only under no-preference motion |
| `EmptyState` (`EmptyState.jsx`) | icon + short message + optional action | used for admin submissions with no data, no flags on a submission, etc.; occupies reserved space |
| `ScoreCard` (`ScoreCard.jsx`) | one domain result (participant) | title/domain, big readable score, completeness chip; normal vs. neutral (held/under-review/insufficient) clearly distinct wording+icon+color; not a raw table (US1 scenario 3) |

## 3. Status Treatment Map (FR-004 — the contract)

Every status is **color + icon (lucide) + label**, defined here once; components consume this map. Icons: success `CircleCheck`, info `Info`, warning `TriangleAlert`, error `CircleAlert`, neutral `Clock` / `CircleSlash`, review `ShieldAlert`, import `UploadCloud` / failure `FileX`, empty `Inbox`.

| Status type | Icon | Label wording (participant/admin) | Tokens |
|-------------|------|-----------------------------------|--------|
| Normal result | `CircleCheck` | e.g. "Completed" | success (soft bg + success fg) |
| Held / under review | `Clock` | "Under review" (participant) / "Held" (admin) | neutral (never error-styled — reads as guidance, US1 scenario 3) |
| Insufficient data | `CircleSlash` | "Not enough data" | neutral |
| Session limit | `TriangleAlert` | "Session limit reached" + calm guidance copy | warning |
| Validation error | `CircleAlert` | field + guidance (e.g. "Select one option") | error |
| Import success | `CircleCheck` | "Import complete — N items live" | success |
| Import failure | `CircleAlert` | "Import failed" + scannable row list | error |
| Flag needs review | `ShieldAlert` | "Needs review" (admin) | warning |
| Flag dispositioned | `ShieldCheck` | "Reviewed" (admin) | success |
| Participation paused/stopped | `PauseCircle` / `CircleSlash` | "Paused" / "Stopped" | warning / error |
| Participation open | `CircleCheck` | "Open" | success |

Accessibility: pairs always pass AA on their tinted chip backgrounds (verified in `check:contrast` manifest); every status has text label (4.1.2) + icon; behavior unchanged (FR-009).

## 4. Layout Rules (FR-006)

- Content column ≤ ~680px for participant flow; fluid with `min(100% - 2*--sp-5, 680px)`; admin max ~1200px grid.
- Breakpoints: mobile < 640px (single column, `--sp-4` gutters), tablet 640–1024 (two-col where dense), desktop > 1024.
- **No horizontal scroll at 320px**: fluid text/cards, `overflow-wrap: anywhere` for long item text, responsive type via `clamp()` for headings, touch targets ≥ 48px, inputs `width: 100%` (`box-sizing: border-box` via reset).
- Global reset file `frontend/src/styles/reset.css` before tokens (margin/padding/box-sizing/base font).