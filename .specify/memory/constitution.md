<!--
SYNC IMPACT REPORT (temporary review scratch — remove before commit)
Version change: 2.0.0 → 2.0.1  [PATCH: clarification — the old platform schema no longer exists]
  (1.0.0 initial ratification 2026-09-19; 1.0.1 deferred the CAPTCHA build; 2.0.0 removed it; 2.0.1 updates the
  workflow note about the removed feature-004 schema.)
Modified principles (2.0.0): IX Security by Construction — CAPTCHA requirement removed;
  X Audit Mode — security suite count now excludes SEC-15 (not applicable).
Principles introduced in 1.0.0: I Source of Truth & Change Control · II One Engine, Two Configurations ·
  III Canonical Schema, Strictly Per the Documents · IV Immutability & Provenance ·
  V Fail Closed, Server Authority · VI Consent, Assent & Safeguarding Gates ·
  VII Evidence-Gated Interpretation · VIII Privacy Minimisation · IX Security by Construction ·
  X Audit Mode & Test-First Evidence
Added sections: Release & Launch Governance; Development Workflow & Quality Gates; Governance
Removed sections: none
Source: docs/Santulan 2.0 (BUILD 00 Baseline Lock v3.1 + Master Baseline v3.0, BUILD 01–09,
  RELEASE_01) and the standing project rule "database strictly per the docs".
Templates reviewed (not modified here): plan-template.md (Constitution Check reads this file at
  runtime), spec-template.md, tasks-template.md, checklist-template.md — no edits required.
Follow-up TODOs:
  - TODO(GOVERNANCE_OWNERS): name the accountable owners for protocol/legal, psychometrics,
    safeguarding, security and release approvals (the contracts assign them by role only).
  - Existing plan.md Constitution Check for feature 005 was derived before ratification; re-run
    /speckit-plan checks against this document when the plan is next revised.
-->

# Santulan Constitution

## Core Principles

### I. Source of Truth & Change Control
The SanTulan 2.0 build contracts in `docs/Santulan 2.0/` are the engineering source of truth. When
artifacts conflict, the authority order is: (1) Theoretical & Construct Foundation 2.0;
(2) approved remediation decisions recorded in the BUILD 00 Baseline Lock (currently v3.1);
(3) the item files (`PILOT_READY` pool, then the two age-band `TECH_READY` files);
(4) the Pilot 1.2 ERD master; (5) the Development & Reporting master; (6) the Competency
Framework; (7) the roadmap; (8) Competency Mapping. Item wording comes from the frozen item files,
construct identity from Foundation 2.0, and database behaviour from the latest BUILD 01 contract.
- Engineers MUST NOT choose between conflicting sources silently: record the conflict, apply an
  already-approved rectification, or stop the affected release gate.
- No one MAY change a psychological construct, score meaning, consent rule or safety rule in code
  without an approved change record (change_id, date, owner, rationale, source evidence, affected
  artifacts and entities, migration, test impact, release-gate impact, new version, hashes).
- A frozen artifact MUST NOT be overwritten; a change creates a new version. A changed source hash
  is a hard stop until a new approved version or change record exists.
- Where prose and executable SQL differ, stop and raise a change record; never pick one silently.
Rationale: the program is audit-driven; every deviation must be traceable and reviewable.

### II. One Engine, Two Configurations, Deterministic Routing
There is exactly one assessment engine. Age selects one of two configurations, never a separate
codebase: 13–17 → Adolescent (`santulan-adolescent-pilot-v3.1`, 175 items); 18–25 → Emerging Adult
(`santulan-emergingadult-pilot-v3.1`, 171 items). Pilot eligibility is 13–25 inclusive; age 18
ALWAYS routes to Emerging Adult and no Adolescent path exists for age 18.
- Routing MUST be enforced at API, service and database layers and covered by boundary tests at
  ages 12, 13, 17, 18, 25 and 26.
- The administered version MUST be stored on the attempt (`assessment_version_id`,
  `age_years_at_attempt`) and MUST NEVER be inferred later from a participant's current age.
- Routing MUST use the version's age range or the resolver function, never an item's `age_band`.
- Item identity is version-scoped: `(assessment_version_id, item_code)`; there is no global
  item-code join across versions. Only `CORE` items are active; `V`, `SJT`, `O` are reserved.
Rationale: non-overlapping routing removes the age-18 ambiguity closed as R-AGE-01 / AF-01.

### III. Canonical Schema, Strictly Per the Documents (NON-NEGOTIABLE)
The canonical PostgreSQL schema (`santulan`) contains exactly the 28 entities of BUILD 01 §6. The
database MUST be built strictly as documented: nothing invented beyond the contract.
- No additional table, column, index, enum value, trigger, function or role MAY be added without a
  numbered change record, migration and the user's explicit approval. A minimal addition is
  allowed only when a genuine defect fix requires it, and MUST be recorded as such.
- Every physical column MUST be atomic (no combined `created_at / updated_at` labels), with
  explicit nullability, keys, constraints, indexes, enum values and delete behaviour.
- Migrations are forward-only in pilot/production; rollback is a forward fix or point-in-time
  restore. An applied migration MUST NOT be edited; a fix is a new numbered file. The dev-only
  reset script MUST NEVER run against pilot or production data.
- Identity, assessment, response, score and lineage foreign keys use `RESTRICT`; `CASCADE` is
  limited to owned report/growth/pathway-review child aggregates; archival is status-based.
- Values the contract does not state MUST be marked as assumptions and reconciled if the source
  package appears; they MUST NOT be presented as contract.
Rationale: "no silent schema additions" is a locked engineering decision (BUILD 01 App. B) and the
project's standing instruction that the docs are the complete design, not a starting point.

### IV. Immutability & Provenance
Raw and released data are history and MUST NOT be rewritten.
- `responses` are append-only versions: a correction inserts a new row, retires `is_current` on the
  prior row, and never updates or deletes content — for every role, including administrators and
  workers. Exactly one CURRENT response exists per (attempt, item), enforced by a database index.
- Assessment versions, response scales, items, scoring rules and report content versions are
  immutable after freeze; changing them creates a new version.
- `score_results`, quality detection facts, report section snapshots and `audit_logs` are
  immutable; the only permitted mutations are review/disposition fields and the report-section
  release flag.
- Every attempt, response, score and report MUST be traceable to the exact assessment, scale,
  scoring and content versions. The same frozen inputs MUST reproduce identical results.
- Institution/cohort history MUST NOT destroy dependent immutable data (status archival only).
Rationale: research integrity and reproducibility depend on unaltered raw observations.

### V. Fail Closed, Server Authority
Absent, ambiguous or unauthorised state MUST resolve to denial.
- Release defaults are closed: versions `DRAFT`, participation `CLOSED`, response scale `DRAFT`,
  development actions inactive, advanced evidence states OFF, prescriptive report sections hidden.
  Opening participation is a separate, audited operational release.
- The server is authoritative for scoring, eligibility, state transitions, session counts, the
  administered version and permissions. Clients MUST NOT supply scores, quality dispositions,
  assessment versions, Santulan IDs or database context; unknown request keys are rejected.
- Invalid state transitions, version mismatches (Q06) and unapproved configuration MUST fail
  closed. Missing evidence-state configuration defaults to S1 (research only), never a promotion.
- A privileged mutation succeeds only if its audit record persists; audit failure fails the
  operation.
- Pause/stop/reopen is a control plane and MUST NOT mutate or retire frozen versions or items.
Rationale: the platform collects sensitive data from minors; safe defaults protect participants.

### VI. Consent, Assent & Safeguarding Gates
No attempt exists without the required VERIFIED, non-withdrawn consent, and safeguarding is human.
- A minor (13–17) requires VERIFIED `PARENT_GUARDIAN_CONSENT` AND VERIFIED `STUDENT_ASSENT`; an
  adult (18–25) requires VERIFIED `ADULT_SELF_CONSENT`. GRANTED is not enough. The required type is
  derived from stored age, never chosen by the client.
- Consent transitions are PENDING → GRANTED → VERIFIED → WITHDRAWN (terminal); PENDING → VERIFIED is
  forbidden; VERIFIED needs `verified_at` and an approved non-secret `verification_method`;
  `INSTITUTION_DELEGATED` stays disabled until an approved protocol authorises it.
- Consent is necessary but not sufficient: version state, participation state and the control plane
  MUST also permit. Withdrawal closes the gate immediately and MUST NOT delete or rewrite responses.
- Registration MUST NOT create an attempt or imply consent or eligibility.
- Q09 safeguarding signals are CRITICAL, route to QUALITY_HOLD and the protected human workflow,
  and MUST NEVER be converted into a capability score or leak into participant-facing copy. P5
  fires independently of the prescriptive release flag. Legal consent wording, verification methods
  and the Q09 trigger and escalation workflow are supplied by their owners and MUST NOT be invented.
Rationale: participants include minors; consent and safety cannot be bypassed by convenience.

### VII. Evidence-Gated Interpretation
Numerical ability to compute a value does not authorise showing it. Interpretation follows the
evidence ladder S0–S5 and SH; the pilot ceiling is S1/S2.
- Participant-facing scoring is domain level (C1–C7) only. Subdomain values MAY exist in a
  research-only view and MUST NEVER appear to participants; C4.2 Self-Worth and C2.10 Savoring
  carry interpretation holds while remaining in their domain means.
- The system MUST NOT expose diagnosis or clinical inference, Low/Average/High or other bands or cut
  scores, percentiles or norm comparisons, reliable-change or improvement claims, personality
  typing, or unsupported causal explanations, in UI, reports or exports, before the matching gate.
- Context (opportunity, access, support, safety) informs actions but MUST NEVER mechanically change
  a capability score; a low score alone MUST NEVER create a counselling or specialist referral.
- Missingness rules are exact: 20 % missing removes participant interpretation; ≥ 40 % yields no
  raw score. REVERSE keying hard-fails until an approved transform exists.
- Prescriptive content (PRIORITY, ACTION, growth plan, P1–P4) is generated but hidden by a
  data-driven release flag; the Development Action Library is the sole action source.
- Unapproved thresholds, detectors, report prose and evidence promotions MUST NOT be fabricated.
Rationale: operational launch is not psychometric validation (Gate G9).

### VIII. Privacy Minimisation
Collect and store only what the pilot needs.
- The canonical schema MUST NOT contain name, email, phone, address, date of birth, guardian name
  or government ID. Identity is a private UUID plus an opaque, non-semantic, never-reused Santulan
  ID that encodes no personal characteristic; authentication stores only a provider reference.
- Passwords and OTP secrets are never stored by Santulan; logs and audit rows MUST redact auth
  subjects, external student IDs, OTPs, tokens and credentials.
- Research exports are research-safe by default: Santulan ID plus approved metadata; no private
  UUID, auth subject, external student ID, contact or guardian identity. Any identified-data mode
  needs a separately approved protocol.
- Withdrawal follows the approved pseudonymisation procedure; retention periods are never
  hard-coded without protocol/legal approval. No real participant data in development; no
  unapproved third-party transmission of raw responses.
Rationale: data minimisation is a stated boundary (BUILD 03, BUILD 08) and protects minors.

### IX. Security by Construction
Isolation is enforced in the database and repeated in the application.
- Row-level security keyed on `institution_id` is enabled and forced; institution-scoped access
  needs an exact non-NULL institution match — NULL (OPEN participants) is never a shared tenant;
  no context means no rows.
- The web runtime role MUST NOT have `BYPASSRLS` and MUST NOT own the tables. Tenant/actor context
  is set per transaction (`SET LOCAL` equivalent) from server-verified state only and MUST NOT leak
  across pooled connections. The legacy platform's `BYPASSRLS` role MUST NOT touch canonical data.
- OPEN registration requires per-IP and per-device throttling, separate from OTP expiry,
  rate-limit and replay controls; institutional sign-in is not subject to it.
  Passwords are hashed; TLS in transit and encryption at rest are mandatory.
- Separate development, staging and pilot environments. A backup that has never been restored is
  not evidence: an actual restore into a clean environment MUST pass before launch.
- Privileged operations (credential generation/reset, assessment control, exports, status
  changes) MUST be audit logged; the pilot has one active admin role, SUPER_ADMIN.
Rationale: cross-institution leakage is a NO-GO condition and cannot be a single-layer defence.

### X. Audit Mode & Test-First Evidence (NON-NEGOTIABLE)
Audit mode is permanently on; it is delivery discipline, not a debug flag.
- Every build artifact MUST be independently checkable against its declared source and
  predecessor: named and hashed sources, atomic schema, version traceability, boundary and consent
  tests, item/count checks, quality/scoring/report/security/export/change audits.
- Tests come first for invariants: write the failing test (unit, integration, boundary, negative,
  concurrency, idempotency, security, migration, data-integrity) before the implementation.
- The canonical suite (AT-01–AT-32 and RC-01–RC-12, 44 tests), the security suite (29 applicable tests; SEC-15 is not applicable) and
  each BUILD's mandatory matrix MUST pass with a recorded evidence reference. A test without
  evidence is not PASS. Static generation is not a substitute for executing against a live
  PostgreSQL 15+ database.
- Every technical document MUST state its dependencies, requirements (MUST/MUST NOT), data
  contract, state machines, API contract, security notes, evidence boundary, tests, audit findings,
  definition of done and release manifest.
Rationale: BUILD 00 §14 makes evidence, hashes and change records the unit of progress.

## Release & Launch Governance

- Pilot launch status is **NO-GO** until every critical prerequisite is evidenced: 44/44 canonical
  and 29/29 applicable security tests, an actual restore, gates G1–G10 closed with sign-off, the official
  Launch Day Runbook obtained and reconciled, approved consent copy and verification methods, and a
  live Q09/P5 human handoff. The release manifest is signed only afterwards.
- Any of the following is automatically NO-GO: cross-institution data leakage; a minor reaching an
  attempt without required verified consent; raw-response update or delete; unavailable Q09/P5
  handoff; a failed or missing restore; a critical test failure; absent OPEN-registration abuse
  protection; visible unapproved claims; a privileged operation without an audit record;
  unidentifiable production versions.
- Decisions owned outside engineering — legal consent copy, withdrawal and retention, Q01–Q09
  thresholds and triggers, evidence-state promotion, report copy and D1 variants, response-scale
  sign-off, P3/P4 referral criteria, throttle limits, RPO/RTO — are release
  gates supplied by their owners. Engineering builds the mechanism and the fail-closed default only.
- Freezing the response scale, freezing versions, opening participation and enabling prescriptive
  release are separate audited actions; none is implied by a deployment.
- No waiver of a critical gate is granted by silence.

## Development Workflow & Quality Gates

- Work follows the Spec Kit flow: specification → plan → tasks → implementation. Every plan's
  Constitution Check MUST evaluate this document; unjustified violations block the plan.
- Backend changes to the canonical schema go through numbered raw-SQL migrations; nothing is added
  to the 28 tables, indexes or enums without approval (Principle III).
- Each pull request MUST reference the requirement and test IDs it satisfies, state any change
  record, and confirm: no new PII column, no client-supplied score or version, no prohibited claim,
  no weakened partial unique index (`uq_one_nonterminal_attempt_per_participant`,
  `uq_current_response`), and no runtime role with `BYPASSRLS`.
- New third-party runtime dependencies require an impact assessment; the frontend MUST hold no
  scoring logic and MUST render the server-selected configuration and frozen scale metadata.
- User-facing surfaces conform to the approved design system and pass WCAG 2.1 AA; copy is scanned
  for prohibited claims before release (Gate G9).
- The former feature-004 school platform schema (`docs/SQL-Database-Schema.md`) and the feature-002 assessment
  tables were removed from the local database on 2026-09-20 at the requester's direction; `santulan` is the only
  schema. No BYPASSRLS role exists, and none may be introduced for canonical data.

## Governance

This constitution supersedes other engineering practices for Santulan. Where it and a feature spec
conflict, the constitution prevails until amended.

- **Amendments**: proposed in writing with rationale and impact on affected specs, plans, tasks and
  tests; approved by the project owner; recorded in the Sync Impact Report and, for changes to a
  frozen contract, a change record under Principle I. Principles derived from the BUILD documents
  change only when the corresponding BUILD document changes through its own versioning.
- **Versioning**: semantic. MAJOR — a principle removed or redefined in a backward-incompatible
  way; MINOR — a principle or section added or materially expanded; PATCH — clarification or
  wording. The version line below and the Sync Impact Report MUST agree.
- **Compliance review**: every plan (Constitution Check), pull request and release-candidate review
  verifies compliance; the launch review re-verifies Principles III–X against evidence. Complexity
  or deviation MUST be justified in the plan's Complexity Tracking and approved before merge.
- **Guidance**: runtime development guidance lives in the feature specs and the BUILD documents;
  the Spec Kit templates read this file at execution time.

**Version**: 2.0.1 | **Ratified**: 2026-09-19 | **Last Amended**: 2026-09-20
