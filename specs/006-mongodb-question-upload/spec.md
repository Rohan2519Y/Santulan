# Feature Specification: Document Database Only Platform and Spreadsheet Question Upload

**Feature Branch**: `006-mongodb-question-upload`

**Created**: 2026-09-20

**Status**: Draft (clarified 2026-09-20: scope, upload format and carried-over work confirmed by the owner; scoring and report generation aligned to the Scoring & Report Generation master on 2026-09-20)

**Input**: User description: "i want to change the database to the nosql i mean i want to use the mongodb and i want to upload the questions from this type of excel F:\Santulan\docs\Santulan_Sample_Questions.xlsx and feilds remains same but options can be low or high and read this folder also F:\Santulan\docs\Santulan 2.0\implementation files" — then: "i want to remove the sql completely and change it to nosql and the other thing is i want to upload the questions at that format and replace by the current excel format and which works are undone that work we will do by implement command later"

## Background

The platform's data currently lives in a relational database (a fixed set of 28 tables). Its assessment questions come from a frozen catalog of 346 questions loaded from source workbooks, all answered on one shared 5-point scale. There is no working way for an administrator to bring in their own questions: the old upload route was removed with the previous schema.

The owner has decided three things:

1. **Remove SQL completely.** The platform's data moves to a document database (MongoDB) and no relational database is needed to run, test, back up or deploy the platform.
2. **Questions come from a spreadsheet in the new sample format** (`Santulan_Sample_Questions.xlsx`: one sheet, one question per row, the same question fields as before, plus answer-option columns where a question may have few or many options). This format **replaces** the current Excel import format.
3. **Everything still undone** in the previous feature (feature 005: admin and research operations, security and quality evidence, final polish) is carried into this feature so it can be built later with the implement command, on the new store.

The implementation reference documents in `docs/Santulan 2.0/implementation files` (the RC0 handover guide, the master implementation runbook, the qualification and control registers) were read. They describe the protections the platform must keep regardless of storage: answers, scores, report snapshots and audit history are never edited or deleted; participants see only their own data; everything is closed by default; every privileged action is audited; and release stays NO-GO until staged evidence exists. They are written around the relational store, so each protection must be re-established on the new store and proven again.

The **Scoring & Report Generation master** (`docs/Santulan_Scoring_and_Report_Generation_Layman_Master_Audit_ON_v1_0.docx`, RC0-aligned) was also read. It states exactly how an answer becomes a domain score, how quality flags and evidence states control what may be said, and how a report is built and released. This specification adopts it as the behavioural contract for scoring and reporting (User Story 8; FR-042 to FR-058) and records, in Assumptions A-14 to A-17, where it differs from earlier build documents. Its own handover rule applies: where code and document disagree, raise the discrepancy instead of choosing the easier reading.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The whole platform runs on the document database and SQL is gone (Priority: P1)

An owner, admin and participant use the platform exactly as before: register, give consent, answer questions, submit, receive a report; the admin manages institutions and participation and exports research data. Nothing visible changes, every protection still holds, and no relational database is installed, configured, referenced or required anywhere.

**Why this priority**: The move is only acceptable if it does not weaken the safeguards for participants, many of whom are minors. A broken guarantee blocks everything else.

**Independent Test**: On a machine with no relational database installed, run the full journey (registration → consent → answer → submit → score → report → admin export), then run the guarantee checks (immutability, uniqueness, isolation, atomic steps, audit) and confirm every one passes.

**Acceptance Scenarios**:

1. **Given** a machine with only the document database installed, **When** the platform is set up and started, **Then** it works end to end and never asks for a relational database.
2. **Given** a participant with verified consent, **When** they complete an assessment, **Then** results and report appear as they do today.
3. **Given** an answer that has been saved, **When** anyone (including an administrator) tries to edit or delete it, **Then** the attempt is refused and the answer is unchanged.
4. **Given** two participants, **When** one asks for the other's attempt, report or answers, **Then** access is denied.
5. **Given** 40 participants saving answers at the same time, **When** they finish, **Then** no answer is lost or duplicated.
6. **Given** the audit record cannot be saved during a privileged action, **When** the action runs, **Then** the action fails and nothing changes.
7. **Given** the repository after the move, **When** it is searched for the relational database's schema scripts, role set-up, dump/restore tooling and driver dependency, **Then** none remain in use.

---

### User Story 2 - Bring questions in from a spreadsheet in the new format (Priority: P1)

A Super Admin prepares questions in a spreadsheet using the sample layout and uploads it on the admin page, choosing which age group the set is for. The system checks the whole file first. If every row is valid, the questions are saved together as a new draft question set for review. If anything is wrong, nothing is saved and every problem is shown with its row and column. This is the only way questions enter the platform; the previous workbook-based import is retired.

**Why this priority**: This is the capability the owner cannot do today and the reason for the request; it also replaces how the current question bank is produced.

**Independent Test**: Upload the sample spreadsheet and confirm a draft set with the same number of questions and options appears for review; upload a copy with deliberate mistakes and confirm nothing is saved and every mistake is listed.

**Acceptance Scenarios**:

1. **Given** a valid spreadsheet of 10 questions and the age group chosen, **When** the admin uploads it, **Then** a draft set of 10 questions is created, each showing its options in sheet order, and the admin is told how many questions and options were accepted.
2. **Given** a spreadsheet where row 4 has an unknown domain code and row 7 repeats an earlier question code, **When** uploaded, **Then** nothing is saved and both problems are listed with row and column.
3. **Given** the same valid file uploaded twice, **When** the second upload runs, **Then** it is recognised as identical and no duplicate set is created.
4. **Given** a person who is not an active Super Admin, **When** they try to upload, **Then** it is refused.
5. **Given** a file in the old workbook format (13 columns, no options), **When** uploaded, **Then** it is rejected with a message that names the new format and offers the blank template.
6. **Given** a successful upload, **When** the audit history is viewed, **Then** it shows who uploaded, when, which file, and how many questions were accepted.

---

### User Story 3 - Questions with few or many options can be answered and scored (Priority: P1)

Questions in one set can have different numbers of options: some with 2 or 3, some with 5, some with 8 or more. A participant sees exactly that question's options in the admin's order and chooses one; the system accepts only one of that question's own options. Every answer counts toward the domain result on the platform's common 1–5 scale according to its position among that question's options.

**Why this priority**: Variable options are the owner's stated difference from today's fixed scale; uploaded questions are only useful if they can be answered and counted.

**Independent Test**: Publish a draft set with a 2-option, a 5-option and a 9-option question to a test participant, answer them, and confirm options display in order, an out-of-range answer is refused, and the scores produced follow the rule in FR-014.

**Acceptance Scenarios**:

1. **Given** a question with 3 options, **When** the participant opens it, **Then** exactly 3 options are shown in uploaded order.
2. **Given** a question with 9 options, **When** the participant opens it, **Then** all 9 are shown and one can be selected.
3. **Given** a request that answers a 3-option question with a 5th option, **When** it arrives, **Then** it is refused and nothing is stored.
4. **Given** a participant who changes their answer, **When** they choose another option, **Then** the earlier answer is kept as history and the new one becomes current.
5. **Given** a question whose options are chosen by position (first, middle, last of 3), **When** scored, **Then** they count as 1, 3 and 5 respectively; for a 5-option question the counts are exactly 1 to 5.

---

### User Story 4 - Review, freeze and open an uploaded set (Priority: P2)

An uploaded set starts as a draft no participant can see. The admin reviews it, freezes it (its questions and options can never be changed afterwards) and separately opens it for participation. To change a frozen set, the admin uploads a new version. Each step is audited, and the previous frozen catalog no longer needs to be preloaded because uploads populate the question bank.

**Why this priority**: It keeps "closed by default; never overwrite what participants answered" intact for uploaded questions, but the upload itself is useful first.

**Independent Test**: Upload a set, confirm a participant cannot reach it; freeze it, confirm editing is refused; open it, confirm a participant can start it; stop participation, confirm new starts are refused while existing answers are untouched.

**Acceptance Scenarios**:

1. **Given** a draft set, **When** a participant tries to start an assessment, **Then** the draft is never offered.
2. **Given** a frozen set, **When** anyone attempts to change a question or option, **Then** the change is refused.
3. **Given** a frozen set with participant answers, **When** the admin uploads a corrected file with the same version label, **Then** it is refused; a new version label is required.
4. **Given** an opened set, **When** the admin stops participation, **Then** new starts are blocked and existing answers are unchanged.
5. **Given** a participant mid-attempt, **When** a newer set is uploaded and opened, **Then** their attempt keeps the exact set it began with.

---

### User Story 5 - Admin operations and research export on the new store (Priority: P2)

*Carried over from feature 005 (tasks T136–T155), not yet built.* A Super Admin manages institutions and cohorts, searches and suspends or reactivates participants with a recorded reason, pauses, stops or reopens new participation, watches operational counts, reviews quality flags, and reads a read-only audit log. They request a research export with filters, watch it move from requested to ready, and download it. Every privileged action is audited, and an action whose audit cannot be saved does not happen.

**Why this priority**: It is required for the platform to be operable and for research use, but it depends on the store and question bank being in place.

**Independent Test**: Stop participation and confirm new attempts are refused while existing data is unchanged; reopen and confirm new attempts work; request an export for one institution and confirm every sheet contains only that institution and no direct identifiers.

**Acceptance Scenarios**:

1. **Given** an active Super Admin, **When** they stop participation with a reason, **Then** new attempts are blocked, existing attempts and frozen question sets are untouched, and the audit log records actor, action, previous and new state, reason and time.
2. **Given** a suspended admin or a non-admin, **When** they call any admin function, **Then** it is refused.
3. **Given** an attempt to make an institution-admin or research-operator role active during the pilot, **When** it is saved, **Then** it is rejected.
4. **Given** an institution filter on an export, **When** the export is produced, **Then** every participant-derived sheet contains only that institution's participants.
5. **Given** an export request with an unknown filter or no anonymisation version, **When** submitted, **Then** it is rejected.
6. **Given** an export of 10,000 participants × 222 answers, **When** produced, **Then** the answer rows are split across as many worksheets as needed so none exceeds the spreadsheet row limit and no row is lost or repeated.
7. **Given** a failure while an export is being produced, **When** it happens, **Then** the export is marked failed and no partial file can be downloaded.
8. **Given** a ready export, **When** it is downloaded, **Then** the download itself is audited, and if the audit cannot be saved the download is refused.

---

### User Story 6 - Security, isolation and launch evidence on the new store (Priority: P2)

*Carried over from feature 005 (tasks T156–T166), not yet built.* The platform proves that participants and institutions cannot see each other's data, that open registration resists abuse, that reports and exports make none of the prohibited claims, that a backup can actually be restored, and that every acceptance, resilience and security test is registered with real evidence. Launch stays NO-GO until the required evidence exists and the governance gates are closed by their owners.

**Why this priority**: Because participants include minors and the storage engine changes, security evidence must be regenerated before any launch decision.

**Independent Test**: Seed two institutions plus open participants; confirm each sees only its own data, including when a request tries to name another identity; back up, restore into a clean system, and confirm the checks still pass; run the evidence register check.

**Acceptance Scenarios**:

1. **Given** participants and admins of two institutions, **When** each queries the platform, **Then** each sees only their own institution's data and open participants see only their own.
2. **Given** a request that tries to supply its own identity or scope, **When** it arrives, **Then** the supplied values are ignored.
3. **Given** many open registrations from one address or one device in a short time, **When** the limit is reached, **Then** further attempts are throttled, ordinary registration is not blocked, and institutional sign-in is not throttled.
4. **Given** a report, export or API response, **When** it is scanned, **Then** it contains no diagnosis, Low/Average/High band, percentile, norm, reliable-change claim, subdomain score or personality typing.
5. **Given** a backup, **When** it is restored into a clean system, **Then** counts, protections and end-to-end journeys all pass.
6. **Given** the evidence register, **When** checked, **Then** every required acceptance, resilience and security test has an entry, none is marked passed without evidence, and staged-only items read "not executed" until real evidence is supplied.

---

### User Story 7 - Clean set-up, complete documentation and no leftovers (Priority: P3)

*Carried over from feature 005 (tasks T167–T173), plus the new clean-up.* An owner follows one guide to install the document database, start the platform, load reference content, sign in with synthetic test accounts and upload the sample spreadsheet. The documentation, flow diagram and operator notes describe the new store; every documented scenario is actually executed once and its result recorded; dead code and documents that refer to the relational store are removed or marked historical. An optional helper converts the existing 346-question catalog into the new spreadsheet format so nothing needs retyping if the owner wants to keep those questions.

**Why this priority**: It closes the work and makes the change repeatable, but end users do not see it.

**Independent Test**: Follow the guide on a fresh machine; upload the sample sheet; run the documented scenarios; confirm every command and expectation in the documents is correct.

**Acceptance Scenarios**:

1. **Given** a fresh machine, **When** the guide is followed, **Then** the platform is running with the sample questions uploaded.
2. **Given** the existing catalog, **When** the conversion helper runs, **Then** it produces a spreadsheet in the new format that uploads cleanly, with 175 and 171 questions and the 5-point options.
3. **Given** the documents, **When** they are searched, **Then** none instructs the reader to use the relational database except where marked historical.
4. **Given** a scan of the repository, **When** it looks for real-looking participant data or third-party tracking, **Then** none is found.

---

### User Story 8 - Scores and reports follow the approved scoring master exactly (Priority: P1)

A participant submits an assessment. The platform checks quality first, then works out one score for each of the seven domains from the participant's current valid answers, decides separately how much may be said about each score, and only then builds a report from approved, versioned wording. Nothing is guessed: a missing answer is never filled in, an unapproved wording is never invented, and a report failure never forces a retake.

**Why this priority**: Scoring and reporting are what participants receive. A rule error here is a scientific and safety error, and the new variable-option answers must not weaken any rule. (Numbered 8 to keep earlier story references stable; it is as important as the P1 stories above.)

**Independent Test**: Score known answer sets at 100 %, 90 %, 80 % and 60 % completeness and confirm status and score exactly as the boundary table in FR-045; repeat with the pilot-S2 release off and on; force a report failure and retry it; confirm every acceptance scenario below.

**Acceptance Scenarios**:

1. **Given** a domain with 8 eligible questions answered 4, 4, 3, 5, 4, 3, 4, 5, **When** scored, **Then** the domain score is exactly 4.00, completeness is 100 % and the status is COMPLETE.
2. **Given** 10 eligible questions with 9 answered (10 % missing), **When** scored, **Then** the status is COMPLETE_WITH_MISSING and the score is the average of the 9 answered ones; the missing answer is not replaced by any value.
3. **Given** 8 of 10 answered (exactly 20 % missing, 80 % complete), **When** scored, **Then** the status is INCOMPLETE, the score is kept for research only, no participant-facing interpretation is produced, and a missingness review flag is raised.
4. **Given** 6 of 10 answered (40 % missing, 60 % complete), **When** scored, **Then** the status is INSUFFICIENT, there is no domain score, and the report shows "Not enough data yet" for that domain, never a low score.
5. **Given** an answer that was changed after it was first saved, **When** scored, **Then** only the current answer counts and the earlier one stays stored and auditable.
6. **Given** a current answer that belongs to a question from a different question set, **When** scoring starts, **Then** it stops, the attempt is held, and the participant sees only the neutral "Your responses are being reviewed." message.
7. **Given** the pilot-S2 release is off, **When** a domain is scored, **Then** its evidence state is S1 (research only) and the report makes no capability conclusion for it.
8. **Given** the pilot-S2 release is on, a domain above 80 % completeness, and exactly one approved wording for that domain, age stage, evidence state, language and layer, **When** the report is built, **Then** that wording is stored as the report snapshot; **Given** no approved wording exists, **Then** report generation fails closed (retryable) and no text is invented; **Given** two approved wordings for the same combination, **Then** the second cannot be approved.
9. **Given** report generation fails part-way, **When** the participant asks for the report, **Then** nothing partial is shown, the attempt stays scored, and a controlled retry rebuilds it from the same frozen inputs with no retake and no re-scoring.
10. **Given** a quality hold for any reason (including a safeguarding trigger), **When** the report is requested, **Then** the participant sees the same neutral message every time; an invalid attempt shows the neutral "could not be processed" message; a low score alone never creates a safeguarding flag, counselling or specialist referral.
11. **Given** a participant asks for scores before their report is ready, **When** the request arrives, **Then** no score is returned; scores reach a participant only inside their released report.

---

### Edge Cases

- The file is not a spreadsheet, is empty, is over the size limit, or has no recognisable question sheet: rejected with a clear message and nothing saved.
- A required column is missing or misspelled in the header row: rejected, naming the column.
- The sheet has extra columns the system does not know: reported as a warning and ignored, never used.
- A question has fewer than 2 options, or two identical options: rejected with its row.
- An option cell in the middle of a row is blank: the blank is skipped and the remaining options keep left-to-right order (a question left with fewer than 2 options is rejected).
- The file's `age_band` values do not fit the age group the admin selected (for example, an 18–25 question in a 13–17 set): rejected with its row.
- Text that starts with a spreadsheet formula marker (`=`, `+`, `-`, `@`) or contains markup: stored and shown as plain text, and neutralised whenever exported again.
- Special characters (for example the en dash in `13–17`) are preserved exactly.
- Two admins upload the same version label at the same moment: exactly one draft results and the other is told it already exists.
- The connection drops or the database is unavailable during an upload, submit, report or export: nothing partial is saved, and retrying is safe.
- A response is submitted for a question that belongs to a different set than the attempt's set: refused and flagged as a version mismatch.
- A question code repeats across two different sets: allowed, because question identity is scoped to its set.
- The document database is briefly unreachable: the platform refuses new work rather than guessing, and recovers when it returns.
- A participant answers a question whose option count is unusual (2 or 20): the same rules apply.
- A withdrawn participant appears in an export request: excluded by default until an approved protocol says otherwise.
- A domain has every answer valid but its evidence state is S1: the score exists for research, and the report shows no capability conclusion for it.
- Completeness is exactly 80 % or exactly 60 %: the boundary rules of FR-045 apply exactly (80 % is INCOMPLETE, 60 % is INSUFFICIENT).
- The pilot-S2 release is switched on while a domain has no approved wording: reports for that domain fail closed and stay retryable until content is approved; nothing is invented.
- Approved wording is edited or replaced after a report was issued: the issued report is unchanged; only new reports use the new wording.
- A participant repeats the assessment: the later report may show a descriptive "change" layer only; no improvement claim is made.
- A question set has a domain with no eligible question: it cannot be frozen, so scoring can never be asked to divide by zero.

## Requirements *(mandatory)*

### Functional Requirements

**Data store — SQL removed completely**

- **FR-001**: The platform MUST keep all of its data (participants, consents, question sets and questions, attempts, sessions, answers, quality flags, scores, reports, growth plans, pathways, institutions, cohorts, admin users, research exports, audit history, and the development-account credentials used for local sign-in) in the MongoDB document database chosen by the owner.
- **FR-002**: The platform MUST run, be tested, be backed up and be restored with no relational database installed. No relational schema scripts, role set-up, dump/restore tooling, database driver dependency or container definition for a relational database may remain in use.
- **FR-003**: Existing behaviour MUST NOT change for participants and admins: the same screens, the same age routing (13–17 adolescent, 18–25 emerging adult; age 18 is always emerging adult), consent and assent gates, sessions (four per attempt), submission, scoring, reports, growth plans, pathways and safeguarding.

**Guarantees that must hold on the new store** (each verified by a test that fails if the guarantee is broken)

- **FR-004 Immutability**: Saved answers, scores, report snapshots and audit entries MUST NOT be edited or deleted by any role, including administrators. A corrected answer adds a new version; exactly one answer is current per attempt and question. Frozen question sets, options and report content are never changed in place.
- **FR-005 Uniqueness**: The store MUST refuse duplicates of: a participant's Santulan ID, an open attempt per participant, a current answer per attempt and question, a verified consent per type and protocol, a report per attempt, an external student ID within an institution, a question code within a set, and the answer and submission retry keys that make retries safe.
- **FR-006 Isolation**: A participant MUST see only their own attempts, answers, results and reports. Another participant's data, admin data and audit data MUST be inaccessible to them, and with no valid identity nothing is returned. Identity and scope always come from the verified session, never from what a request claims.
- **FR-007 Atomic steps**: Multi-part actions (submitting an attempt, completing a report, changing consent state, recording a safeguarding pathway and pausing plans, uploading a question set, freezing a set, generating an export) MUST either fully succeed or leave no trace.
- **FR-008 Fail closed**: If the audit record cannot be saved, or a rule cannot be confirmed, the action MUST fail and change nothing. Release defaults stay closed: new question sets are draft, participation is closed, prescriptive report content is hidden, advanced evidence states are off.
- **FR-009 Protection of dependent data**: Anything that answers, scores or reports depend on MUST NOT be deletable; institutions, cohorts and question sets are retired by status only.
- **FR-010 Privacy**: No names, dates of birth, contact details or passwords are added to stored participant data; roster details are used only to validate and are discarded; research exports exclude direct identifiers.

**Question upload (new format; the old workbook format is retired)**

- **FR-011 Format**: An active Super Admin MUST be able to upload a spreadsheet (`.xlsx`, single question sheet, single header row, one question per row) with these fields unchanged: question code, version label, domain code, domain name, subdomain code, subdomain name, question text, keying, age band, context, layer, status, display order — plus option columns `option_1`, `option_2`, … for as many options as the question needs. The old 13-column workbook without options MUST be rejected.
- **FR-012 Age group**: The admin MUST choose the age group (adolescent 13–17 or emerging adult 18–25) when uploading; each row's age band MUST fit that group (13–17 or 13–25 for adolescent; 18–25 or 13–25 for emerging adult).
- **FR-013 All-or-nothing validation**: The whole file MUST be checked before anything is saved. Every problem MUST be reported with its row and column in one pass; if any row is invalid, no question is saved.
- **FR-014 Scoring of variable options**: Each answer MUST count toward its domain on the common 1–5 scale according to the chosen option's position among that question's options, evenly spaced from 1 (first option) to 5 (last option); a question with exactly 5 options MUST reproduce the current 1–5 result exactly; a question with 2 options counts as 1 or 5. Keying stays positive. How those counted values become a domain result, and what may be said about it, is fixed by FR-042 to FR-058.
- **FR-015 Option rules**: Each question MUST have at least 2 and at most 20 options; blank option cells are skipped; options within a question MUST be distinct; option order is the sheet's left-to-right order and MUST be preserved exactly; option text is plain text.
- **FR-016 Field rules**: Domain and subdomain codes and names MUST match the seven-domain, 72-subdomain framework; question codes MUST be unique within a set; keying, age band, context, layer and status MUST use the allowed values; display order MUST be a positive whole number unique within the set; question text is limited to 500 characters; a file is limited to 2 MB and 500 questions.
- **FR-017 Result of an upload**: A successful upload MUST create a **draft** question set that no participant can reach and show the admin the number of questions and options accepted; re-uploading identical content MUST NOT create a duplicate; uploading different content for an existing draft label replaces that draft and is audited; a frozen label is refused.
- **FR-018 Freeze and release**: A draft set MUST be reviewable, then frozen (no change to any question or option) and separately opened for participation; each step is audited; stopping participation never alters a set. Changing a frozen set requires a new version label.
- **FR-019 Answering**: A participant MUST see exactly the options of the question they are on, in order, and the system MUST accept only one of them; anything else MUST be refused with nothing stored.
- **FR-020 Traceability**: Every attempt, answer and result MUST record the exact question set version it used, so results can be reproduced later even after new sets are uploaded.
- **FR-021 Template and conversion**: The admin page MUST offer a downloadable blank template in the accepted layout, and a helper MUST be able to convert the existing 346-question catalog into that layout for optional re-upload.
- **FR-022 Audit of uploads**: Every upload, rejected upload, freeze, open and stop MUST be recorded with who, when, file name and fingerprint, and outcome, without participant data.
- **FR-023 Retired catalog pipeline**: The previous workbook-to-database catalog import, its reconcile tooling and its frozen seed are retired; no question is preloaded, and the platform ships with an empty question bank until a set is uploaded and opened. The response scale is a per-question property, not a fixed platform rule.

**Admin operations and research** *(carried over: feature 005 T136–T155)*

- **FR-024 Role model**: Only the Super Admin role is active during the pilot; institution-admin and research-operator roles can exist as reserved but MUST NOT be saved as active. Every admin function requires an active Super Admin re-checked on each request.
- **FR-025 Participation control**: The admin MUST be able to pause, stop and reopen new participation with a required reason (except reopen), without touching existing attempts or question sets; every change is audited and fails closed.
- **FR-026 Institutions and participants**: The admin MUST be able to create, update, change the status of and archive institutions and cohorts (with a parent hierarchy for departments), search and filter participants by route, institution, cohort and status, and suspend or reactivate a participant with a required reason. Nothing is ever deleted; unknown filter keys are rejected; secrets are never shown.
- **FR-027 Monitoring and quality review**: The admin MUST see operational counts only (participants, attempts, reports and retry queue, exports, quality-review queue) with no invented thresholds, labels or performance claims, and MUST be able to record a disposition and note on a quality flag; safeguarding evidence is shown only to the minimum necessary.
- **FR-028 Audit log**: The admin MUST have a read-only audit log filterable by actor, action, target and date.
- **FR-029 Question bank administration**: The admin MUST have one page to upload, review, freeze, open and stop question sets, and to see each set's status, age group, counts and fingerprint (this replaces the old item-pool page).
- **FR-030 Research export lifecycle**: An export MUST be requested with filters, a required anonymisation version and a source question set; it moves only from requested to generating to ready or failed; only one worker may take a requested export; ready and failed cannot both happen; download is allowed only when ready and is audited; a request repeated after a timeout does not create a second export.
- **FR-031 Research workbook**: The export MUST be one workbook with fixed sheet names in this order: README, DATA_DICTIONARY, PARTICIPANTS, ATTEMPTS, ITEM_RESPONSES_01…N, DOMAIN_SCORES, QUALITY_FLAGS, RESPONSE_EVENTS, ASSESSMENT_VERSION, COHORT_METADATA, EXPORT_METADATA; answer rows are split into as many worksheets as needed based on the actual row count so none exceeds the spreadsheet row limit; quality flags stay separate and never alter an answer; text starting with a formula marker is neutralised; long text is bounded; the export states whether it holds all answer versions or current ones only and records every applied filter.
- **FR-032 Research identity minimisation**: By default the export MUST include the research-safe participant code, institution and cohort context, age band, education stage and route, and MUST exclude the private participant id, sign-in references, external student id, contact details and guardian identity; safeguarding flags are not exported; a withdrawn participant is excluded unless an approved protocol says otherwise.
- **FR-033 Filter consistency**: An institution or cohort filter MUST be applied to every participant-derived sheet, not only the participants sheet; omitting the filter is explicit global Super Admin behaviour.

**Security, resilience and evidence** *(carried over: feature 005 T156–T166)*

- **FR-034 Abuse protection**: Open registration and one-time sign-in codes MUST be throttled per address and per device with limits that come from configuration; the two limits are distinct; institutional sign-in and roster import are not subject to the open-registration limit.
- **FR-035 Claims scan**: An automated scan MUST find no diagnosis or clinical inference, Low/Average/High bands, percentile or norm, reliable-change or improvement claim, subdomain score or personality typing in reports, exports or participant-facing responses.
- **FR-036 Isolation evidence**: Tests MUST prove participant and institution isolation, that a request's own identity or scope claims are ignored, and that no context yields nothing.
- **FR-037 Backup and restore**: A drill MUST back up the platform's data, restore it into a clean system and re-run integrity, isolation and end-to-end checks, writing an evidence file; a release manifest MUST record fingerprints of configuration, question sets and application version.
- **FR-038 Evidence register**: A register MUST hold an entry for each of the 32 acceptance tests, 12 resilience tests and 29 security tests (SEC-15 not applicable); nothing is marked passed without evidence; staged-only items read "not executed"; the ten launch gates are listed with owners and remain not executed until closed; launch stays NO-GO.
- **FR-039 Evidence reset**: All qualification evidence gathered against the relational store MUST be treated as not applying to the new store until re-run.

**Polish and clean-up** *(carried over: feature 005 T167–T173)*

- **FR-040 Documentation**: The README, flow diagram, operator security notes and quick-start scenarios MUST describe the new store; every documented scenario MUST be executed once and its result recorded, correcting any wrong command.
- **FR-041 Clean-up**: Dead code and documents that depend on the relational store or the removed old schema MUST be removed or marked historical; a review against the project constitution MUST confirm no prohibited claim, client-supplied score or version, or weakened protection remains.

**Scoring, evidence and report generation** *(source: Scoring & Report Generation master; scoring for variable options: FR-014)*

- **FR-042 Scoring trigger**: Scoring MUST run only on a submitted attempt, only on the server, and never from a score sent by a participant device. Before scoring it MUST confirm the attempt's question set is frozen and consistent with the attempt, and MUST run the quality check first.
- **FR-043 Eligible questions**: A question counts in a domain only when it belongs to the attempt's frozen question set, is active, is a core question, belongs to that domain, and is eligible for the participant's age group and context. Each domain's denominator MUST come from these questions, never from a flat total.
- **FR-044 Current answers only**: Only the current valid answer for each eligible question counts. Earlier versions of an answer stay stored and auditable and never count.
- **FR-045 Completeness and status**: For each domain, completeness is valid answered questions divided by eligible questions. The status MUST follow exactly:

  | Completeness | Missing | Status | Domain score | Participant interpretation |
  |--------------|---------|--------|--------------|----------------------------|
  | 100 % | 0 % | COMPLETE | yes | only if the evidence state permits |
  | above 80 % and below 100 % | above 0 % and below 20 % | COMPLETE_WITH_MISSING | yes, from the answers given | only if the evidence state permits |
  | above 60 % and up to 80 % | 20 % up to below 40 % | INCOMPLETE | kept for research only | none |
  | 60 % or less | 40 % or more | INSUFFICIENT | none | none |

- **FR-046 No imputation**: The domain score MUST be the arithmetic mean of the counted values (FR-014), rounded to two decimals for storage. A missing answer MUST NOT be replaced by 3, the domain mean, a median or any other value. Raw answers are never altered.
- **FR-047 Stored result**: For each of the seven domains the platform MUST store the score (or none), the number of eligible and of valid answered questions, completeness, completeness status, evidence state and the scoring version. A stored result is immutable; a new scoring version adds new results and never overwrites.
- **FR-048 Keying**: Only positively keyed questions are scored. A reverse-keyed question MUST make scoring fail closed until an approved transform exists.
- **FR-049 Evidence state**: The evidence state is decided separately from the score: S0 no score; S1 research only; S2 cautious developmental feedback; S3 operational descriptive; S4 norm-referenced; S5 longitudinal change; SH interpretation held. The default is S1. A domain becomes S2 only when the pilot-S2 release is approved (FR-057), its completeness is above 80 %, and it is not held; S3 to S5 need the advanced-evidence release; an INSUFFICIENT domain is S0.
- **FR-050 Held constructs and subdomains**: Self-Worth (C4.2) and Savoring (C2.10) interpretations are held. Their answers still count in their domain average. Subdomain values MUST never be shown to participants as validated subscales; they may exist only in a research-only view.
- **FR-051 Quality flags**: Quality flags Q01 to Q09 are review signals, never scores, and never rewrite an answer. Q06 (question from another set) hard-stops scoring and holds the attempt. Q07 (missingness) MUST be raised for every domain that is INCOMPLETE or INSUFFICIENT. Q09 (safeguarding) comes only from an approved external trigger, holds the attempt, is never derived from a score, and never becomes a number. Q01–Q04 and Q08 need governed thresholds and processes that are not defined, so they are not invented; Q05 stays inactive until its protocol is supplied (A-15).
- **FR-052 No score-only escalation**: A low score alone MUST NEVER create a safeguarding flag, a counselling route or a specialist referral.
- **FR-053 Report lifecycle**: Report generation is separate from scoring and submitting. Only a scored attempt begins a pending report; on success all required snapshots are stored, the report becomes ready and the attempt becomes report-ready together. On failure the attempt stays scored, no partial content is kept or shown, and a controlled, audited retry rebuilds the report from the same frozen inputs with no retake and no re-scoring. A held attempt gets a terminal "under review" report and an invalid attempt a terminal "not eligible" report, each with one fixed neutral message that never varies by reason.
- **FR-054 Report composition**: The descriptive layers released at launch are: profile (a seven-axis chart on the 1.00 to 5.00 scale plus each plotted domain's neutral score with its completeness status and percentage; an unplotted domain is shown as "Not enough data yet" and never as a low score; no benchmark), meaning, pattern, strength, growth and change (descriptive only). The prescriptive layers (priority, action, growth plan and pathways P1–P4) are generated and stored but hidden until their release is approved; the protected safeguarding route P5 never depends on that release.
- **FR-055 Controlled wording**: Report wording MUST come only from approved, versioned controlled content matched exactly on question set, domain, age stage (a stage-specific wording wins over a general one), evidence state, language and layer. For any domain at evidence state S2 or higher, exactly one approved wording MUST exist or report generation MUST fail closed and stay retryable. Two approved wordings for the same combination MUST be impossible. Domains at S0, S1 or held get no capability interpretation. The engine MUST NEVER invent wording.
- **FR-056 Immutable snapshots**: Every displayed section MUST be stored exactly as shown with its content version and language, and MUST NOT be regenerated from later-edited wording. The report MUST carry a fingerprint of its ordered sections; the same frozen inputs and content versions MUST reproduce identical snapshots and the same fingerprint.
- **FR-057 Release switches**: Four switches — pilot-S2, advanced evidence, development release and pathway release — MUST all default to OFF. Each MUST be changeable only by an active Super Admin with a recorded reason, take effect without a new deployment, be audited (a change whose audit cannot be saved does not happen), and never be controlled by a frontend-only toggle.
- **FR-058 Participant exposure**: A participant MUST receive no raw or research score except inside their own released report. Reports, exports and participant responses MUST contain no subdomain scores, Low/Average/High labels, percentile or norm lines, reliable-change or improvement claims, and no diagnostic or personality inference (including any inference about attention disorders or intelligence from the executive-capability domain), and MUST NOT describe resilience as toughness or silent endurance.

### Key Entities

- **Question Set**: A named, versioned collection of questions for one age group. Draft, frozen or retired, and separately closed or open for participation. Once frozen it is never changed.
- **Question**: One item in a set: code, domain, subdomain, text, keying, age band, context, layer, status, display order and its own ordered options. Identified by its set plus its code.
- **Answer Option**: One choice offered for a question: its text and position.
- **Answer (Response)**: A participant's chosen option for one question in one attempt. Never edited; a change adds a new version.
- **Upload Record**: The audited trail of one upload: who, when, file name and fingerprint, age group, counts accepted, outcome and reasons.
- **Research Export**: A requested, filtered, versioned workbook with a lifecycle state and audit trail.
- **Domain Result**: One immutable result per domain per scoring version: score or none, eligible and valid counts, completeness, completeness status, evidence state.
- **Quality Flag**: A review signal (Q01–Q09) attached to an attempt, separate from answers; only its review fields change.
- **Report and Report Section**: One report per attempt with a lifecycle state, a content fingerprint and immutable, exactly-as-shown sections; release visibility is the only thing that may change on a section.
- **Controlled Wording**: Approved, versioned interpretation text for one question set, domain, age stage, evidence state, language and layer; at most one approved per combination.
- **Release Switch**: One of the four governed ON/OFF decisions (pilot-S2, advanced evidence, development release, pathway release), audited and OFF by default.
- **Existing platform entities** (participants, consents, attempts, sessions, quality flags, scores, reports, growth plans, pathways, admin users, institutions, cohorts, audit history): unchanged in meaning; only where they are stored changes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The platform is set up, started and passes its full check suite on a machine with no legacy database software installed, and 0 requirements for that software remain anywhere in the repository.
- **SC-002**: An admin can upload a valid spreadsheet of up to 500 questions and see the draft set ready to review in under 1 minute from choosing the file.
- **SC-003**: For a spreadsheet with any number of mistakes, 100% of them are listed with row and column in a single result, and 0 questions from that file are saved.
- **SC-004**: 100% of the previously passing acceptance checks for registration, consent, assessment delivery, scoring, reports, growth plans and pathways still pass on the new store.
- **SC-005**: In the guarantee checks, 0 saved answers, scores, report snapshots or audit entries can be altered or removed by any role, and 0 duplicate records can be created where the rules require uniqueness.
- **SC-006**: With 40 participants answering at once and two classes of 40 submitting together, 0 answers are lost or duplicated and every submission completes.
- **SC-007**: For a question with any option count from 2 to 20, 100% of options are shown in uploaded order, 100% of answers outside its options are refused, and a 5-option question gives exactly the same score as today.
- **SC-008**: A participant can never reach a draft, frozen-but-closed or stopped question set: 0 exposures across the release-state checks.
- **SC-009**: A participant or institution can never see another's data in 100% of isolation checks, including when a request names another identity.
- **SC-010**: A research export of 10,000 participants × 222 answers is produced with every answer row present exactly once across at least 3 answer worksheets, none exceeding the spreadsheet row limit, and 0 direct identifiers present.
- **SC-011**: A backup restored into a clean system passes 100% of the integrity, isolation and end-to-end checks.
- **SC-012**: Every capability listed as carried over from feature 005 is either demonstrably working on the new store or recorded as deferred with a reason and owner sign-off.
- **SC-013**: A new owner following the guide reaches a running system with the sample spreadsheet uploaded in under 45 minutes.
- **SC-014**: Converting the existing catalog to the new format and re-uploading it yields 175 and 171 questions with the 5-point options and no validation errors.
- **SC-015**: At 100 %, 90 %, 80 % and 60 % completeness, 100 % of scored domains show exactly the status and score-or-no-score in the FR-045 table (COMPLETE, COMPLETE_WITH_MISSING, INCOMPLETE, INSUFFICIENT).
- **SC-016**: For known answer sets with 2, 3, 5, 9 and 20 options, every domain score matches the hand calculation exactly (0 differences), and every score can be recomputed from the stored current answers alone (0 imputed values).
- **SC-017**: With the pilot-S2 release off, 0 participant-facing capability conclusions appear in any report; with it on, 0 domains at S2 or higher are reported without exactly one approved wording.
- **SC-018**: For a domain at S2 with no approved wording, 100 % of report attempts fail closed and store no invented text, and 0 combinations ever hold two approved wordings.
- **SC-019**: A forced report failure leaves the attempt scored in 100 % of cases, no partial report is ever visible, and a retry succeeds with no retake and no re-scoring; the same inputs give an identical report fingerprint.
- **SC-020**: 0 requests obtain a participant's score before their report is ready, and 0 reports, exports or responses contain a prohibited claim (subdomain score, band label, percentile, norm, reliable-change, diagnostic or personality claim).
- **SC-021**: Every held attempt (any reason, safeguarding included) receives one identical neutral message and every invalid attempt one identical neutral message: 0 differences by reason.
- **SC-022**: All four release switches read OFF on a new system, and every change to one is audited with its reason (0 unaudited changes).

## Assumptions

- **A-1 — The owner has directed this change, and it overrides a locked rule.** The project constitution (Principle III, non-negotiable) and the locked build contracts fix the data store as a relational schema of exactly 28 tables. This request removes it, so a constitution amendment (major version) and a numbered change record are required before planning or building. This feature does not amend them itself; the recommended next step is `/speckit-constitution`.
- **A-2 — The guarantees are the contract, not the storage engine.** The rules in FR-004 to FR-010 come from the constitution and the implementation documents and carry over unchanged. The document database has no built-in equivalent of row-level access rules, database triggers and role grants, so each protection must be provided in the data model and service layer and tested.
- **A-3 — Fresh start, no data migration.** The current database holds only synthetic development data (three test accounts); no existing data is migrated. Existing backups are left untouched (their deletion is the owner's decision).
- **A-4 — Local installation.** MongoDB is installed locally; containers are not used at this stage. The set-up guide states exactly what to install, including any option the platform needs for multi-step atomic actions.
- **A-5 — "Options can be low or high" means the number of options per question can be small or large** (2 to 20). If it instead means the labels "Low" and "High", FR-014 and FR-015 need revising.
- **A-6 — Age group is chosen at upload.** The sheet has no age-group column (the fields "remain the same"), so the admin selects it in the upload form and the file's age bands must fit.
- **A-7 — Position-based scoring is a default awaiting approval.** Even spacing from 1 to 5 is chosen because a 5-option question then reproduces today's scores exactly. Because new question sets start as research-only evidence (S1), unapproved rescaling cannot reach participants until psychometric approval promotes them. The owner can replace the rule later by change record.
- **A-8 — The old import format is replaced, not kept alongside.** The previous 13-column workbook import and its frozen seed are retired (FR-023); the optional conversion helper (FR-021) exists so the current 346 questions are not lost.
- **A-9 — Same fields.** The 13 existing fields keep their names, order and rules; only option columns are added. Extra unknown columns are warned about and ignored. Caps: 20 options, 2 MB and 500 questions per file.
- **A-10 — Scientific and safety rules are unchanged.** Consent and assent gates, evidence-gated reporting (no Low/Average/High bands or percentiles without approval), Q09/P5 safeguarding, growth-plan rules and "one engine, two age routes" are out of scope for change.
- **A-11 — Release status.** The platform remains NO-GO for launch; no governance gate changes, and all prior test evidence is stale until re-run (FR-039).
- **A-12 — Carried-over work is scope, not done.** The unfinished items of feature 005 (38 tasks, T136–T173: admin and research operations, security and quality evidence, polish) are included here so they are built later with the implement command on the new store; the 135 finished tasks of feature 005 (registration, consent, delivery, scoring, reports, growth, pathways, roster, participant screens) are behaviours to be preserved, and the code behind them is re-based on the new store as part of FR-001.
- **A-13 — Out of scope.** Item wording of any set, legal consent copy, retention and withdrawal policy, and screen redesign beyond the question-bank page and the variable-options answer screen.
- **A-14 — The scoring master is guidance with audit precedence.** It describes the RC0 target and says the RC0 report worker builds only the profile and meaning layers and does not render the chart. This feature specifies the full descriptive composition (FR-054) and treats that RC0 gap as work to do. Where it conflicts with the Final ERD, the Development & Reporting master or the remediation register, those win (constitution I) and the conflict is recorded here.
- **A-15 — Discrepancies recorded, not silently resolved.** (a) *Q05*: the master says RC0 warns when another submitted attempt exists, but the BUILD 06 audit says a protocol must first separate invalid duplication from legitimate reassessment; Q05 therefore stays inactive until the protocol is supplied. (b) *Q07*: the master says RC0 raises a missingness warning at 80 % completeness or below; this is adopted because the boundary is exactly specified (severity is an assumption: low; it never changes scoring or attempt state). (c) *Missing wording*: feature 005 skipped a section silently; the master requires failing closed, which is adopted (FR-055). (d) *60 %*: BUILD 01 allowed a raw score at exactly 60 % complete; the master (RC0 remediation) makes it INSUFFICIENT, which is adopted. (e) *Stored counts, completeness status and report fingerprint*: BUILD 01 has no columns for them, but the master and BUILD 08 need them; they are added by change record (data model).
- **A-16 — Release switches as audited events.** The four switches are recorded as audited events (no new entity) and default to OFF; per-domain holds (for example a held domain) are governed configuration.
- **A-17 — The 1–5 scale is generalised, not replaced.** The master describes 1–5 answers; FR-014 extends this to per-question options with a 5-option question identical to the master. The response-scale version check in the master is replaced by the frozen-question-set check, because options are frozen with their questions.
