> SUPERSEDED FOR STORAGE by feature 006 (PostgreSQL removed 2026-09-20); behavioural rules still apply

# Feature Specification: Platform SQL Database

**Feature Branch**: `004-platform-sql-database`

**Created**: 2026-09-19

**Status**: Implemented (strict scope — see "Scope revision")

**Input**: User description: "read the sql-database inside the docs and there is the database so i want that database"

## Scope revision (2026-09-19, during implementation)

While implementing, the requester directed: *"i want strictly the database design like the sql-database present inside the docs"* and *"remove the unwanted tables"* (confirmed as: remove the 16 older feature-002 assessment tables). The requirements below were written before that direction and are amended as follows. Anything not listed is unchanged and was implemented and tested.

**Removed — not in the doc, therefore not built**

| Requirement | What it asked for | Now |
|-------------|-------------------|-----|
| FR-009/010/011 (part) | Database enforcement that a profile can only sit on an account of the matching role | Profiles are separate tables as the doc defines; matching role is not enforced by the database |
| FR-018 | Platform-scope access via an audited setting | The doc's own mechanism applies: a separate `BYPASSRLS` database role. Auditing that route is an application concern |
| FR-019 | Reporting connections cannot read credential fields | Not built (no reporting role) |
| FR-028, SC-009 | Indexed "latest session per checkpoint" and 1-second lookups at 100,000 sessions | Not built — the doc defers extra indexes "until real query patterns are known" |
| FR-036 (part) | Append-only audit trail for the application role | Not built; sealed-data-open events are still ordinary audit rows |
| FR-038 | Erasing a student removes every record (function, parent-list cleanup) | Only the doc's foreign-key cascades. A parent's linked-student list keeps a deleted student's id — the doc's accepted trade-off ("Pass four"), tested as such |
| SC-007, SC-008 | Erasure leaves nothing; reporting role refused credentials | Replaced by the cascade tests |

**Changed**

| Requirement | Now |
|-------------|-----|
| FR-016/017 (tenant isolation) | Row-level security exactly as doc §4, on the 8 tables that carry a `school_id` (`accounts`, `school_assignments`, `escalation_events`, `consent_records`, `scp_consents`, `queue_signals`, `class_guidance_state`, `group_sessions`). No school set → 0 rows. Student-scoped tables without a `school_id` and `audit_events` are not covered, because the doc's §4 example applies to school-owned tables |
| FR-003, SC-004 ("existing features keep working") | **Superseded, then restored.** The 16 feature-002 assessment tables and their 19 enum types were removed by migration `006`, on request. The assessment module still needed 15 of them and failed (e.g. `relation "response_scales" does not exist` on the admin import), so migration `007` restored those 15 tables and 18 enum types. The old `users` table and `UserRole` enum are **not** restored: people are `accounts`, and the three columns that pointed at `users` now point at `accounts`. The doc's 22 tables are untouched. A full backup was taken before `006` |
| Assumption "Additive, not a replacement" | **Superseded** by the same instruction |

**Kept, and still tested**: 22 tables exactly as the doc's DDL; the three ER-diagram items the doc's DDL omits (`queue_signals.school_id`, `accounts.deleted_at`, one assent per session); every constraint, enum, unique rule and default the doc defines (FR-001, 002, 004–008, 012–015, 020–027, 029–035, 037, 039, 040); idempotent setup (FR-002, SC-001–003, verified from an empty database); cross-school isolation (SC-005); the doc-defined refusals (SC-006); audit completeness (SC-010).

**Added after the first revision (2026-09-19): sign-in and demo accounts.** The requester then asked for one admin and one student account, and for login to be rewritten so they can sign in. This is application-layer work on top of the doc's schema, not a change to it: a new User Story 8, requirements FR-041–FR-046 and success criteria SC-011–SC-013 below. The one database object it needs is the platform-scope `app_platform` connection role, which is the doc's own §4 mechanism ("a separate role that bypasses RLS"), created outside the migrations because roles are cluster-level. The assessment module (attempts, responses, reports, item import) was first left un-rebuilt, then made to work again by restoring its tables (see FR-047 below). The assessment module additionally seeds its own `participant@santulan.local` account (role `student`) via `npm run db:seed` so its participant flow can be signed-in and tested alongside the platform demo accounts; all use the development password `ChangeMe123!`.

**Superseded 2026-09-20 — schema removed.** At the requester's direction the 22-table platform schema described here (and the feature-002 assessment tables, their types and functions, and the legacy `BYPASSRLS` role `app_platform`) was **completely removed** from the local database and migrations `001`–`007` were deleted. The only schema is now the SanTulan 2.0 canonical schema `santulan` (28 tables, BUILD 01), specified in [005-v3-1-canonical-alignment](../005-v3-1-canonical-alignment/spec.md). This spec is kept as history; nothing below is implemented any more. A backup dump is at `backend/backups/santulandb-before-schema-removal-2026-09-20.dump`.

**Source of truth**: `docs/SQL-Database-Schema.md` ("Santulan — SQL Database Schema, NoSQL → SQL Migration Design"). That document defines the 22 tables, their columns, relationships, constraints, tenant-isolation rules, and the deliberate design decisions behind them. This spec states *what the database must provide and guarantee*; the schema document remains the field-level definition and is not repeated here.

## Roles

| Role                     | What they need from the database                                                                                                             |
|--------------------------|----------------------------------------------------------------------------------------------------------------------------------------------|
| Platform engineer        | Bring up the complete, correct database in any environment (local, test, production) with one repeatable step, and know it matches the design |
| Platform administrator   | Register schools and the people in them, assign staff roles, grant and revoke extra permissions, and see a trustworthy audit trail             |
| School staff (principal, counsellor, teacher, support) | Work only with their own school's students and records, and never see another school's data                        |
| Student / Parent         | Have their identity, consent, assessment sessions and safeguarding records stored safely, correctly linked, and erasable on request         |
| Admin (platform superuser) and Student | Sign in to the running service with their own credentials and land on the right screen                                               |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Engineer Stands Up the Complete Platform Database (Priority: P1)

A platform engineer starts from an empty environment and, in one repeatable step, gets the whole database described in the schema document: all 22 tables, every relationship between them, every allowed-value list, every uniqueness and range rule, and every lookup speed-up. The same step works on a developer laptop, in automated tests, and in production, and running it again does not break or duplicate anything. The new structure is added alongside the existing capability-assessment data without disturbing it.

**Why this priority**: Nothing else in this feature exists until the database does. This is the literal request ("I want that database") and the smallest slice that delivers value: a correct, empty, ready-to-use platform database.

**Independent Test**: On a fresh environment, run the setup step; confirm all 22 tables, their relationships, and their rules exist by comparing against the schema document. Run it a second time and confirm nothing changes and nothing fails. Run the existing capability-assessment test suite and confirm it still passes.

**Acceptance Scenarios**:

1. **Given** an empty environment, **When** the engineer runs the setup step, **Then** all 22 tables from the schema document exist with the documented columns, relationships, allowed values, and uniqueness/range rules.
2. **Given** an environment where the setup step has already been applied, **When** the engineer runs it again, **Then** it completes without error and without changing or duplicating any structure or data.
3. **Given** an environment that already holds the existing capability-assessment tables and data, **When** the setup step is applied, **Then** all of that existing structure and data is unchanged and the existing features keep working.
4. **Given** a completed setup, **When** the engineer compares the result against the schema document, **Then** there are no missing, extra, or differently-named tables or columns.

---

### User Story 2 - A School Can Only Ever See Its Own Data (Priority: P1)

Every school is a separate tenant. When a principal, counsellor, or teacher at one school works with the platform, the database itself guarantees they can only read or change records belonging to their school — even if a query is written carelessly and forgets to ask for "only my school." Platform-level administrators can work across schools only through an explicit, separate, audited route.

**Why this priority**: These are records about children, including safeguarding and counselling material. Cross-school leakage is the single most serious failure this database could have, and the schema document names it as the biggest reason for the redesign. It must be true from day one, not bolted on.

**Independent Test**: Create two schools, each with students and records in every school-owned area; act as staff of school A and attempt to list, read, and modify school B's records both with and without an explicit school filter; confirm zero school B records are ever returned or changed.

**Acceptance Scenarios**:

1. **Given** two schools with escalation events, **When** school A staff request all escalation events without specifying a school, **Then** only school A's events are returned.
2. **Given** school A staff, **When** they try to create or modify a record that belongs to school B, **Then** the change is refused.
3. **Given** a request with no school identified at all, **When** it reads any school-owned area, **Then** it returns nothing rather than everything.
4. **Given** a platform administrator using the platform-level route, **When** they read across schools, **Then** the access succeeds and is recorded in the audit trail.

---

### User Story 3 - Register Schools, People, and Their Roles (Priority: P1)

An administrator registers a school and the people who belong to it: students, parents, counsellors, principals, teachers, support staff, and platform-level staff. Each person has one account regardless of role, plus role-specific detail only where the role needs it (a student's class and login ID; a staff member's work email and approval status; a parent's relationship and the children they are linked to). Staff are assigned to schools in specific roles, and those assignments can later be revoked while keeping the history. Individual accounts can be granted extra, expiring permissions beyond their role.

**Why this priority**: Every other record hangs off an account and a school. Without correct identity, tenancy, and role assignment nothing else can be recorded meaningfully.

**Independent Test**: Register a school, a principal, a counsellor, a student, and that student's parent (whose account starts before they have ever logged in); confirm each is stored with the right role-specific detail, the parent is linked to the student, a second principal for the same school is refused, and revoking the counsellor's assignment keeps a history row.

**Acceptance Scenarios**:

1. **Given** a school, **When** a student is registered with a parent contact, **Then** the parent gets their own account in a "pending" state (no password yet) linked to that student, and the same account continues unchanged when the parent later activates it.
2. **Given** a parent with two children at the school, **When** the parent is linked to both, **Then** one parent record lists both children; and a child with two parents appears in each parent's list.
3. **Given** a school that already has an active principal, **When** a second active principal is assigned, **Then** the assignment is refused.
4. **Given** a staff assignment, **When** it is revoked, **Then** the assignment remains on record with a revocation time and no longer counts as active.
5. **Given** an account, **When** an extra permission is granted with an expiry, **Then** it is recorded with who granted it and stops being effective after the expiry or revocation.
6. **Given** a school-level account (student, parent, or school staff), **When** it is created without a school, or a platform-level account is created with one, **Then** the record is refused.

---

### User Story 4 - Record Consent, Assent, and SCP Assessment Sessions (Priority: P2)

The platform records the two distinct kinds of parental consent — general onboarding consent (one-time) and SCP-specific consent (renewable each academic year, with start and end dates) — plus the student's own assent for each individual SCP session. It records every SCP session a student takes: which checkpoint and form, its progress and timing, whether the device was shared, the student's answers (stored sealed), the resulting domain scores, and whether the session was later voided and why.

**Why this priority**: SCP is the one student instrument in this release, and consent is a legal and ethical precondition for it. This is the core data of the product, but it depends on identity and tenancy (P1) being in place.

**Independent Test**: For a student with onboarding consent and a current-year SCP consent, create an SCP session with an assent, save sealed answers as they are given, record domain scores on completion, then void the session; confirm each step is stored, the student cannot have two assents for the same session, and the latest session per checkpoint is quickly retrievable.

**Acceptance Scenarios**:

1. **Given** a student, **When** onboarding consent and SCP consent are recorded, **Then** they are stored as two separate records, and the SCP consent carries an academic year and validity dates and may be withdrawn with a reason.
2. **Given** an SCP session, **When** the student assents or declines, **Then** exactly one assent record exists for that session, showing the choice and when it was made.
3. **Given** an in-progress SCP session, **When** answers are saved, **Then** they are stored only in sealed form, and answered/total counts and resume count reflect progress.
4. **Given** a completed SCP session, **When** scoring finishes, **Then** per-domain results are stored on the session, and a voided session keeps who voided it, when, and why.

---

### User Story 5 - Safeguarding, Counsellor Notes, and the Attention Queue (Priority: P2)

When a student needs attention, the platform records an escalation (severity 3–5) with its reason and progress from open to acknowledged to resolved, including who handled it. Counsellors keep private notes about students, stored sealed. Softer signals (a sustained pattern from the Student Voice check-in) go into a counsellor attention queue, optionally suggesting a protocol. Class-level guidance summarises patterns for a whole class along with the group size the figure is based on, so small groups are not over-read.

**Why this priority**: This is the safeguarding backbone and the reason confidentiality and isolation matter, but it builds on students, staff, and consent existing.

**Independent Test**: Raise an escalation for a student, acknowledge and resolve it as a counsellor, add a sealed note, add a queue signal with a suggested protocol, and store a class guidance entry; confirm each is stored with the right links, an out-of-range severity is refused, and everything is scoped to the student's school.

**Acceptance Scenarios**:

1. **Given** a student, **When** an escalation is raised with severity outside 3–5, **Then** it is refused.
2. **Given** an open escalation, **When** a counsellor acknowledges and then resolves it, **Then** who acted and when is recorded at each step, along with resolution notes.
3. **Given** a counsellor and a student, **When** a note is saved, **Then** only sealed (non-readable) content is stored, linked to both the counsellor and the student.
4. **Given** a school and a class that already has a guidance entry, **When** a second entry is stored for the same school and class, **Then** it is refused as a duplicate (one guidance state per class).

---

### User Story 6 - Protocol Library, Learning Content, and Group Sessions (Priority: P3)

Administrators maintain a library of intervention protocols (steps, things to avoid, when to stop and route elsewhere, review status of draft/approved/retired, and version). Staff record that they completed a protocol's orientation and that they routed a student to a protocol. Administrators publish learning modules targeted by role and school, people record completing them, and counsellors schedule group sessions optionally built around a module.

**Why this priority**: Valuable and part of the platform, but the platform can launch its assessment and safeguarding core without it; it can be filled in afterwards.

**Independent Test**: Add a protocol with steps and a review status, record a staff orientation and a route event, publish a module targeted at one school, record a completion (twice for the same person and module), and schedule a group session; confirm the duplicate orientation/completion is refused and module targeting is stored as configured.

**Acceptance Scenarios**:

1. **Given** a protocol, **When** it is stored, **Then** its code is unique and its review status is one of draft, approved, or retired.
2. **Given** a staff member who already completed a protocol's orientation, **When** the same orientation is recorded again, **Then** it is refused as a duplicate.
3. **Given** a module with no school targeting, **When** it is published, **Then** it applies to all schools; with school targeting, only to those schools.
4. **Given** a person who already completed a module, **When** completion is recorded again, **Then** it is refused as a duplicate.

---

### User Story 7 - A Trustworthy Audit Trail (Priority: P2)

Every sensitive action — including any time protected (sealed) data is opened — is written to a single audit trail: what kind of action, who did it and in what role, which school they acted for (when known), what it was done to, the outcome, flexible detail, and where it came from. It is one consolidated trail rather than several overlapping ones.

**Why this priority**: Compliance and accountability for data about minors. It is needed before real data goes in, but it does not block the first working slice.

**Independent Test**: Record a sealed-data-open event, a permission grant, and a platform-level cross-school read; confirm each appears as one audit record with actor, role, school (where applicable), target, and outcome, and that a school's staff can only see their own school's audit records.

**Acceptance Scenarios**:

1. **Given** any audited action, **When** it occurs, **Then** one audit record is stored with actor, role, target, outcome, time, and origin.
2. **Given** an opening of sealed data, **When** it is logged, **Then** it is an ordinary audit record classed as a sealed-data-open event, carrying the purpose and target.
3. **Given** a platform-wide action with no single school, **When** it is logged, **Then** the school is left empty rather than invented.

---

### User Story 8 - An Admin and a Student Can Sign In (Priority: P2)

A platform admin and a student, each stored as an account in the new database, can sign in to the running service. A student signs in with the school-issued login ID (or their email) and a password; an admin signs in with their email and a password. On success they receive a time-limited token identifying their account, role and school, and the login screen sends each to their own home screen. Anyone whose account is not active, has no password yet, or whose details are wrong is refused with a message that does not reveal which part was wrong. One demo school, one admin and one student are provided so the service can be tried straight away.

**Why this priority**: The database is only useful if people can get in. It depends on the accounts and school built by the P1 stories, and it is separate from the schema itself.

**Independent Test**: Seed the demo accounts, start the service, sign in as the student with the login ID and as the admin with the email, and confirm each gets a token carrying the right role; then try a wrong password, an unknown login, and each inactive account state and confirm all are refused identically.

**Acceptance Scenarios**:

1. **Given** the demo student account, **When** they sign in with login ID `student001` and the correct password, **Then** they receive a token whose role is `student` and whose school is the demo school.
2. **Given** the demo admin account (no school), **When** they sign in with their email and the correct password, **Then** they receive a token whose role is `superuser` and whose school is empty.
3. **Given** an account that is pending, suspended, locked or deleted, or has no password, **When** its owner tries to sign in, **Then** they are refused.
4. **Given** a wrong password and, separately, a login that does not exist, **When** each is tried, **Then** the responses are identical.
5. **Given** a successful sign-in, **When** it completes, **Then** the account's last-sign-in time is recorded.
6. **Given** the login screen, **When** a student types their student ID (not an email), **Then** it is accepted as a valid entry and, on success, the student lands on the student screen and the admin on the admin screen.

---

### Edge Cases

- A parent account is created at student registration before the parent has ever logged in: it must be allowed to exist without a password only while "pending," and refused without one in any other state.
- The same parent is linked to several students, and a student has several parents: both must work with no separate link record, using the single list on the parent's record.
- A student ID inside a parent's linked list that does not correspond to a real student: the database cannot reject this itself, so it must be caught by the application when writing (see Assumptions); the spec requires that this limitation is documented, not silently hidden.
- A second active principal is assigned to a school: refused; a *revoked* principal followed by a new one is allowed.
- Two people try to use the same email or the same mobile number: the second is refused.
- A staff account that authored counsellor notes, audit records, or other retained records is removed: it must not silently orphan those records, so the account is marked deleted and retained instead of physically removed.
- A student is erased on request: every record about that student (profile, consents, assents, sessions, escalations, notes, queue signals, protocol routes, module completions) must go with them, leaving nothing behind.
- A record with no school identified reaches a school-owned area: it returns nothing rather than everything.
- A read-only reporting connection tries to read password or reset-token hashes: it must be refused.
- Extra permission granted with a field allowlist on anything other than an "update" action: refused.
- Escalation severity outside 3–5, or student escalation level outside 1–5: refused.
- The setup step is interrupted part-way: rerunning must bring the environment to the complete, correct state without manual clean-up.
- A module with an empty school-targeting list: applies to every school (not to none).

## Requirements *(mandatory)*

### Functional Requirements

**Provisioning**

- **FR-001**: The system MUST provide one repeatable setup step that creates the complete database defined in `docs/SQL-Database-Schema.md` — all 22 tables with every documented column, relationship, allowed-value list, uniqueness rule, range rule, and lookup speed-up.
- **FR-002**: The setup step MUST be safe to run more than once: reapplying it MUST NOT fail, duplicate, or change existing structure or data.
- **FR-003**: The setup step MUST add the new structure alongside the existing capability-assessment structure without altering, renaming, or removing any of it, and existing features MUST continue to behave exactly as before.
- **FR-004**: The setup step MUST be usable in local development, automated testing, and production without per-environment edits to the definition.

**Identity, tenancy, and roles**

- **FR-005**: The database MUST hold exactly one account per person regardless of role, with a role, a lifecycle status (pending, active, suspended, locked, deleted), and basic identity (name, language, contact details).
- **FR-006**: An account of the school-user kind MUST belong to exactly one school; an account of a platform-level or superuser kind MUST belong to none.
- **FR-007**: Email and mobile number MUST each be unique across accounts.
- **FR-008**: An account MUST be allowed to have no password only while its status is "pending"; in any other status a password is required.
- **FR-009**: Student-only detail (school-issued login ID, class, section, roll, date of birth, age and class band, onboarding state, escalation level, counters) MUST be held separately from the account and MUST NOT appear on non-student accounts. The login ID MUST be unique when present.
- **FR-010**: Staff-only detail (work email, designation, position, state, district, approval status, approver, approval time) MUST be held separately from the account. The work email MUST be unique when present.
- **FR-011**: Parent-only detail (relationship, occupation, alternate mobile) and the list of linked students MUST be held on one parent record, supporting many students per parent and many parents per student without a separate link record.
- **FR-012**: Staff-to-school assignments MUST be recorded as separate, revocable records with role, optional class, who assigned, when, and when revoked; revoking MUST keep the record.
- **FR-013**: A school MUST NOT have more than one active principal assignment at a time.
- **FR-014**: Extra permissions on an account MUST record what resource and action is granted, its scope, who granted it, and optional expiry and revocation time; an allowed-fields list MUST be accepted only for "update" permissions.
- **FR-015**: Resources, actions, and scope types for permissions MUST be limited to the closed lists in the schema document; resources for removed features (old assessments, pulse, chat) MUST NOT be grantable.

**Tenant isolation and confidentiality**

- **FR-016**: For every school-owned area, the database itself MUST refuse to return or change rows belonging to a school other than the one the current request is acting for, even when the request contains no school filter.
- **FR-017**: A request that identifies no school MUST see no rows in school-owned areas.
- **FR-018**: Platform-level access across schools MUST use a separate, explicit route and MUST be recorded in the audit trail.
- **FR-019**: Fields that hold credentials (password hash, reset-token hash) MUST be restrictable so that read-only and reporting connections cannot read them.
- **FR-020**: Counsellor note content and SCP item responses MUST be stored only in sealed (non-plain) form; the database MUST NOT require or offer a plain-text copy.

**Safeguarding and guidance**

- **FR-021**: Escalation events MUST record the student, school, severity (3–5 only), reason, status (open, acknowledged, resolved), who acknowledged and resolved and when, and resolution notes.
- **FR-022**: Counsellor notes MUST record the authoring counsellor, the student, the sealed content, and time written.
- **FR-023**: Attention-queue entries MUST record the student, the school, an attention level, a reason, an entry point, an optional suggested protocol, and a resolution time.
- **FR-024**: Class-level guidance MUST be unique per school and class, and MUST record the pattern, term context, band, coverage percentage, and the group size the figure is based on.

**Consent and SCP**

- **FR-025**: General onboarding consent and SCP consent MUST be stored as two separate record types; SCP consent MUST carry academic year, validity start and end, who granted it and how, and withdrawal time and reason.
- **FR-026**: There MUST be at most one assent record per SCP session, recording whether the student assented and when they assented or declined.
- **FR-027**: SCP sessions MUST record checkpoint, form, state, participation status, scheduling and activity times, progress counts, resume count, device-shared flag, validity outcome, sealed item responses, domain results, and void details (when, by whom, why).
- **FR-028**: The latest SCP session per student per checkpoint MUST be retrievable efficiently.

**Protocols, content, and sessions**

- **FR-029**: Protocols MUST have a unique code, a review status limited to draft, approved, or retired, ordered steps, optional things-to-avoid and stop-and-route lists, and a version.
- **FR-030**: Each person MUST be recordable as having completed a given protocol's orientation at most once.
- **FR-031**: Protocol routing events MUST record the practitioner, the protocol, the student, context, and time.
- **FR-032**: Learning modules MUST record type, audience, language, published state and publisher, target roles, and target schools, where an empty school list means all schools.
- **FR-033**: Each person MUST be recordable as having completed a given module at most once.
- **FR-034**: Group sessions MUST record the facilitating counsellor, the school, title, date, time, and an optional linked module.

**Audit**

- **FR-035**: All audited actions MUST be stored in a single audit trail recording action class, actor, actor role, actor's school (when known), target type and ID, outcome, flexible detail, source address, client description, and time.
- **FR-036**: Opening of sealed data MUST be logged as an audit record of a dedicated class rather than in a separate log.

**Integrity and erasure**

- **FR-037**: Every reference from one record to another MUST be enforced by the database, so a record pointing to something that does not exist cannot be stored (except student links inside a parent's list, per Assumptions).
- **FR-038**: Erasing a student account MUST remove every record about that student across all areas, leaving no orphaned data.
- **FR-039**: Accounts referenced by records that must be retained (audit trail, counsellor authorship, and similar) MUST NOT be physically removable; they MUST instead be markable as deleted with a deletion time, and remain retained.

**Out of scope (explicitly not modelled)**

- **FR-040**: The database MUST NOT contain structure for the removed instruments and features — old assessments (SELI/InnerCompass), the old Pulse form, Sathi chat, the helpline list, per-attempt login throttling counters, or any of the retired classification bands as values.

**Sign-in and demo accounts**

- **FR-041**: A student MUST be able to sign in with their school-issued login ID (or their email) and a password; an admin, parent or staff member MUST be able to sign in with their email (staff may use their work email) and a password.
- **FR-042**: Only accounts whose status is "active" and that have a password MUST be able to sign in; pending, suspended, locked and deleted accounts, and accounts without a password, MUST be refused.
- **FR-043**: A wrong password and an unknown login MUST produce the same refusal, so a caller cannot tell which was wrong.
- **FR-044**: A successful sign-in MUST record the account's last-sign-in time and issue a time-limited token carrying the account, its role, its email and its school (empty for platform-level accounts).
- **FR-045**: The sign-in lookup MUST run on a separate platform-scope database connection that bypasses row-level security (schema doc §4), limited to reading the account and profile tables and updating the last-sign-in time; the ordinary application connection MUST still be unable to see any account without a school set.
- **FR-046**: One demo school, one admin and one student MUST be creatable by a repeatable step that never creates duplicates, and their credentials MUST be documented.

**Assessment module on the new accounts (added 2026-09-19)**

- **FR-047**: The capability-assessment module (admin item-pool import, participant profile and consent, attempts, responses, scoring, reports) MUST work for signed-in admin and student accounts. Its tables are restored with only the minimum change needed: the three columns that referenced the removed `users` table (`participant_profiles.user_id`, `quality_flags.reviewed_by`, `content_import_records.imported_by`) become UUID foreign keys to `accounts(account_id)`; no other column is added or changed, and none of the doc's 22 tables is altered.
- **FR-048**: The assessment routes MUST authorize by the real account roles: `student` for participant routes, `superuser` for admin routes; the other role MUST be refused (403).
- **FR-049**: The assessment reference content (response scale, both item pools, interpretation rules) MUST be loadable with `npm run db:seed`, and logins with `npm run db:seed:platform`; neither creates or needs the old `users` table.

### Key Entities

- **School**: A tenant. Basic details, contact person, pilot dates, estimated student count, status.
- **Account**: One per person; role, status, contact details, credentials, school (for school-level roles).
- **Student Profile / Staff Profile / Parent Profile**: Role-specific detail attached to an account; the parent profile also lists the linked students.
- **School Assignment**: A staff member's revocable role at a school, optionally for a class.
- **Capability Grant**: An extra, scoped, optionally expiring permission given to one account.
- **Escalation Event**: A safeguarding record for a student with severity and progress to resolution.
- **Counsellor Note**: A sealed private note by a counsellor about a student.
- **Consent Record**: General onboarding parental consent for a student.
- **SCP Consent**: Renewable, per-academic-year parental consent specific to the SCP assessment.
- **SCP Session**: One student's assessment session, with sealed answers, domain results, progress, and any void.
- **SCP Assent**: The student's own agreement (or refusal) for one SCP session.
- **Protocol**: A reviewed intervention procedure with steps, cautions, and version.
- **Protocol Orientation**: A staff member's completion of a protocol's required orientation.
- **Protocol Route Event**: A practitioner routing a student to a protocol.
- **Queue Signal**: An entry in a counsellor's attention queue, optionally suggesting a protocol.
- **Class Guidance State**: A class-level pattern summary with the group size behind it.
- **Content Module**: A piece of learning content targeted by role and school.
- **Module Completion**: A person's completion of a module.
- **Group Session**: A scheduled counsellor-run session, optionally built on a module.
- **Audit Event**: One entry in the consolidated audit trail.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new environment goes from empty to the complete 22-table database in a single step that finishes in under 5 minutes.
- **SC-002**: A side-by-side check of the finished database against the schema document finds 0 missing, extra, or renamed tables or columns.
- **SC-003**: Running the setup step a second time produces 0 errors and 0 changes.
- **SC-004**: 100% of the existing capability-assessment automated tests that passed before the change still pass after it.
- **SC-005**: In a two-school test covering every school-owned area, staff acting for one school see 0 records belonging to the other, both with and without a school filter, across 100% of the areas checked.
- **SC-006**: 100% of deliberately invalid inputs from a defined list — second active principal, school-level account without a school, out-of-range severity, duplicate email/mobile/login ID, duplicate assent for a session, duplicate orientation or completion, invalid review status, permission field allowlist on a non-update action, dangling reference — are refused.
- **SC-007**: After erasing one student in a populated test database, a check of every area finds 0 remaining records about that student.
- **SC-008**: A read-only reporting connection is refused 100% of the time when it tries to read password or reset-token hashes.
- **SC-009**: With 100,000 SCP sessions in the database, finding one student's latest session for a checkpoint takes under 1 second, and listing a school's open escalations takes under 1 second.
- **SC-010**: Every audit record created in a test run of the audited actions carries actor, role, target, outcome, and time — 0 records with any of these missing (school may be empty only for platform-wide actions).
- **SC-011**: 100% of correct credentials for active accounts sign in, and 100% of attempts with a wrong password, unknown login, or an inactive or password-less account are refused (covered by 12 automated sign-in tests).
- **SC-012**: A wrong password and an unknown login return identical responses.
- **SC-013**: The demo admin and the demo student each sign in on the first attempt through the running service.
- **SC-014**: The 9 assessment test suites (23 tests) that passed before this feature pass again, and an admin item-pool import (175 items) and a student's profile, both consents and attempt start succeed through the running service with no server errors.

## Assumptions

- **Additive, not a replacement**: The new database structure is added alongside the existing capability-assessment tables in the same database. Existing tables (identity, participants, consents, attempts, responses, scores, reports, item pools) are untouched, and no data is moved between old and new structures in this feature. No name conflicts exist between the two sets (checked against the existing 001 migration). Whether the two identity models are later unified is a separate decision.
- **Structure only, no data migration**: The Mongo-to-SQL data backfill that the schema document calls "a separate, later piece of work" is out of scope. No seed data is included beyond what is needed to verify the structure; creating the first platform administrator is part of a later authentication/onboarding feature.
- **Database engine**: The schema document targets PostgreSQL and relies on its native lists, structured-value columns, row-level security, and column-level permissions; the existing project already runs PostgreSQL, so this is treated as fixed.
- **Sealing is done by the application**: The database stores already-sealed values for counsellor notes and SCP item responses. The envelope-encryption scheme itself, and the re-sealing of any imported data, are outside this feature.
- **Student links in the parent list are not database-enforced**: A list column cannot enforce per-element references, so validity of linked student IDs is checked by the application when writing, or by periodic consistency checks. Per-link revocation history is not kept in this table; it would be written to the audit trail if needed. This trade-off is accepted per the schema document ("Pass four").
- **Where the schema document's diagram and SQL disagree, the diagram's stated intent wins**: (1) queue signals carry their own school reference, as the diagram shows and tenant isolation requires; (2) accounts carry a deletion time for soft-delete/erasure, as the diagram shows and the "deleted" status implies; (3) SCP assents are unique per session, as the diagram states ("one assent per session"). These three additions are included in this feature.
- **School ownership for tenant isolation**: Areas with a direct school reference are filtered on it. Areas that describe a specific student but hold no school reference of their own (student profiles, SCP sessions, SCP assents, counsellor notes, protocol routing, module completions) are scoped through the owning student's school.
- **Rate limiting, helpline lists, and the removed instruments** stay out, exactly as the schema document specifies (see FR-040).
- **Volume**: The pilot's scale (a handful of schools, thousands of students) is the working assumption; partitioning and other large-volume tuning noted in the schema document are deferred until volume justifies them.
- **Dependency**: `docs/SQL-Database-Schema.md` is authoritative and is assumed complete and current as of this spec's date; the release-scope document it cites (`docs/santulan_release_scope.pdf`) is not in the repository and was not re-read.
- **Sign-in scope**: The login service and login screen were rewritten for `accounts`. The assessment routes' role guards were updated to the real account roles (`student`, `superuser`), which fixed "Insufficient role for this operation". The assessment module itself keeps its own logic and its own 15 tables (restored by migration `007`); its references to people now point at `accounts`.
- **Roles that have a screen**: The screens exist for two roles, so `superuser` maps to the admin screen and `student` to the student screen. Other active accounts (parent, counsellor, principal, teacher, support) can authenticate but have no screen yet.
- **Demo credentials are development-only**: The demo accounts use the default password `ChangeMe123!`, the same default the earlier seeder used. They must be changed or removed before any real use.
- **Platform connection role**: `app_platform` (login-lookup only) is created outside the migrations because roles are cluster-level; it is provisioned by the Docker init script for a new database and once by hand for an existing one.
- **Assessment module and the doc**: The doc's schema has no question bank, attempt, scoring or report tables, so the assessment module cannot live inside the doc's 22 tables. Its 15 tables are kept as a separate group next to them. This deliberately departs from "strictly the doc's tables" because the requester asked for the module's failures to be fixed; the requester also allowed adding columns "with minimum changes", and none was needed beyond retyping the three `users` references.
- **Test accounts**: The assessment test suites create student and admin accounts (email `...@test.local`) in `accounts`, as they created rows in `users` before. They are not cleaned up automatically.
