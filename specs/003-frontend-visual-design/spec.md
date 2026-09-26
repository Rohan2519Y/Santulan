# Feature Specification: Frontend Visual Design

**Feature Branch**: `003-frontend-visual-design`

**Created**: 2026-09-18

**Status**: Draft — **revised 2026-09-19** against the Santulan 2.0 UI reference screens (requirements and contracts updated; `plan.md`, `research.md`, `data-model.md`, `quickstart.md` and `tasks.md` predated the revision and were removed rather than regenerated — they described the earlier calm/warm restyle, not this revision, and nothing since has needed them)

**Input**: User description: "i want to add the good visuals for the frontend". *Revision (2026-09-19)*: "read the specs and update it according to docs/santulan … there is the frontend design also … only edit or make the specs."

## Scope revision (2026-09-19)

The original spec restyled the existing 002 screens with a "calm and warm" cream/terracotta palette and no new screens. The product owner has since supplied **25 reference screens** in `docs/Santulan 2.0/UI screen Samples/` (`screen 01.png`, `02.png`–`22.png`, `24.png`–`26.png`; there is no `23`) plus the SanTulan 2.0 build contracts (see [005-v3-1-canonical-alignment](../005-v3-1-canonical-alignment/spec.md)). Those screens define a different visual identity and add participant-facing surfaces the original spec ruled out. Anything not listed below is unchanged.

| Original | Now |
|----------|-----|
| FR-001 palette "calm and warm" (cream `#FAF6EE`, terracotta `#8C5A3C`) | **Santulan navy design language** measured from the samples: near-white page, navy call-to-action `#034281`, green route accent `#145852`, pale tinted cards (blue / green / pink / lavender / warm cream), serif display headings, handwritten accent taglines, lotus brand mark. Tokens in [contracts/design-system.md](contracts/design-system.md) |
| FR-009 / Assumption 1 "no new screens, no functional change" | Still true for the existing login, assessment, results and admin screens. **New screens are now in scope** (public site, route choice, 5-step OPEN registration, institutional sign-in, participant dashboard, assessment hub/complete/generating states, profile & privacy). Their behaviour comes from spec 005, not from this spec |
| Assumption "no brand assets exist" | Brand assets exist in the samples (lotus logo, wordmark "SANTULAN — UNDERSTAND · GROW · THRIVE", handwritten taglines). Production files still need to be supplied/approved |
| Assumption "illustration generic, not photographic" | The samples use photography and illustrations; production imagery must be licensed/approved and lazy-loaded so the assessment screen's first render is unaffected (SC-006 stands) |
| "System font stack only — no font downloads" (design-system §1) | The samples use a serif display face, a sans body face and a handwritten script. Self-hosted subset fonts are allowed **within a load-time budget**, with system fallbacks (spec 005 D-07) |
| Student and admin dashboards were not specified | Both are specified in [contracts/dashboards.md](contracts/dashboards.md) (student: from screen 10; admin: from BUILD 08 and the existing pages — no sample screen exists) |
| Screen inventory of 6 existing screens | [contracts/screen-inventory.md](contracts/screen-inventory.md) now maps all 25 samples plus the screens that have **no** sample (item player, resume, report/radar, T11/T12, growth plan, admin) |

**Where a sample conflicts with a canonical contract, the contract wins** and the screen is reconciled in the inventory (e.g. date-of-birth entry → integer age; semantic-looking Santulan ID → opaque ID; name/photo profile → canonical profile only; four-section "Initial Assessment" questionnaire → layout reference only; prescriptive "Next Steps" → hidden while the release flag is off).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Participant sees a polished, calming assessment experience (Priority: P1)

A participant (age 13-25) logs in and moves through profile declaration, consent, the 7-domain assessment, pause/resume, and their results. Today these screens are functional but visually plain (unstyled form fields, no imagery, no visual progress feedback). They should instead feel like a considered, trustworthy, age-appropriate product: calm color palette, clear typography, visible progress through the assessment, and a results view that presents domain outcomes and messages (including the neutral hold/eligibility messages) in a supportive, non-clinical way that never implies "right" or "wrong" answers.

**Why this priority**: This is the highest-traffic surface (every participant, every session) and the one where visual quality most directly affects trust, completion rates, and how a sensitive self-report instrument is perceived by a young audience.

**Independent Test**: Load the participant flow end-to-end (login → profile → consent → assessment questions → pause/resume → submit → results) on both a phone-width and desktop-width screen; every screen uses the shared visual design (palette, type, spacing, components) with no unstyled default browser form elements, and progress/status is visually clear at every step.

**Acceptance Scenarios**:

1. **Given** a participant on a mobile-width screen, **When** they open any screen in the assessment flow, **Then** the layout reflows without horizontal scrolling, text is legible without zooming, and touch targets (answer options, buttons) are comfortably tappable.
2. **Given** a participant partway through the assessment, **When** they view the question screen, **Then** they can see how many questions are answered vs. remaining and which of the 7 domain sections they are in, through visual indicators (not just text counts).
3. **Given** a participant reaches their results, **When** the results render, **Then** each domain result is visually distinguished (e.g., by domain), scores/completeness are shown with a simple visual treatment (not a raw table), and a held/neutral message (hold, insufficient data, under review) is styled distinctly from a normal result so it doesn't read as an error.
4. **Given** a participant hits a session limit or a validation error, **When** the message is shown, **Then** it is styled as calm guidance (icon/color/tone consistent with the rest of the app), not a raw browser alert or unstyled red text block.

---

### User Story 2 - Admin sees a clear, efficient operational visual design (Priority: P2)

An admin uploads item pools, controls participation, and reviews submissions and quality flags. Today these are plain forms and an unstyled HTML table. They should instead have a clean, dashboard-like visual treatment that makes status (active version, participation state, per-submission scores and flags) scannable at a glance, distinct in tone from the participant-facing experience (more information-dense, efficiency-oriented) while still using the same underlying visual language (palette, type, components).

**Why this priority**: Lower traffic than the participant flow, but visual clarity here directly affects how quickly admins can spot problems (e.g., a Q09 safeguarding flag, a failed import) - a real operational cost if missed, so it ranks above general polish but below the participant-facing MVP.

**Independent Test**: Load the admin import screen and the submissions list/detail screen; import success/failure, participation state, and per-submission score/flag status are each visually distinguishable at a glance without reading dense text, and the two admin sub-views (import/control vs. submissions) are clearly wayfound.

**Acceptance Scenarios**:

1. **Given** an admin on the import screen, **When** an import succeeds or fails, **Then** the outcome is shown with a distinct visual treatment (not identical-looking text blocks) and validation errors are presented as a scannable, styled list rather than a raw dump.
2. **Given** an admin on the submissions list, **When** they view many rows, **Then** status, session count, and quality-flag presence are visually scannable (e.g., through consistent visual treatment of state) rather than requiring the admin to read every cell.
3. **Given** an admin opens a submission's detail view, **When** it renders, **Then** domain scores and quality flags are visually grouped and distinguished from each other, and a flag needing review is visually distinct from one already dispositioned.

---

### User Story 3 - The whole app reads as one consistent, accessible product (Priority: P3)

Whether a person is on the login screen, deep in the assessment, viewing results, or (as an admin) reviewing submissions, the app should look like a single considered product: one color palette, one type scale, consistent spacing and component styling, and readable contrast for all text and interactive states (default, hover/focus, disabled, error). No screen should look visually orphaned from the rest.

**Why this priority**: This is a cross-cutting consistency and accessibility pass that depends on User Stories 1 and 2 existing first; it's what turns "some styled screens" into a cohesive product, but it's not independently valuable without them.

**Independent Test**: Navigate every screen in the app (participant and admin) in one sitting; the same palette, type scale, spacing rhythm, and component styles (buttons, inputs, cards, status messages) recur throughout, and every text/background combination and interactive state passes a standard accessible-contrast check.

**Acceptance Scenarios**:

1. **Given** any two screens in the app, **When** compared side by side, **Then** they share the same color palette, typography, spacing scale, and component styling (buttons, form fields, status/alert treatments) rather than each screen inventing its own.
2. **Given** any interactive element (button, input, link), **When** it is focused via keyboard or hovered, **Then** it shows a visible, styled state distinct from its resting state.
3. **Given** any text on any background used in the app, **When** checked against standard accessibility contrast guidelines, **Then** it passes at the standard (AA) level.

---

### User Story 4 - A visitor finds Santulan, chooses a route and registers (Priority: P1) — new (2026-09-19)

A visitor lands on the public site (home, about), chooses **Register as an Individual** (OPEN route) or **Join Through Your Institution**, and completes a five-step registration — email or mobile, 6-digit code, age, consent, and a success screen showing their Santulan ID — or signs in to the institutional login with a Santulan ID and (temporary) password. Each step uses the split layout from the samples: an inspirational left panel (heading, three reassurance points, handwritten tagline over a photograph) and a floating white card with a step indicator, primary navy button, secondary outlined button, and a privacy/security note.

**Why this priority**: It is the first thing every participant sees and the only place the design must carry consent, age and privacy messaging for minors correctly.

**Independent Test**: Walk screens `screen 01`–`09` on a phone and a desktop; each renders in the Santulan design system, the step indicator matches the step, and the behaviour rules of spec 005 US2/US3/US4/US10 hold (integer age, derived consent, no eligibility claim, opaque ID).

**Acceptance Scenarios**:

1. **Given** a visitor on the route-choice screen, **When** it renders, **Then** the two route cards (green OPEN, blue INSTITUTION) each show an icon, eyebrow label, title, description, three ticked points and a primary button, and a help strip below offers guidance and support.
2. **Given** a participant in the OPEN wizard, **When** they move between steps, **Then** the indicator shows "Step n of 5", completed steps show a tick, Back is available from step 2, and errors (invalid email, wrong code, ineligible age) appear as calm, labelled status messages.
3. **Given** the verification step, **When** the code is shown, **Then** six separate digit boxes, a resend countdown and the 10-minute expiry note are visible and operable by keyboard and screen reader.
4. **Given** the success step, **When** the Santulan ID appears, **Then** it has a Copy action, the screen states what happens next, and for a minor it states that consent is still awaiting verification.
5. **Given** the institutional sign-in, **When** it renders, **Then** it offers Santulan ID + password, "Forgot your password?", "Login with Temporary Password", a "First time here?" note and a link back to individual registration.

---

### User Story 5 - A signed-in participant uses a consistent app shell (Priority: P2) — new (2026-09-19)

After sign-in the participant sees a left-sidebar shell (Home, My Profile, Assessment, plus Resources/Wellbeing/Support/Settings only where spec 005 allows them), a top bar with the logo and user menu, breadcrumbs, a right rail of guidance cards (why this matters / your information is safe / need help) and the shared footer. The dashboard, assessment status, generating-report, report/terminal states, profile settings and privacy pages all use it.

**Independent Test**: Sign in as a participant at each lifecycle state (consent pending, ready, in progress, submitted, generating, REPORT_READY, QUALITY_HOLD, INVALID) and confirm the dashboard, timeline and CTA reflect the real state.

**Acceptance Scenarios**:

1. **Given** a participant with a closed consent gate, **When** the dashboard renders, **Then** the assessment CTA is disabled and explains what is missing, without alarming language.
2. **Given** an attempt in progress, **When** they open Assessment, **Then** they see progress, "session n of 4", last-saved time and one **Continue Assessment** action.
3. **Given** a submitted attempt, **When** the report is generating, **Then** the four-stage indicator mirrors the real pipeline state; a QUALITY_HOLD shows the neutral T11 message; a FAILED_RETRYABLE report shows a calm "still preparing" message.
4. **Given** the profile pages, **When** they render, **Then** only canonical participant data is shown, and Privacy & Data lists each consent record with a **Withdraw** action.
5. **Given** any page, **When** navigation would lead to content that does not exist (Resources, Wellbeing, mentor), **Then** the item is not shown.

---

### Edge Cases

- What happens on a very small screen (e.g., older/budget phone, ~320px wide) where item text is long? Layout must still avoid horizontal scroll or clipped/overlapping text.
- What happens when a participant is color-blind? Status/severity (e.g., held result, quality flag) must not be conveyed by color alone - pair color with icon, label, or pattern.
- What happens when content is still loading (profile, attempt, scores, report, submissions list)? Each async view needs a visual loading state, not a blank screen or layout jump once data arrives.
- What happens when a list is empty (e.g., admin submissions list before anyone has submitted, no quality flags on a submission)? An empty state should be shown, not a blank table body.
- What happens on a slow connection? Visual assets added for this feature must not materially slow down first render of the assessment-taking screen, since participants may be on school/mobile networks.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST present a single, consistent visual design (color palette, typography, spacing, and component styling) applied across every screen — the existing login, participant assessment/results and admin screens **and** the new public, registration, dashboard and profile screens. The style direction is the **Santulan design language** in `docs/Santulan 2.0/UI screen Samples/`: bright, airy and reassuring — near-white surfaces, navy primary actions, soft pastel tinted cards, generous rounding, serif headings, a warm handwritten accent used only decoratively, and the lotus brand mark. It MUST NOT read as clinical/corporate or as bright/gamified, and it MUST keep the existing "no right or wrong answers" requirement (FR-005). *(Revised 2026-09-19; supersedes the earlier "calm and warm" cream/terracotta direction.)*
- **FR-002**: The system MUST visually communicate assessment progress to a participant (questions answered vs. total, and current domain/session) through graphical indicators, not text counts alone.
- **FR-003**: The system MUST style all interactive elements (buttons, inputs, links, the 1-5 response scale) with clear, consistent default, hover/focus, active, and disabled visual states, and MUST NOT rely on unstyled native browser form controls or alerts.
- **FR-004**: The system MUST visually distinguish different message/status types (a normal result, a neutral held/under-review message, a validation error, a session-limit notice, an import success, an import failure) from one another using a consistent, limited set of status treatments (e.g., consistent color+icon pairing per status type), and MUST NOT convey any status by color alone.
- **FR-005**: The system MUST preserve the existing requirement that no visual element implies a "right" or "wrong" answer on assessment items (e.g., no green checkmark / red cross styling on response options).
- **FR-006**: The system MUST remain fully usable and legible at common mobile widths (down to 320px) as well as tablet and desktop widths, without horizontal scrolling or clipped content.
- **FR-007**: The system MUST show a distinct visual loading state for every screen that fetches data before that data is available, and a distinct visual empty state for every list that can legitimately be empty.
- **FR-008**: All text/background color combinations used MUST meet WCAG 2.1 AA contrast guidelines.
- **FR-009**: The visual design applied to the **existing** screens MUST NOT change functional behavior, validation rules or data shown (presentation-layer only, on top of 002). New screens introduced by the 2026-09-19 revision (FR-010–FR-018) take their behaviour from spec 005.
- **FR-010**: The system MUST provide the public site shell: header (logo, Home / About / For Institutions / Support, language selector, primary button that reads *Get Started* when signed out, *Register* on registration screens and *My Account* when signed in) and footer (wordmark, Privacy | Terms | Safeguarding | Contact, social links, copyright). Only pages that exist may be linked; the language selector lists only available locales (`en` at launch).
- **FR-011**: The system MUST provide the split registration layout — full-height photographic panel with heading, three reassurance points and a handwritten tagline on the left, a floating white card on the right with a back link, a five-dot step indicator ("Step n of 5", completed = tick), a heading, one primary and one optional secondary button, an "OR" divider and a privacy/security note — reused for the OPEN steps (create account, verify code, age, consent, success) and the institutional sign-in.
- **FR-012**: The system MUST provide the signed-in shell: left sidebar with icon + label items and a highlighted active item, top bar (logo, notification affordance only when notifications exist, user menu), breadcrumb, page title with a one-line description, content, and a right rail of up to three guidance cards (info-blue, safe-green, help-lavender). Below 1024 px the sidebar collapses to a menu and the rail moves below the content.
- **FR-013**: The system MUST provide the interaction patterns seen in the samples as reusable components: selectable cards (radio-style, with tint on selection), checkbox chips with icons, dropdown, textarea with character counter, toggle, tabs, six-box code entry with resend countdown, copyable ID field, circular/linear progress, stage stepper, article/resource card, and info/safe/help note cards.
- **FR-014**: The system MUST NOT convey required state (selected, completed, current, disabled, error) by colour alone; every one of those states pairs colour with a tick, icon, label or shape change.
- **FR-015**: Handwritten/script text MUST be decorative only: it is `aria-hidden` or duplicated in accessible text, never carries required information, and is hidden below 640 px where it would overlap content.
- **FR-016**: Photographs and illustrations MUST be lazy-loaded (except the above-the-fold hero on public pages), sized to reserve space, provided with meaningful `alt` text (decorative images empty `alt`), and MUST NOT appear on the assessment item screen.
- **FR-017**: Every progress, stage or percentage display MUST reflect real system state (attempt progress, pipeline stage); simulated timers or invented percentages are prohibited.
- **FR-018**: Copy on public and participant screens MUST NOT claim validation, clinical or diagnostic use, and MUST NOT show subdomain scores, Low/Average/High bands, percentiles or improvement claims; sample strings in the reference screens are placeholders pending content-owner approval.

### Key Entities

*(No new data entities - this feature restyles the presentation of existing screens and data from the 002-capability-assessment feature; no data model changes.)*

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of existing participant- and admin-facing screens use the shared visual design (palette, typography, components) rather than unstyled default browser elements.
- **SC-002**: Every screen renders correctly with no horizontal scrolling or overlapping/clipped content at a 320px-wide viewport, a common tablet width, and a common desktop width.
- **SC-003**: Every text/background color pairing in the app passes WCAG 2.1 AA contrast checks (4.5:1 for normal text, 3:1 for large text/UI components).
- **SC-004**: In an informal read-through by someone unfamiliar with the build, all screens are judged to belong to "the same app" (consistent palette/type/components) with no screen flagged as visually inconsistent.
- **SC-005**: Participants can identify their progress (answered/total, current section) and their result status (normal vs. held/neutral) correctly from the visual treatment alone, without reading detailed text, in a walkthrough with a handful of test users.
- **SC-006**: Adding the visual design does not increase the assessment question screen's initial load time by more than a fraction of a second on a throttled mobile connection.
- **SC-007** *(added 2026-09-19)*: Every one of the 25 reference screens has a rendering (or a documented reason it is not built — gated, reference-only or deferred) in [contracts/screen-inventory.md](contracts/screen-inventory.md), and a side-by-side review at phone, tablet and desktop widths finds no unapproved palette, typography or layout deviation.
- **SC-008** *(added 2026-09-19)*: A scan of all screens finds 0 uses of a date-of-birth field, a participant name/photo profile, a semantic Santulan ID format, a simulated progress value, or a prohibited claim.

## Assumptions

- The original restyle applies to the frontend built in `002-capability-assessment` (login, participant assessment/results, admin import/results). The 2026-09-19 revision additionally covers the new public, registration, dashboard and profile screens whose behaviour is defined in [spec 005](../005-v3-1-canonical-alignment/spec.md).
- Brand assets (logo files, final fonts, photography, illustrations, handwritten accent) exist only as rendered samples; production files must be supplied and approved. Where an asset is unavailable the layout uses a neutral placeholder rather than an invented asset.
- The application remains a responsive web app (React SPA) — "mobile support" means a responsive layout in a mobile browser, not a native app.
- No UI framework or component-library adoption is decided here (a planning concern). The palette and spacing are candidate values **measured from the sample images**; the `check:contrast` script remains the authority and any failing pair is adjusted, never the AA target.
- No reference screens exist for: the assessment item player and resume view, consent/assent copy, the report and radar, T11/T12, the growth plan, and every admin surface (console, import, credential export, control plane, exports). They reuse the same tokens and components and need an approved design record before being called conformant.
- Sample content that has no canonical data source (interests, goals, support needs, resources, mentor, preferences beyond language/theme, per-purpose data toggles, notifications, profile photo) is a visual reference only and is not built (spec 005 US10).
- The restyled screens are exercised against the seeded demo identities (`admin@santulan.local` and `participant@santulan.local`, password `ChangeMe123!`, see 002 "Implementation status") until the canonical identity binding of spec 005 replaces them.
