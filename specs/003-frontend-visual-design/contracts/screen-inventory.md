# Screen Inventory Contract: Frontend Visual Design (003)

**Branch**: `003-frontend-visual-design` | **Revised**: 2026-09-19 | **Design system**: [design-system.md](design-system.md) | **Behaviour**: [spec 005](../../005-v3-1-canonical-alignment/spec.md)

Maps every reference screen in `docs/Santulan 2.0/UI screen Samples/` (25 files: `screen 01.png`, `02.png`–`22.png`, `24.png`–`26.png` — **there is no `23`**) to a route, its canonical data source and a scope status, then lists the screens that have **no** sample. Revision 1 mapped six existing 002 screens; those are kept in Part C.

**Status legend**

| Status | Meaning |
|--------|---------|
| **IN SCOPE** | Built in the Santulan design as shown, with the listed reconciliation |
| **REDUCED** | Built, but with fields removed because the canonical schema has no home for them |
| **GATED** | Built but not rendered while a release flag is off |
| **REFERENCE** | Layout/pattern reference only — the content is not built |
| **DEFERRED** | Not built; needs a governed content source or a numbered schema change |

Sample content (names, IDs, copy, statistics) is illustrative. Routes below are proposals that keep the existing `/login`, `/student`, `/admin` roots.

## Part A — The 25 reference screens

### A1. Public site and registration

| # | File | Screen (sample heading) | Proposed route | Data / contract | Status | Reconciliation with canonical rules |
|---|------|-------------------------|----------------|-----------------|--------|-------------------------------------|
| 1 | `screen 01.png` | Home — "A More Balanced Tomorrow Starts with Understanding Today"; four value points; Understand / Grow / Thrive band | `/` | none (static) | IN SCOPE | Copy is placeholder: "scientifically designed", "Evidence-Based … robust psychological science" and "well-being assessment" must pass the G9 claims scan and content-owner approval; never "validated", "clinical", "diagnostic" |
| 2 | `02.png` | About — "A Science-Backed Approach to a Brighter Tomorrow"; Vision, Approach 01–03, team quote | `/about` | none (static) | IN SCOPE | Same claims caveat ("Science-Backed" needs approved wording); team quote is placeholder |
| 3 | `03.png` | Choose Your Participation Route — OPEN "Register as an Individual" (green) vs INSTITUTION "Join Through Your Institution" (blue); "Not sure?" and "Need Help?" strip | `/get-started` | route = `participation_route` OPEN / INSTITUTIONAL | IN SCOPE | "Continue with Institution Code" leads to the institutional sign-in; an institution-code self-join is **not** defined (decision D-02). Bullet "Complete age verification" must read "age" not "proof": the schema stores a declared integer age only |
| 4 | `04.png` | OPEN registration **Step 1 of 5** — Create Your Account (Email / Mobile tabs, "I am 13 years or older", Send Verification Code, "I already have an account", privacy note) | `/register` | managed auth provider (OTP); `POST /auth/request-otp` | IN SCOPE | The 13+ tick is a UX courtesy only; the server enforces 13–25. "I already have an account" → OTP sign-in |
| 5 | `05.png` | **Step 2 of 5** — Enter Verification Code (six boxes, resend countdown "00:28", Change Email Address, "code expires in 10 minutes") | `/register/verify` | `POST /auth/verify-otp` | IN SCOPE | Expiry, rate-limit and replay protection are server-side; wrong/expired codes use the calm error treatment; the OTP is never logged or stored |
| 6 | `06.png` | **Step 3 of 5** — Tell Us Your Age ("DD / MM / YYYY", "age calculated automatically"; "below 18 → assent and parent/guardian consent") | `/register/age` | `POST /participants/age-declaration`; `age_years_at_registration` 13–25 | IN SCOPE, **reconciled** | BUILD 03 forbids collecting or storing date of birth. Render **Age in years** (numeric, 13–25); ages 12/26 show a calm "Santulan is for ages 13–25" message. A DOB helper may exist only if decision D-01 approves a browser-only computation that never leaves the client. The below-18 note is kept |
| 7 | `07.png` | **Step 4 of 5** — Consent and Participation (radio cards: "I am 18 years or older — Self-Consent", "I am below 18 — Assent + Parent/Guardian Consent") | `/register/consent` | `GET /consents/requirements`; `consents` rows (BUILD 04) | IN SCOPE, **reconciled** | The applicable card is **derived from the declared age** (server: `is_minor`); the other card is shown disabled with an explanation, or omitted. Exact consent/assent text comes from the approved `protocol_version` (placeholder copy is never marked approved). Below-18: shows both required records and that the parent/guardian step is verified separately |
| 8 | `08.png` | **Step 5 of 5** — Registration Successful: "Welcome to Santulan!", Santulan ID `STU2024A71829` + Copy, Continue to Your Profile / Go to Dashboard | `/register/complete` | server-generated `santulan_id` | IN SCOPE, **reconciled** | ID is opaque (`STN-` + 20 Crockford Base32 recommended) — the sample's year-bearing format is **not** adopted. The screen states consent status: adult = self-consent to be verified; minor = "waiting for consent to be verified", start action disabled. "We've sent the details to your registered email" only if an email channel is configured |
| 9 | `09.png` | Institutional Login — Santulan ID + password, Forgot password, Sign In, "Login with Temporary Password", "First time here?" | `/login` (institutional) | AT-03/04/05/27; auth provider | IN SCOPE | Placeholder must not suggest school/college codes (sample "SCH001, COL102" implies semantic IDs) — use an opaque example; temporary-password login forces a new permanent password; this route is not behind the OPEN-registration abuse controls (SEC-17); "Register as an individual" link → `/get-started` |

### A2. Signed-in participant

| # | File | Screen | Proposed route | Data / contract | Status | Reconciliation |
|---|------|--------|----------------|-----------------|--------|----------------|
| 10 | `10.png` | Student dashboard (detailed in [dashboards.md](dashboards.md) §1) — "Good morning, Aarav!", Explore Resources band, four action tiles, "Your Progress" timeline, "A Note for You", "Need Help?" | `/student` | `assessment_attempts.status`, consent gate, report state | IN SCOPE, **reconciled** | No stored name (D-03): neutral greeting or Santulan-ID initial. Timeline = real lifecycle (see Part E), not the sample's "Profile Setup / Recommended Resources / Connect with Mentor". Tiles Explore Resources, Wellbeing Support and Connect for Support are **DEFERRED** (no content source, and human-support pathways P2–P4 are gated); a *Complete Assessment* tile and a static *Support* tile remain. Notification bell hidden until notifications exist |
| 11 | `11.png` | Initial Assessment hub — "Step 1 of 5", four section cards (Personal Background, Skills and Strengths, Interests and Goals, Support Needs) with minutes and Start, "responses are secure and private" | `/student/assessment` | `GET /attempts/{id}` resume model; the seven domains | REFERENCE → **rebuilt for the real instrument** | The instrument is 175 (13–17) / 171 (18–25) five-point items in **seven domain blocks** (C1 Body & Self-Regulation … C7 Self-Directed Learning & Executive Capability). Show seven block cards with progress, "Session n of 4", last saved and one **Continue Assessment**. The sample's "15–20 minutes" is not valid for this instrument (protocol guidance is 45–75 minutes across sessions) — use the approved duration. No per-block minute claims unless approved |
| 12 | `12.png` | Personal Background — radio list, dropdown, checkbox group ("Select up to 3"), Back / Save & Continue, right rail | — | none in the 28 tables | REFERENCE | Not built. Education level, field of study and goals have no canonical home; adding them needs protocol approval and a numbered schema change (BUILD 01 §14.3). Radio-row, dropdown and checkbox patterns are reused elsewhere |
| 13 | `13.png` | Skills and Strengths — checkbox chips with icons | — | none | REFERENCE | Not built (`ChipCheckbox` pattern only) |
| 14 | `14.png` | Interests and Goals — chips, radio list, 500-character textarea with counter | — | none | REFERENCE | Not built (textarea-with-counter pattern only) |
| 15 | `15.png` | Support Needs — "Mental Health & Wellbeing" option, support-format radios, free text, **Complete Assessment** | — | none | REFERENCE | Not built. It would collect sensitive support-need and free-text data with no home in the schema and no defined safeguarding workflow (a Q09 signal must come only from the approved detector, never from free text collected ad hoc) |
| 16 | `16.png` | Assessment Complete! — "responses submitted successfully", What happens next (Analysis → Personalised Report → Get Notified → Explore & Act), Estimated time, Back to Home / View My Profile | `/student/assessment/complete` | attempt `SUBMITTED` (+ `SUBMIT` event) | IN SCOPE, **reconciled** | Shown only after atomic submit succeeds. "Explore & Act" step and "View My Profile" are dropped/renamed (prescriptive content is gated; profile has no results). "Notified … and also receive an email" only if a channel exists. Copy must not promise "personalised insights" if the outcome may be T11/T12 |
| 17 | `17.png` | Generating Your Report — four-stage stepper, "60 %" progress bar, "Did you know?" rail | `/student/report/generating` | attempt `SUBMITTED → SCORING → SCORED`; report `PENDING` | IN SCOPE, **reconciled** | The bar and stages reflect **real** state (FR-017); no fake percentage. `QUALITY_HOLD` → neutral T11 copy; `FAILED_RETRYABLE` → "Still preparing your report"; poll/subscribe with a calm timeout message. The photo rail may be omitted on this screen |
| 18 | `18.png` | Recommended Resources & Next Steps — Learn & Explore cards, Suggested Next Steps (courses, workshops, mentor) | — | none / PRIORITY, ACTION, P1–P4 | **GATED** + DEFERRED | Prescriptive and unsourced; not rendered while the release flag is off (BUILD 07). Resource cards have no source (DEFERRED). When the gate opens, content comes only from the Development Action Library |
| 19 | `19.png` | Thank You, Aarav! — "Understand · Grow · Thrive" sign-post, Your Report / Take Action / Keep Growing / We're Here for You, Go to Dashboard / Explore Resources | `/student/thanks` (optional) | none | IN SCOPE (static, optional) | Neutral greeting; "Take Action" and "Explore Resources" removed while gated/deferred; "We're Here for You" links to the approved Support page |

### A3. Profile and privacy

| # | File | Screen | Proposed route | Data / contract | Status | Reconciliation |
|---|------|--------|----------------|-----------------|--------|----------------|
| 20 | `20.png` | Profile Settings — Personal Information (avatar + Change Photo, Full Name, Date of Birth, Email, Class/Year, School/Institution, Location; "Profile Completion 80 %") | `/student/profile` | `participants` (canonical fields only) | **REDUCED** | Show only: Santulan ID (copyable), participation route, assessment track / age band, institution and cohort (institutional route), administration language, sign-in method. **No** name, DOB, email, class, location, photo or completion ring (BUILD 03; no canonical columns). Edit affordances are removed except language |
| 21 | `21.png` | Profile → Interests & Goals (chips: Technology, Science…; goals) | — | none | DEFERRED | Not built; no canonical entity |
| 22 | `22.png` | Profile → Preferences (learning preference cards, notification toggles, Theme, Language) | `/student/profile/preferences` | `administration_language`; theme is a client preference | **REDUCED** | Keep **Language** (available locales only; `en` at launch) and **Theme** (light/dark stored client-side). Learning preferences and notification toggles have no home — deferred |
| 24 | `24.png` | Profile → Privacy & Data (four toggles; Download / Delete / Manage Consent; "Read Our Privacy Policy") | `/student/profile/privacy` | `consents` (status, withdraw); approved withdrawal procedure | **REDUCED** | Show each consent record (type, protocol version, status, dates) with **Withdraw** (`POST /consents/{id}/withdraw`) that states the gate will close. "Download my data" / "Delete my data" and per-purpose toggles ("Anonymous Insights", "Third-Party Sharing", "Communications") are shown only if an approved procedure/entity exists; otherwise a static explanation and Support contact. No invented deletion or retention wording (B04-AUD-007). Privacy Policy link only once the policy exists |
| 25 | `25.png` | Resources — search, category chips, Featured Resources, Explore by Category | — | none | DEFERRED | No content source; nav item hidden (D-05) |
| 26 | `26.png` | Resource detail — "How to Choose the Right Career Path" (article, tips, related resources) | — | none | DEFERRED | As above |

### A4. Shared chrome present in the samples

| Element | Seen on | Handling |
|---------|---------|----------|
| Public header / footer | 01–09; footer on 11–26 | `PublicHeader`, `PublicFooter`; footer links Privacy / Terms / Safeguarding / Contact must resolve to real pages (content owner) |
| Signed-in top bar + sidebar (Home, My Profile, Assessment, Resources, Wellbeing, Support, Settings) | 10–22, 24–26 | `AppShell`; **show only** Home, My Profile, Assessment, Support (and Settings only if it has content). Resources / Wellbeing hidden (D-05) |
| Right rail (Why this matters / Your information is safe / Need Help?) | 11–19, 22, 24–26 | `RailCard`; copy from content owner; "Need Help?" → Support |
| Handwritten tagline art + leaf illustration | most | decorative, `aria-hidden`, hidden < 640 px (FR-015) |
| Language select "English" | 01–09 | `LanguageSelect` — `en` only |
| Copyright "© 2024 Santulan" | footer | year and legal entity from the content owner |

## Part B — Screens with no reference sample (need an approved design record)

Use the same tokens and components. Behaviour is specified in spec 005.

| Surface | Spec 005 | Notes |
|---------|----------|-------|
| Item player and resume | US5 | One item or one domain block per screen; `ResponseScale`; `ProgressSummary` (answered/total, "Section n of 7", "Session n of 4", last saved); Pause; no right/wrong cues; no photography or script |
| Fifth-session recovery, expired attempt, assessment closed | US5, US8 | Calm, non-diagnostic copy from the content owner |
| Consent / assent content screens (per `protocol_version`) and guardian verification status | US3 | Separate assent and parent/guardian journeys; final wording is a legal gate |
| OPEN returning-user OTP sign-in; forced password change; forgot password | US4 | Reuse `SplitHero` |
| Report (T01–T05, T10 layers, seven-axis radar 1.00–5.00) | US7 | Released layers only; "Not enough data" for unreportable domains; no subdomain scores, bands, percentiles, improvement claims |
| T11 Under review / T12 Not eligible | US7 | Neutral, identical for every hold reason; never a flag code |
| Growth plan, priorities, actions, pathways P1–P5 | US7 | **GATED** (P5 human workflow is not a participant screen) |
| Admin dashboard (detailed in [dashboards.md](dashboards.md) §2): overview and monitoring, institutions/cohorts, participants, roster import with pre-commit validation preview, credential export, assessment control (pause/stop/reopen with reason), catalog/reconcile status, quality-review queue, research exports (request → status → download), audit log | US4, US8 | Information-dense variant of the same tokens; the existing pages (`OverviewPage`, `ItemPoolsPage`, `ParticipationPage`, `SubmissionsPage`, `SubmissionDrawer`) are restyled and extended |

## Part C — Existing 002/003 screens (restyle only; FR-009 unchanged)

| Existing page | Restyle target |
|---------------|----------------|
| `pages/LoginPage.jsx` | Becomes the institutional/general sign-in of screen 09 (`SplitHero`); demo accounts keep working until identity binding replaces them |
| Profile + consent steps in `pages/participant/AssessmentPage.jsx` | Superseded by the registration wizard and consent gate (screens 04–08); the assessment page keeps only the player and resume |
| Assessment question screens | Part B item player |
| `pages/participant/ResultsPage.jsx` | Part B report: released layers, neutral states; loading → `Skeleton`, none → `EmptyState` |
| `pages/admin/*` | Tokens swapped from the dark-warm navigation to navy/white; behaviour and data unchanged |

## Part D — Cross-cutting

- `reset.css` then `tokens.css` imported once in `index.js`; components import their `*.module.css`; shared components used everywhere — no page-level CSS for shared affordances.
- Every interactive element shows `:focus-visible`; motion only under `prefers-reduced-motion: no-preference`; status never by colour alone; script text and photographs are decorative and never carry required information.
- Loading → `Skeleton` that mirrors the final layout; empty lists → `EmptyState`; both public and app shells reserve image space to avoid layout shift.
- No date-of-birth field, no participant name/photo, no semantic Santulan ID, no simulated progress, no prescriptive content while gated, no prohibited claims (SC-008).
- Regression guard: the 002 backend suites stay untouched and green; the existing frontend tests (`accessibility`, `components`, `participant`, `admin`, `adminDashboard`) are updated to the new tokens rather than deleted.

## Part E — Participant lifecycle → dashboard / assessment state

| Real state | Dashboard primary action | Timeline stage | Notes |
|------------|--------------------------|----------------|-------|
| Registered, consent records missing or not VERIFIED | **Complete consent** (start disabled, reason shown) | Registered ✓ → Consent (pending) | Minor: also "waiting for parent/guardian verification" |
| Gate open, control plane open, version FROZEN/OPEN, no attempt | **Start assessment** | Consent ✓ → Assessment | — |
| Version DRAFT/CLOSED or participation paused/stopped | "The assessment isn't open right now" | — | Participant-safe copy; no internal state names |
| `IN_PROGRESS` / `PAUSED` | **Continue Assessment** — "Session n of 4", progress, last saved | Assessment (in progress) | Session 5 → recovery screen |
| `SUBMITTED` / `SCORING` / `SCORED` (report `PENDING`) | View progress → generating screen | Submitted → Analysing | Real stage only |
| Report `FAILED_RETRYABLE` | "Still preparing your report" | Analysing | Attempt stays SCORED; admin retry, no retake |
| `REPORT_READY` | **View your report** | Report ready | Released layers only |
| `QUALITY_HOLD` | "Your responses are being reviewed." (T11) | Under review | Same copy for every reason |
| `INVALID` | "This attempt could not be processed for a report." (T12) | — | Safe administrative reason only |
| `EXPIRED` | Calm expired-attempt message | — | Copy pending owner approval |
