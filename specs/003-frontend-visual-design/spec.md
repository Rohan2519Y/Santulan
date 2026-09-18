# Feature Specification: Frontend Visual Design

**Feature Branch**: `003-frontend-visual-design`

**Created**: 2026-09-18

**Status**: Draft

**Input**: User description: "i want to add the good visuals for the frontend"

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

### Edge Cases

- What happens on a very small screen (e.g., older/budget phone, ~320px wide) where item text is long? Layout must still avoid horizontal scroll or clipped/overlapping text.
- What happens when a participant is color-blind? Status/severity (e.g., held result, quality flag) must not be conveyed by color alone - pair color with icon, label, or pattern.
- What happens when content is still loading (profile, attempt, scores, report, submissions list)? Each async view needs a visual loading state, not a blank screen or layout jump once data arrives.
- What happens when a list is empty (e.g., admin submissions list before anyone has submitted, no quality flags on a submission)? An empty state should be shown, not a blank table body.
- What happens on a slow connection? Visual assets added for this feature must not materially slow down first render of the assessment-taking screen, since participants may be on school/mobile networks.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST present a single, consistent visual design (color palette, typography, spacing, and component styling) applied across every existing screen: login, participant profile/consent, the assessment question flow, pause/resume state, participant results, admin import/participation control, and admin submissions list/detail. The overall style direction is **calm and warm**: soft/muted colors, rounded shapes, and a supportive, reassuring tone consistent with a self-report wellbeing instrument for a 13-25 audience and with the existing "no right or wrong answers" requirement (FR-005) - not clinical/corporate, and not bright/gamified.
- **FR-002**: The system MUST visually communicate assessment progress to a participant (questions answered vs. total, and current domain/session) through graphical indicators, not text counts alone.
- **FR-003**: The system MUST style all interactive elements (buttons, inputs, links, the 1-5 response scale) with clear, consistent default, hover/focus, active, and disabled visual states, and MUST NOT rely on unstyled native browser form controls or alerts.
- **FR-004**: The system MUST visually distinguish different message/status types (a normal result, a neutral held/under-review message, a validation error, a session-limit notice, an import success, an import failure) from one another using a consistent, limited set of status treatments (e.g., consistent color+icon pairing per status type), and MUST NOT convey any status by color alone.
- **FR-005**: The system MUST preserve the existing requirement that no visual element implies a "right" or "wrong" answer on assessment items (e.g., no green checkmark / red cross styling on response options).
- **FR-006**: The system MUST remain fully usable and legible at common mobile widths (down to 320px) as well as tablet and desktop widths, without horizontal scrolling or clipped content.
- **FR-007**: The system MUST show a distinct visual loading state for every screen that fetches data before that data is available, and a distinct visual empty state for every list that can legitimately be empty.
- **FR-008**: All text/background color combinations used MUST meet WCAG 2.1 AA contrast guidelines.
- **FR-009**: The visual design MUST be applied without changing any existing functional behavior, validation rules, or data shown (this is a presentation-layer change on top of the existing 002-capability-assessment functionality).

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

## Assumptions

- This feature restyles the existing frontend built in `002-capability-assessment` (login, participant assessment/results, admin import/results) and does not add new screens, pages, or functionality.
- No existing brand assets (logo, official color palette, typography) exist yet for Santulan beyond what is already in the current placeholder UI; this feature is free to establish them, subject to the direction confirmed with the user.
- The application continues to be a responsive web app (not native mobile); "mobile support" here means a responsive layout in a mobile browser, not a native app.
- No new UI framework/component library adoption decisions are made in this spec (technology choice for implementing the visuals is a planning-phase concern, not a scoping concern here).
- Illustration/iconography, if used, will be simple and generic (not photographic, not requiring bespoke commissioned art), consistent with a lightweight pilot-stage product.
