# Design System Contract: Frontend Visual Design (003)

**Branch**: `003-frontend-visual-design` | **Revised**: 2026-09-19 | **Screens**: [screen-inventory.md](screen-inventory.md) | **Behaviour rules**: [spec 005](../../005-v3-1-canonical-alignment/spec.md)

This is the UI contract for feature 003. It defines the tokens, components, status treatments and layouts an implementer builds so every screen shares the Santulan visual language and passes WCAG 2.1 AA. **Revision 2026-09-19**: the earlier "calm & warm" cream/terracotta palette is replaced by the language of the 25 reference screens in `docs/Santulan 2.0/UI screen Samples/`.

**How values were obtained.** Colours marked *measured* were sampled from the reference PNGs (dominant pixel of the named region; PNG screenshots are 1536 × 1024). Values marked *candidate* are my extrapolation where the samples give no clean value (text inks, hover states, the serif/script font choice). All values are **candidates**: `frontend/scripts/check-contrast.js` is the authority, and any pair that fails AA at implementation time is adjusted in `tokens.css`, never by lowering the target. Where a measured value fails AA it is listed in §1.4 with its AA-safe replacement.

## 1. Design Tokens (`frontend/src/styles/tokens.css`, CSS custom properties on `:root`)

### 1.1 Palette

| Token | Value | Basis | Use |
|-------|-------|-------|-----|
| `--c-bg` | `#FAFAF8` | measured (route screen background) | page background |
| `--c-bg-white` | `#FFFFFF` | measured | header, cards, form fields |
| `--c-brand` | `#034281` | measured (`#034281`/`#044285`/`#023B85` across screens) | primary button, active nav text, links on tint |
| `--c-brand-strong` | `#022F63` | candidate | primary hover/active (13.2:1 on white) |
| `--c-brand-alt` | `#0B4988` | measured (institution button) | INSTITUTION route button |
| `--c-route-open` | `#145852` | measured (OPEN route button) | OPEN route button, success accents |
| `--c-link` | `#0A3F99` | measured (outlined-button label) | secondary/outlined button label, inline links |
| `--c-ink-strong` | `#0A1A47` | candidate (darkest heading pixels measured `#010A38`…`#092155`) | serif headings |
| `--c-ink` | `#1F2A4A` | candidate | body text |
| `--c-ink-muted` | `#4B587A` | candidate | secondary text (7.1:1 on white) |
| `--c-tint-blue` | `#EEF4FB` | measured (INSTITUTION card) | blue cards, info notes |
| `--c-tint-sky` | `#F0F7FE` | measured (info rail, vision card) | info / "why this matters" cards, hero bands |
| `--c-tint-green` | `#F0F9F3` | measured (OPEN card) | green cards, "your information is safe" |
| `--c-tint-mint` | `#F1F9F6` | measured | safe/success strips |
| `--c-tint-pink` | `#FBF2F5` | measured (wellbeing/interests) | pink cards |
| `--c-tint-lavender` | `#F4F3FE` | measured ("need help", support) | help / support cards |
| `--c-tint-cream` | `#FDF8F0` | measured (quote / note card) | quote and "a note for you" cards |
| `--c-selected` | `#E7F2FD` | measured (selected option row) | selected radio/checkbox rows and chips |
| `--c-nav-active` | `#E1EDF9` | measured (sidebar active pill) | active sidebar item |
| `--c-track` | `#D3E0F3` | measured (progress track) | progress track |
| `--c-progress` | `#106BD7` | measured (progress fill) | progress fill (3.8:1 on track — graphical object ≥ 3:1) |
| `--c-icon-blue` / `-green` / `-rose` / `-indigo` / `-amber` | `#0942A1` / `#088869` / `#DE161F` / `#0926D2` / `#F19A07` | measured (card icons) | **decorative icon fills only**; never the sole carrier of meaning (amber is 2.2:1 on white) |
| `--c-icon-disc-green` / `-teal` / `-sky` / `-mint` | `#DCF1E6` / `#C3EAE7` / `#CFE9F8` / `#C8ECD5` | measured (icon circles) | circle behind an icon |

### 1.2 Status colours (foreground text/icon on the matching tint)

| Token | Value | Tint background | Basis |
|-------|-------|-----------------|-------|
| `--c-status-success` | `#0B7A5E` (5.3:1 white / 4.9:1 on `--c-tint-green`) | `--c-tint-green` | measured `#088869`/`#10876F` darkened to pass AA |
| `--c-status-info` | `#0A3F99` | `--c-tint-sky` | measured link blue |
| `--c-status-warning` | `#8A5A00` (5.9:1 white / 5.6:1 on cream) | `--c-tint-cream` | candidate (sampled amber `#F19A07` fails as text) |
| `--c-status-error` | `#B42318` (6.6:1 white / 6.0:1 on pink) | `--c-tint-pink` | candidate (sampled crimson `#DE161F`/`#E2053B` are icon-only) |
| `--c-status-neutral` | `#61656B` (5.0:1 on `#ECEEEF`) | `#ECEEEF` | unsampled — kept from revision 1; used for held / under review / not enough data |

### 1.3 Typography

| Role | Sample evidence | Candidate token | Notes |
|------|-----------------|-----------------|-------|
| Display / headings | Bold transitional serif, navy (hero ≈ 60 px, page titles ≈ 40–46 px, card titles 22–28 px) | `--font-serif: "Source Serif 4", Georgia, "Times New Roman", serif` | Font choice to be confirmed against brand files; Georgia is the guaranteed fallback |
| Body / UI | Clean humanist sans (16–18 px body, 13–14 px helper) | `--font-sans: Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif` | Buttons and labels are sans; the *route* buttons on screen 03 use serif labels |
| Accent script | Handwritten taglines ("Same You. A Brighter Tomorrow.", "Different Journeys…") | `--font-script: "Caveat", "Segoe Script", cursive` | **Decorative only** (FR-015); hidden below 640 px |
| Eyebrow | Uppercase, wide-tracked 12–13 px ("OPEN ROUTE REGISTRATION", "GET STARTED") | `letter-spacing: .12em; text-transform: uppercase` | Colour per §1.4 |

```css
--fs-xs: 12px; --fs-sm: 14px; --fs-base: 16px; --fs-md: 18px;
--fs-lg: 24px; --fs-xl: 32px; --fs-2xl: clamp(32px, 4vw, 46px); --fs-hero: clamp(36px, 5vw, 60px);
--fw-regular: 400; --fw-medium: 500; --fw-semibold: 600; --fw-bold: 700;
--lh-tight: 1.15; --lh-normal: 1.5; --lh-relaxed: 1.6;
```

**Font budget (decision D-07, spec 005)**: self-hosted, subset, `font-display: swap`, preload only the serif bold; total web-font payload ≤ ~100 KB (candidate); system fallbacks keep layout stable. The **assessment item screen uses no script font and no photography** (FR-016).

### 1.4 Measured values that fail AA and their replacements

| Sampled | Where seen | Contrast | Use instead |
|---------|-----------|----------|-------------|
| `#338994` teal eyebrow | "OPEN ROUTE" label | 4.08:1 on white | `#1F6F7A` (5.8:1) or `--c-route-open` |
| `#2875B9` blue eyebrow | "INSTITUTION ROUTE" label | 4.84:1 (passes) | keep, verify on `--c-tint-blue` |
| `#088869` green text | success check labels | 4.43:1 on white | `--c-status-success` `#0B7A5E` |
| `#1A9872` green | icon | 3.63:1 | icon only (≥ 3:1, non-text) with adjacent text label |
| `#F19A07` amber | icon | 2.24:1 | icon only, never alone; text uses `--c-status-warning` |

### 1.5 Spacing, radius, shadow, motion

```css
--sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 24px; --sp-6: 32px; --sp-7: 48px; --sp-8: 64px;
--radius-sm: 8px;   /* inputs, buttons, chips */
--radius-md: 12px;  /* option rows, small cards */
--radius-lg: 16px;  /* cards */
--radius-xl: 20px;  /* floating registration card, hero bands */
--radius-pill: 999px; /* tags such as "Self-Consent", steps */
--shadow-1: 0 1px 2px rgba(10,26,71,.06);
--shadow-2: 0 8px 24px rgba(10,26,71,.08);   /* floating white card over photo */
--motion-fast: 150ms; --motion-base: 200ms; --ease: cubic-bezier(.25,.1,.25,1);
--focus-ring: 3px solid var(--c-brand); --focus-offset: 2px;
```

**Motion rule** (unchanged): transitions/animation only inside `@media (prefers-reduced-motion: no-preference)`; focus ring and spinner persist under reduced motion; the confetti/celebration on registration success and assessment-complete is static under reduced motion.

## 2. Core Components (`frontend/src/components/…`, one `*.module.css` per component)

Shared and fully styled (default / hover / `:focus-visible` / active / disabled). No native unstyled controls on any screen.

### 2.1 Existing (restyled to the new tokens; behaviour unchanged — FR-009)

| Component | Contract in the Santulan language |
|-----------|-----------------------------------|
| `Button` | `variant`: **primary** (filled `--c-brand`, white label, 8 px radius, 48–56 px tall, trailing arrow icon), **secondary** (white, 1 px `--c-brand` border, `--c-link` label), **route-open** (filled `--c-route-open`), **route-institution** (filled `--c-brand-alt`), **quiet-link**. Disabled keeps label contrast and shows why (helper text), never colour alone |
| `Card` | white, `--radius-lg`, `--shadow-1`; `tone` prop selects a tint (`blue`, `sky`, `green`, `mint`, `pink`, `lavender`, `cream`) with an icon disc |
| `Field` | label above, 44–48 px input with leading icon, 8 px radius, helper text below; error text pairs with `StatusMessage` |
| `ResponseScale` | 1–5 chips ≥ 48 px, `--c-selected` fill + tick when chosen; **no right/wrong visual ever** (FR-005) |
| `ProgressSummary` | linear track (`--c-track`) + fill (`--c-progress`), label "n of N", "Section n of 7", "Session n of 4", last-saved time; `role="progressbar"` |
| `StatusMessage`, `FlagBadge`, `Skeleton`, `EmptyState`, `ScoreCard` | As in revision 1, recoloured with §1.2 |
| Admin: `AdminLayout`, `StatTile`, `Panel`, `StatusPill`, `BarChart`, `Modal`, `Toast`, `PageHeader`, `FileDropzone` | Same tokens, information-dense; the dark warm navigation from the earlier dashboard is replaced by a navy/white treatment (no admin reference screen exists — needs an approved design record) |

### 2.2 New (from the reference screens)

| Component | Seen on | Contract | A11y / notes |
|-----------|---------|----------|--------------|
| `BrandMark` | all | lotus icon + wordmark "SANTULAN" + "UNDERSTAND · GROW · THRIVE" | link to Home; accessible name "Santulan home" |
| `PublicHeader` | 01–09 | logo, centre nav (Home, About, For Institutions, Support; current item underlined), language select, primary button (*Get Started* / *Register* / *My Account*) | landmark `banner`; collapses to a menu < 900 px |
| `PublicFooter` | 01–09, 11–26 | wordmark + tagline, Privacy \| Terms \| Safeguarding \| Contact, social icons, copyright | landmark `contentinfo`; link only to existing pages |
| `SplitHero` | 04–09 | full-height photo panel (left: eyebrow, serif H1, paragraph, three icon-disc reassurance rows, script tagline) + floating white card (right) | photo is decorative (`alt=""`); text over photo needs a scrim so it stays ≥ 4.5:1; stacks below 900 px with the card first |
| `StepIndicator` | 04–08, 11–15 | five dots joined by a line; complete = green dot + tick, current = filled navy, upcoming = hollow; caption "Step n of 5" | `aria-label="Step 2 of 5"`, not colour-only (tick + caption) |
| `OtpInput` | 05 | six single-digit boxes, auto-advance, paste-fill, backspace-back; resend countdown "Resend in 00:28"; "Change email address" secondary | one labelled group; each box `aria-label="Digit n of 6"`; `autocomplete="one-time-code"` |
| `SelectableCard` | 03, 07 | radio-style card with icon disc, title, description and a pill tag ("Self-Consent", "Assent + Parent/Guardian Consent"); selected = `--c-selected` fill + filled radio | `role="radiogroup"`; selection is also announced |
| `ChipCheckbox` | 13–15, 21 (reference only) | icon + label chip with checkbox; selected = tint + tick | retained for a future approved questionnaire |
| `CopyField` | 08 | read-only field with a *Copy* button and helper "You will need this ID to log in" | copies exact text; announces "Copied"; ID is never masked |
| `AppShell` (`Sidebar`, `TopBar`, `Breadcrumb`) | 10–22, 24–26 | 280 px sidebar (icon + label, active = `--c-nav-active` pill + navy text), 78 px top bar (logo, user menu; notification bell only when notifications exist), breadcrumb line, handwritten tagline + leaf art at sidebar foot | `nav` landmark, `aria-current="page"`; the tagline art is `aria-hidden` |
| `RailCard` | 11–19, 22, 24–26 | right-rail card: icon disc + serif title + text (+ link); tones `info` (sky), `safe` (green/mint), `help` (lavender) | "Need help?" always links to the approved Support page |
| `Tabs` | 20–22, 24 | text tabs, active = navy + 2 px underline | `role="tablist"`; arrow-key navigation |
| `Toggle` | 22, 24 | 44 × 24 switch with visible "On"/"Off" text | `role="switch"`; label text carries state |
| `StageStepper` | 17 | four stages (Responses submitted → Analysing your responses → Creating personalised insights → Finalising your report), tick / ring / hollow | mirrors real pipeline state (FR-017); `aria-live="polite"` |
| `ProgressRing` | 20 | circular percentage | reference only — not built (no canonical completion metric) |
| `ResourceCard` | 18, 25, 26 | image, type tag (Article / Video / Guide), title, blurb, read-time | **deferred** — no canonical content source |
| `LanguageSelect` | header | compact select showing available locales only | `en` only at launch |

## 3. Status Treatment Map (FR-004 — the contract)

Every status is **colour + icon (lucide) + label**, defined once; components consume this map.

| Status | Icon | Label (participant / admin) | Tokens |
|--------|------|-----------------------------|--------|
| Normal result / completed | `CircleCheck` | "Completed" | success |
| Held / under review (T11) | `Clock` | "Your responses are being reviewed." / "Held" | neutral — reads as guidance, never error; **identical for every hold reason** |
| Not eligible (T12) | `CircleSlash` | "This attempt could not be processed for a report." | neutral |
| Not enough data / research-only domain | `CircleSlash` | "Not enough data" (final S0/S1/SH copy pending, decision D-04) | neutral |
| Consent pending verification | `Clock` | "Waiting for consent to be verified" | info |
| Session limit | `TriangleAlert` | "Session limit reached" + calm recovery copy (text pending owner approval) | warning |
| Validation error | `CircleAlert` | field + guidance (e.g. "Enter a valid email") | error |
| Code expired / wrong | `CircleAlert` | "That code didn't match. Try again or resend." | error |
| Import success / failure | `CircleCheck` / `CircleAlert` | "Import complete" / "Import failed" + scannable row list | success / error |
| Report generating | `Loader` (static under reduced motion) | "Analysing your responses…" | info |
| Report preparing again (FAILED_RETRYABLE) | `Clock` | "Still preparing your report" | neutral |
| Flag needs review / reviewed | `ShieldAlert` / `ShieldCheck` | "Needs review" / "Reviewed" (admin only) | warning / success |
| Participation open / paused / stopped | `CircleCheck` / `PauseCircle` / `CircleSlash` | "Open" / "Paused" / "Stopped" | success / warning / error |

Pairs pass AA on their tinted backgrounds (verified in the `check:contrast` manifest); every status has a text label (4.1.2).

## 4. Layout Rules (FR-006)

- **Public pages** (`PublicHeader` + content + `PublicFooter`): max content width ~1240 px; hero panels are full-bleed; header height ~80 px.
- **Registration / sign-in** (`SplitHero`): left panel ≈ 50 %, card ≈ 600–660 px wide, vertically centred over the photograph; below 900 px the photo becomes a short banner and the card fills the width.
- **Signed-in shell** (`AppShell`): sidebar 280 px, content fluid to ~1080 px with a **right rail ≈ 390 px**; below 1024 px the sidebar becomes a top-bar menu and the rail flows under the content; below 640 px single column with `--sp-4` gutters.
- **Assessment item screen (no reference sample)**: participant column ≤ ~680 px, `ProgressSummary` on top, one item at a time or one domain block per screen, no photography, no script text, response chips ≥ 48 px.
- **No horizontal scroll at 320 px**: fluid text/cards, `overflow-wrap: anywhere`, responsive headings via `clamp()`, touch targets ≥ 48 px, inputs `width: 100%`.
- Global reset (`reset.css`) before tokens; `tokens.css` imported once in `index.js`.

## 5. Contrast manifest (must pass in `check:contrast`)

White on `--c-brand` (10.0), white on `--c-brand-alt` (9.0), white on `--c-route-open` (8.2), `--c-link` on white (9.6), `--c-brand` on `--c-selected` (8.8) and `--c-nav-active` (8.4), `--c-ink-strong` and `--c-ink` on `--c-bg`, white and every `--c-tint-*`, `--c-ink-muted` on white and on `--c-tint-lavender` (6.4), every §1.2 status pair on its tint, eyebrow colours on white and on their card tint, and text over any photographic panel with its scrim. Non-text UI (progress fill on track 3.8, focus ring, toggle, step dots) ≥ 3:1.
