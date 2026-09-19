# Dashboards Contract: Student and Admin (003 / 005)

**Branch**: `003-frontend-visual-design` | **Created**: 2026-09-19 | **Design system**: [design-system.md](design-system.md) | **Screens**: [screen-inventory.md](screen-inventory.md) | **Behaviour**: [spec 005](../../005-v3-1-canonical-alignment/spec.md)

Specifies the two dashboards in detail: what each region shows, where the data comes from, what each state looks like, and (for the admin dashboard) what exists today versus what the SanTulan 2.0 contracts require.

- **Student dashboard** — reference screen: `docs/Santulan 2.0/UI screen Samples/10.png`. Reconciled with the canonical contracts.
- **Admin dashboard** — **no reference screen exists** in the Santulan folder. Requirements come from BUILD 08 (Admin & Research v4.0) and the existing implementation in `frontend/src/pages/admin/`. The visual treatment is derived from the same tokens and needs an approved design record before it is called conformant (spec 005 FR-042).

---

## 1. Student dashboard (`/student`)

### 1.1 Layout (from screen 10)

| Region | Content | Source of truth |
|--------|---------|-----------------|
| Top bar | Logo; user menu (Santulan ID / initial, Sign out). Notification bell **hidden** (no notification entity — D-05) | session |
| Sidebar | Home · My Profile · Assessment · Support (Settings only if it has content). **Resources and Wellbeing hidden** | D-05 |
| Hero band | Time-of-day greeting **without a stored name** (D-03), one supportive line, handwritten quote art (decorative) | static |
| Journey band | "Your journey matters" + **one primary action** driven by lifecycle state (§1.2) | attempt + consent gate |
| Action tiles | *Complete / Continue Assessment* (blue) and *Support* (lavender). The sample's *Explore Resources*, *Wellbeing Support*, *Connect for Support* tiles are **deferred** | D-05 |
| Your Progress | Vertical timeline of real stages (§1.3) with dates | attempt / consent / report timestamps |
| A Note for You | Cream card with an approved supportive quote | static, content owner |
| Need Help? | Lavender card → static Support page (approved contact/safeguarding information) | static |
| Footer | Privacy · Terms · Safeguarding · Contact | pages must exist |

### 1.2 Primary action by state

| Real state | Button | Behaviour |
|------------|--------|-----------|
| Consent records missing / not VERIFIED | **Complete consent** (Start disabled; reason shown) | Minor: shows "waiting for parent/guardian verification" |
| Gate open, control plane open, version FROZEN/OPEN, no attempt | **Start assessment** | `POST /attempts` (server picks the version from age) |
| Version DRAFT/CLOSED, or participation paused/stopped | *No button* — "The assessment isn't open right now" | Participant-safe wording; no internal state names |
| `IN_PROGRESS` / `PAUSED` | **Continue Assessment** — "Session n of 4", progress %, last saved | Resume model only; **no scores** |
| Session 5 requested | Recovery message (copy pending owner approval) | Attempt intact |
| `SUBMITTED` / `SCORING` / `SCORED` (report pending) | **See progress** → generating screen | Real pipeline stage |
| Report `FAILED_RETRYABLE` | "Still preparing your report" | Attempt stays SCORED |
| `REPORT_READY` | **View your report** | Released layers only |
| `QUALITY_HOLD` | "Your responses are being reviewed." (T11) | Identical for every hold reason |
| `INVALID` | "This attempt could not be processed for a report." (T12) | Safe administrative reason only |
| `EXPIRED` | Calm expired-attempt message | Copy pending |

### 1.3 "Your Progress" timeline (replaces the sample's five items)

| Stage | Done when | Notes |
|-------|-----------|-------|
| Account registered | participant exists | date = `created_at` |
| Consent verified | required records VERIFIED and not withdrawn | Minor shows both records |
| Assessment | attempt STARTED/IN_PROGRESS → SUBMITTED | "In progress" ring shows "Session n of 4" |
| Report | report `REPORT_READY` (or T11/T12) | |
| Growth plan | **hidden while the release flag is off** | Shown only when PRIORITY/ACTION are released |

Sample stages "Profile Setup", "Recommended Resources", "Connect with Mentor" are removed (no canonical source / gated).

### 1.4 Data and endpoints

`GET /v1/consents/gate`, `GET /v1/attempts/{id}` (resume model), `GET /v1/reports/{id}` (only REPORT_READY / T11 / T12). The dashboard reads **no** score, quality flag, evidence state or pathway data, and never shows anything from a hidden report section.

### 1.5 States and acceptance

- **Loading**: `Skeleton` for hero, action tile and timeline (no layout shift). **Error**: calm retry message. **First visit**: timeline shows only "Account registered".
- Phone (< 640 px): sidebar → menu, tiles stack, timeline full width, script text hidden.
- Acceptance: for each row of §1.2 the dashboard shows exactly that action; no participant name, date of birth, score, band or percentile appears; a screen reader announces the current stage.

---

## 2. Admin dashboard (`/admin`)

### 2.1 What exists today

Four pages under `frontend/src/pages/admin/` inside `AdminLayout` (sidebar: Overview, Submissions, Item pools, Participation), using one shared submissions fetch.

| Page | Today |
|------|-------|
| Overview | Stat tiles (total, in progress, completed, needs attention), bar charts by status and by item-pool version, "needs attention" list, recent submissions |
| Submissions | Search by Santulan ID; filter by status / version / needs-attention; sort; paging; **CSV download**; side drawer with domain scores and quality flags |
| Item pools | Upload of an `.xlsx` item pool |
| Participation | Open / Pause / Stop with **optional** reason, confirmation dialog, last-action banner |

### 2.2 What the SanTulan 2.0 contracts require (BUILD 08 §4, §13, §16; BUILD 01; BUILD 09)

| Surface (BUILD 08) | Required capability | Hard boundary |
|--------------------|--------------------|---------------|
| Institution management | Create / update / status / archive institutions and cohorts; SCHOOL / COLLEGE / UNIVERSITY with optional parent | Archive by status; never delete when immutable data depends on it |
| Participant management | Search / filter (route, institution, cohort, status); suspend / reactivate; roster import with pre-commit validation; controlled credential export; credential reset | No raw-response editing; no auth secrets; Santulan ID only (no private UUID); every action audited |
| Assessment control | Pause / stop / reopen **new** participation with a required reason and confirmation | Control plane only — never mutates or retires a frozen version |
| Monitoring | Operational counts and states only | No psychometric labels, thresholds or percentiles; no broad Q09 evidence |
| Research access | Request → status → download of governed exports | Active SUPER_ADMIN only; every step audited |
| Audit | View the append-only audit trail | Read-only; no edit or delete |

### 2.3 Target navigation and pages

| # | Page | Route | Status | Content |
|---|------|-------|--------|---------|
| 1 | **Overview** | `/admin` | extend | Operational tiles: participants by route / status, attempts by lifecycle state, reports by state and **retry queue**, exports by state, quality-review queue **counts**, current participation state (both gates). Keep the by-status chart; drop "completed %" phrasing that reads as a performance score |
| 2 | **Participants** | `/admin/participants` | new | Table: Santulan ID, route, assessment track, institution, cohort, status, latest attempt state. Filters: route, institution, cohort, status (exact; **unknown filter keys rejected**). Actions: suspend / reactivate (reason required), reset credential (invalidates the previous one). No name, email, phone or private UUID |
| 3 | **Institutions & cohorts** | `/admin/institutions` | new | Tree view (university → college → cohorts), status, archive with confirmation; create / edit dialogs. No delete |
| 4 | **Roster import** | `/admin/institutions/:id/import` | new | Pick institution + cohort → upload `.xlsx` → **validation preview** listing duplicates, invalid rows and ineligible ages (< 13 or > 25) before any commit → commit → controlled credential export (Santulan ID + temporary password). The sample roster's 2 aged-12 rows must appear as errors; 3 aged-18 rows show as EMERGING_ADULT |
| 5 | **Submissions** (attempts) | `/admin/submissions` | keep, adjust | Same list/drawer. Add institution / cohort filters. Drawer shows domain results with evidence state and completeness, quality flags with disposition, report state; **no** Low/Average/High labels, no subdomain scores for participants. Q09 detail only in the restricted review view (minimum necessary). **CSV download must be removed or routed through the audited research-export flow** — an ungoverned client-side export conflicts with BUILD 08 |
| 6 | **Quality review** | `/admin/quality` | new (may live inside Submissions) | Queue of unreviewed flags by count and type; review sets disposition + note; detection facts are read-only |
| 7 | **Reports** | `/admin/reports` | new (may live inside Overview) | Reports by state; FAILED_RETRYABLE list with an audited **Retry** (no retake / rescore); T11 / T12 counts |
| 8 | **Catalog** (replaces "Item pools") | `/admin/catalog` | change | Read-only status of the two v3.1 versions: label, configuration, items (175 / 171), subdomains (72), content hash, `DRAFT/FROZEN`, `participation_state`, response-scale status, last reconcile receipt. Action: **Run reconcile** (audited). **No upload that creates an active version**; freeze and open-participation are separate audited release actions (not casual buttons) |
| 9 | **Assessment control** (was "Participation") | `/admin/participation` | adjust | Show both gates (version `participation_state` and control-plane state); **reason required** for Pause / Stop; confirmation dialog kept; full recent-changes list from `audit_logs` (actor, action, previous → new, reason, time) |
| 10 | **Research exports** | `/admin/exports` | new | Request form (source assessment version, anonymisation version, filters — institution / cohort / status / date), list with Requested → Generating → Ready / Failed, **Download** only when Ready (audited). Shows whether the file holds current responses only or all versions |
| 11 | **Audit log** | `/admin/audit` | new | Filter by actor, action, target, date; read-only; export not offered |

Only an **ACTIVE SUPER_ADMIN** can reach any admin page; a suspended admin is denied (B08-008). INSTITUTION_ADMIN and RESEARCH_OPERATOR have no UI.

### 2.4 Global admin rules

- Every state-changing action shows a confirmation with the reason, and the UI treats an **audit failure as a failure** of the action (BUILD 08 §6).
- Status chips follow the design-system status map; quality flags need review vs reviewed are distinct by icon and label, never colour alone.
- Tables: sortable headers with `aria-sort`, keyboard-operable rows, reserved skeleton height, empty states ("No participants yet", "No exports yet").
- No screen shows a psychometric label, percentile, cut score or improvement claim (G9 / SC-011).
- The existing warm-dark sidebar is replaced with the navy/white treatment of the design system; the page shell, tiles and drawer patterns stay.

### 2.5 Mapping to requirements

| Admin page | Spec 005 | BUILD 08 tests |
|------------|----------|----------------|
| Overview | US8 #11 | B08-020, B08-021 |
| Participants, Institutions, Roster import | US4, US8 #4–5 | AT-06–09, AT-27, B08-013, B08-016, B08-017 |
| Assessment control | US8 #1–2 | B08-001, B08-002, B08-004, B08-005 |
| Research exports | US8 #6–10 | B08-024…B08-071, AT-20/21/28/30 |
| Audit log | US8 #2–3 | B08-006 |
| Catalog | US1 | T-B02-001…020 |

### 2.6 Open items

- No admin reference screen: layout above is derived, not sampled — needs a design record.
- Whether freeze / open-participation get a guarded UI or stay an operations runbook step is undecided; the default here is read-only display.
- Monitoring KPIs and alert thresholds are not defined in the sources (B08-AUD-013); only counts and states are specified.
