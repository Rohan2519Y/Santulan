# Feature Specification: Capability Assessment

**Feature Branch**: `002-capability-assessment`

**Created**: 2026-09-17

**Status**: Draft

**Input**: User description: "so read all the file and according to that make changes"

**Source of truth**: The `docs/` folder was read in full — `Santulan_Pilot_1_2_MASTER_and_Final_ERD.xlsx`, `Santulan_Development_Reporting_MASTER_System_v1_1.xlsx`, `Santulan_Adolescent_Items_TECH_READY.xlsx`, `Santulan_EmergingAdult_Items_TECH_READY.xlsx`, the Adolescent and Emerging Adult OFFLINE booklets, and `MCQ_Template.csv`. This spec supersedes the earlier `001-assessment-service` spec (which assumed an MCQ quiz driven by `mcq_template.csv`). The documentation shows the assessment is a self-report developmental capability instrument, not an MCQ test.

## Roles

| Role          | Capabilities                                                                                                                           |
|---------------|----------------------------------------------------------------------------------------------------------------------------------------|
| Participant   | Complete consent/assent (age-gated), start and resume an assessment attempt (≤ 4 sessions), submit, and view own domain results and report |
| Admin         | Import frozen item pools, control participation (pause/stop/reopen), review submissions and quality flags, and access approved monitoring   |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Participant Takes the Capability Assessment and Gets Domain Results (Priority: P1)

A participant who has the required consent on file starts an assessment against the currently active frozen assessment version. The system presents the eligible items (matching the participant's age band and context) across the 7 capability domains in the defined order, on the 5-point response scale. Each answered item is saved immutably; the participant can revise answers before submission. On submission, the server scores the attempt and produces per-domain results (mean of valid responses, 1.00–5.00) with a completeness rate and score status, which the participant can then view.

**Why this priority**: This is the entire core value — a developer-capability snapshot from the real instrument. Without it nothing else has meaning. It must be independently shippable as the MVP.

**Independent Test**: An admin imports one of the TECH_READY item pools as the active version; a consent-complete participant starts, answers every eligible item, submits, and within seconds sees domain scores for all 7 domains. Delivers the whole primary value on its own.

**Acceptance Scenarios**:

1. **Given** a participant with valid consent on file and an active frozen assessment version, **When** they start an attempt, **Then** the system presents only the items eligible for their age band and context, grouped into the 7 domain sections in the provided display order, with the 1–5 response scale (`Almost never` … `Almost always`).
2. **Given** a participant has answered items across all sections, **When** they submit, **Then** the system atomically locks the attempt, scores it server-side, and shows per-domain results (score, completeness, status) within seconds.
3. **Given** a participant attempts to submit with the attempt in a state that does not permit submission, **When** they call submit, **Then** the request is rejected with a controlled state error and the attempt state is unchanged.

---

### User Story 2 - Participant Pauses and Resumes an Attempt Across Up to Four Sessions (Priority: P2)

A participant who loses connection, has to stop, or closes the browser can return later and continue exactly where they left off. The attempt supports resumption up to 4 sessions; the resume view shows progress (items completed/total, session N of 4) and a single "Continue Assessment" action.

**Why this priority**: Assessment sessions realistically take 45–75 minutes, so resumability is required for real-world completion. It is still an increment over the core flow.

**Independent Test**: A participant starts an attempt, answers a few items, and stops mid-way; then starts, pauses, and restarts several times, confirming progress is preserved and a 5th session start is rejected with the defined recovery message.

**Acceptance Scenarios**:

1. **Given** an in-progress attempt, **When** the participant leaves and returns, **Then** only the unanswered/unsaved items remain to complete and their previous answers are shown exactly as saved.
2. **Given** an attempt that has already used 4 sessions, **When** the participant attempts a 5th session start, **Then** the request is rejected and a controlled recovery message is shown.
3. **Given** a participant already has an in-progress attempt, **When** they try to start a new one, **Then** the system refuses and returns them to the existing attempt.

---

### User Story 3 - Admin Imports a Frozen Item Pool and Controls Participation (Priority: P3)

An administrator imports a new item pool (Adolescent or Emerging Adult TECH_READY file) as a new frozen assessment version, and can pause, stop, or reopen participation. All such operations are audit-logged. Future attempts use the newest frozen version; prior attempts and responses are never altered.

**Why this priority**: The instrument content is tightly defined and versioned; the admin needs to bring new content live and control rollout without engineering involvement. The core flow already works with a seeded pool, so this is a later increment.

**Independent Test**: An admin imports a valid item-pool file, confirms it becomes the active version, and confirms past submissions still render their original frozen content; then pauses and reopens participation and sees the control events in the audit log.

**Acceptance Scenarios**:

1. **Given** an authorized admin, **When** they import a valid item-pool file, **Then** it is validated and becomes the active frozen assessment version used by new attempts, with version integrity verified by a content hash.
2. **Given** an admin pauses, stops, or reopens participation, **When** participants attempt to start, **Then** the system enforces the control and records the action in the audit log with actor and timestamp.
3. **Given** a new assessment version becomes active, **When** a participant views a completed attempt from an older version, **Then** the original items, responses, and results are preserved unchanged.

---

### User Story 4 - Participant and Admin View Scores and the Report (Priority: P4)

After an attempt reaches the report-ready state, the participant can view their developmental snapshot: domain results and the approved descriptive report layers. An admin can review submissions, scores, and quality flags across participants. Report content is versioned and snapshotted per attempt; prescriptive layers (priorities, actions, growth plan, pathway) are stored but only rendered to participants when the staged-release flag permits (per the MP17 policy in the documentation).

**Why this priority**: The report is how the capability snapshot is communicated, and the admin view provides oversight. It depends on scoring (P1) being in place but is independently demonstrable.

**Independent Test**: A participant whose attempt is report-ready opens the report and sees the descriptive layers plus their 7 domain results; an admin opens the results view and sees that participant's submission, scores, and quality flags.

**Acceptance Scenarios**:

1. **Given** a participant's attempt is report-ready, **When** they open the report, **Then** they see their 7 domain results and the released descriptive report layers, and nothing that is still gated by the release flag.
2. **Given** an authorized admin, **When** they open the results view, **Then** they see participants' attempts with their domain scores, completeness, score status, and any quality flags.
3. **Given** an attempt whose quality routing is on hold or invalid, **When** the participant or admin views it, **Then** the participant sees the single neutral under-review/ineligible message (never the specific trigger), while the admin sees the operational detail.

---

### Edge Cases

- What happens if a participant's attempt is created but the active assessment version changes to a newer import before submission?
- How does the system handle a participant who restarts the assessment after answering everything (elapsed/expired session, session 5 exceeded)?
- How does the system prevent duplicate or replayed response submissions under network retry?
- What happens when a request arrives for an attempt whose version, response scale, or scoring version no longer matches the recorded versions?
- How are safeguarding/quality-hold attempts handled: never scored automatically, human review, neutral participant message?
- What happens if the imported item pool references an unknown domain, subdomain, age band, or context?
- How is a participant-withdrawn consent handled without rewriting immutable response data?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow a consent-complete participant to create an assessment attempt against the current active frozen assessment version.
- **FR-002**: System MUST present only items eligible for the participant's determined age band and context (General/universal items always eligible; variant items only for the matching context), in the provided display order.
- **FR-003**: System MUST present each item with the frozen 5-point response scale (`Almost never` = 1 … `Almost always` = 5) and MUST NOT present any right/wrong framing.
- **FR-004**: System MUST persist every response immutable, versioning changes so each edit creates a new response version and exactly one version per item is current for scoring (BF-01).
- **FR-005**: System MUST allow an in-progress attempt to be paused and resumed across up to 4 sessions, preserving progress, and MUST reject a 5th session with a controlled recovery message.
- **FR-006**: System MUST permit at most one active attempt per participant for an assessment version at a time (MAX_ACTIVE_ATTEMPTS = 1).
- **FR-007**: System MUST lock responses at submission so participant endpoints cannot modify them afterward, and submission MUST be atomic.
- **FR-008**: System MUST reject client-provided scores; all scoring MUST run server-side and deterministically.
- **FR-009**: System MUST compute, for each of the 7 domains, a result from the valid scored item responses: mean score on the 1.00–5.00 scale, completeness rate, and a score status reflecting completeness, quality, version, and evidence state.
- **FR-010**: System MUST apply interpretation rules that are versioned and evidence-gated (S0–S5, SH); held constructs MUST NOT generate operational interpretation, and no output MAY present percentiles, cut scores, diagnoses, or reliable-change claims.
- **FR-011**: System MUST generate a report for a scored attempt only after a REPORT_READY gate; a failed generation MUST leave the attempt scored and permit a controlled retry that reproduces identical content from the same frozen inputs.
- **FR-012**: System MUST prevent a minor participant from creating an attempt without a verified parent/guardian consent AND a separate recorded student assent (age-gated consent routing).
- **FR-013**: System MUST allow an authorized admin to import an item-pool file as a new frozen assessment version with content-hash integrity, and to pause, stop, or reopen participation with full audit logging.
- **FR-014**: System MUST detect and record quality flags (Q01–Q09) separately from raw responses; a Q09 safeguarding trigger MUST route to the human workflow and MUST NEVER be converted into a score or ordinary report.
- **FR-015**: System MUST record and preserve raw responses, attempts, and scores immutably; institution/cohort archival MUST use status changes rather than deletion and MUST NOT remove any record that immutable data depends on.
- **FR-016**: System MUST restrict participant access to the participant's own attempts and results and admin access to admin capabilities only, with data isolation enforced at the data layer as well as the application layer.
- **FR-017**: System MUST record report and interpretation content against frozen content versions and snapshot the exact displayed text per attempt.
- **FR-018**: System MUST generate and store prescriptive report layers (priorities, actions, growth plan, pathways) but render them to participants only when the staged-release flag (`is_released_to_participant`) is set; the flag change MUST NOT require a deployment.
- **FR-019**: System MUST accept offline booklet transcription: an admin entering exactly the participant's marked responses creates identical immutable response records, and blank items remain blank (never guessed).

### Key Entities

- **Participant**: The assessment taker — carries identity, age band, minor status, and participation route; limited to own data.
- **Consent**: Typed, verifiable consent/assent (student assent, parent/guardian consent, adult self-consent) that must be in an approved state before attempts.
- **Assessment Version**: The frozen definition of one instrument (e.g., `santulan-adolescent-pilot-v1.0`, `santulan-emergingadult-pilot-v1.0`), tied to a frozen response scale and content hash.
- **Item**: One self-report statement — code, domain, subdomain, text, keying, age band/context, layer, status, display order.
- **Response Scale**: The frozen 1–5 Likert scale definition with anchor labels.
- **Assessment Attempt**: A participant's single, resumable (≤ 4 sessions) engagement with one frozen assessment version, tracked through defined states to report-ready.
- **Response**: An immutable versioned answer to one item within an attempt (one current version per item).
- **Response Event**: Session start/pause/resume/submit events that define session boundaries and reconnection behavior.
- **Quality Flag**: A Q01–Q09 record tied to an attempt, kept separate from raw responses; Q09 drives the safeguarding workflow.
- **Score Result**: Per-domain outcome — mean score, completeness, score status, scoring version.
- **Interpretation Rule**: Versioned, evidence-gated template for translating a score into participant-facing language.
- **Report / Report Section**: Versioned, snapshotted output with release-flag staging; the participant sees only the released layers.
- **Development Action / Reflection Prompt**: Versioned content libraries referenced by later (gated) prescriptive layers.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A participant who sits the assessment once (45–75 minutes, breakpoints per domain) sees all 7 domain results within 10 seconds of submission, for 100% of valid submissions.
- **SC-002**: 100% of attempts can be resumed across sessions 1–4 with no loss of saved responses; a 5th session is always rejected without corrupting the attempt.
- **SC-003**: Re-scoring any frozen attempt with the same versions reproduces identical domain results and report content for 100% of attempts (reproducibility).
- **SC-004**: An admin can bring a validated item-pool import live and change participation control without engineering assistance, with every action audit-logged.
- **SC-005**: 100% of participant-facing outputs expose no percentiles, diagnoses, or non-evidence-gated interpretations (verified by automated checks and review).
- **SC-006**: No minor participant can reach an active attempt without verified guardian consent plus recorded assent, for 100% of minor attempts.
- **SC-007**: 100% of Q09 safeguarding triggers are routed to the human workflow and never produce a score, report, or ordinary pathway (verified by tests and audit).

## Assumptions

- This feature replaces the earlier `001-assessment-service` MCQ model: the assessment is a self-report capability instrument (no correct answers), and `mcq_template.csv` is not the data source for v1 content; the instrument content is the frozen TECH_READY item pools.
- The two scope carriers are imported as separate frozen assessment versions and stay separated (an item never belongs to both versions).
- The existing platform's auth/users modules provide participant and admin identities; this feature adds participant/admin-facing assessment capabilities on top.
- Per MP17 staged rollout: descriptive report layers ship to all participants from launch; prescriptive layers (priorities, actions, growth plan, pathways) are built and stored but held behind the release flag, with P5 safeguarding exempt from the flag.
- Deterministic rule-based scoring and interpretation only; no machine learning, percentiles, or normalized comparisons in v1.
- Attempt, response, score, and report data are retained for the participant's record; withdrawal is handled by pseudonymisation of the participant–response linkage rather than deletion of immutable rows (exact mechanism remains protocol/legal-review dependent).
- Offline booklets remain supported: their data is transcribed through the admin flow and stored identically to online responses.

## Supersedes

- `specs/001-assessment-service/spec.md` is superseded where it conflicts: the MCQ assumption, the CSV-only item source, and the correct/incorrect scoring model do not apply.