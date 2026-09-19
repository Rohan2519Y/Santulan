# Feature Specification: Assessment Service

> **Status: Superseded.** This spec described an MCQ-quiz assessment driven by `mcq_template.csv`. The documentation review showed the real instrument is a self-report developmental capability assessment; see [002-capability-assessment](../002-capability-assessment/spec.md) ("Supersedes"). Its references to the data layer also predate the project's current approach (see 002 research §9). Kept for history only.

**Feature Branch**: `001-assessment-service`

**Created**: 2026-09-16

**Status**: Superseded (kept as history — see the notice above)

**Input**: User description: "I want to make the microservice for assessment and in the assessment read mcq_template.csv for the MCQ questions and one admin and one student"

## Roles

| Role    | Capabilities                                                                 |
|---------|------------------------------------------------------------------------------|
| Admin   | Upload `mcq_template.csv`, view all student submissions and results           |
| Student | Start and take an assessment, view own submission history and results          |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Student Takes an Assessment and Gets a Result (Priority: P1)

A logged-in student starts the assessment, answers each question loaded from the active CSV-based question set, submits their responses, and immediately sees their computed result.

**Why this priority**: This is the core value of the feature — without it there is nothing to deploy. It must work standalone as the MVP.

**Independent Test**: Can be fully tested by logging in as a student, completing every question in an active assessment, submitting it, and verifying a result is displayed and saved — delivers the entire core value on its own.

**Acceptance Scenarios**:

1. **Given** a logged-in student with no in-progress assessment, **When** they start the assessment, **Then** the system presents the current set of active questions (loaded from the CSV) in order.
2. **Given** a student has answered all mandatory questions, **When** they submit the assessment, **Then** the system computes and displays a result and stores the submission and result against their account.
3. **Given** a student has not answered every mandatory question, **When** they attempt to submit, **Then** the system blocks submission and indicates which questions are missing.

---

### User Story 2 - Student Views Assessment History (Priority: P2)

A student who has completed one or more assessments can return later and view a list of their past submissions with each result.

**Why this priority**: Lets students track change over time, which is core to the value of a repeatable self-assessment, but the product still works for a single first-time completion without it.

**Independent Test**: Can be fully tested by completing two assessments as the same student on different dates and confirming both appear, correctly dated, with their original results.

**Acceptance Scenarios**:

1. **Given** a student has completed at least one assessment, **When** they open their assessment history, **Then** they see every past submission with its completion date and result.
2. **Given** a student has never completed an assessment, **When** they open their assessment history, **Then** they see an empty state rather than an error.

---

### User Story 3 - Admin Uploads Question Set via CSV (Priority: P3)

An authorized admin uploads a `mcq_template.csv` file containing questions, answer options, and correct-answer indicators. The system validates the file, and new assessment sessions use the updated question set.

**Why this priority**: Needed for the assessment content to be manageable without a code change or deployment, but the first version can launch with a fixed seeded question set while this is built.

**Independent Test**: Can be fully tested by having an admin upload a valid CSV and confirming new student submissions use those questions, while past submissions under a prior version remain unchanged.

**Acceptance Scenarios**:

1. **Given** an authorized admin, **When** they upload a valid `mcq_template.csv`, **Then** the system parses it, creates a new assessment template version, and makes it the active question set for new sessions.
2. **Given** an admin uploads a CSV with structural errors (missing required columns, invalid option counts), **When** the system processes it, **Then** the upload is rejected with specific error messages identifying the problems.
3. **Given** an assessment question set has been updated via CSV, **When** a student views a submission completed under a prior version, **Then** the original questions, answers, and result for that submission remain unchanged.

---

### User Story 4 - Admin Views All Student Submissions (Priority: P4)

An authorized admin can view every student's submissions and results across all assessment versions.

**Why this priority**: Provides admin oversight and reporting. The feature is functional without it but valuable for operational visibility.

**Independent Test**: Can be tested by having two different students complete assessments and confirming the admin can see both submissions with correct results.

**Acceptance Scenarios**:

1. **Given** an authorized admin, **When** they open the admin results view, **Then** they see a list of all student submissions with student name, date, and result.
2. **Given** an authorized admin, **When** they select a specific submission, **Then** they see the full details of that submission including each question, the student's chosen option, and whether it was correct.

---

### Edge Cases

- What happens when a student closes the browser or loses connection mid-assessment? (Resume vs. discard on next visit)
- How does the system handle a student attempting to start a second assessment while one is already in progress?
- How does the system handle a submission where the active question set changed (via a new CSV upload) between when the student started and when they submitted?
- What happens if a student tries to access another student's submission or result directly?
- How does the system handle an admin uploading a CSV while there are in-progress student sessions using the previous version?
- What happens if the uploaded CSV file is empty or contains no valid questions?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow an authenticated student to start a new assessment session.
- **FR-002**: System MUST present the current active set of assessment questions (loaded from CSV) to the student in a defined order.
- **FR-003**: System MUST require every mandatory question to be answered before a submission is accepted, and MUST identify which required questions are missing when submission is blocked.
- **FR-004**: System MUST calculate a result from a student's submitted responses by scoring each answered multiple-choice question against its correct option and aggregating the correct answers into an overall score (e.g., number/percentage correct).
- **FR-005**: System MUST persist every completed submission and its result, linked to the submitting student and timestamped.
- **FR-006**: Students MUST be able to view their own complete assessment history and every past result.
- **FR-007**: System MUST allow an authorized admin to upload a CSV file (`mcq_template.csv`) to create, update, and retire assessment question sets without a code deployment.
- **FR-008**: System MUST preserve the original questions, answers, and scoring outcome of a past submission even after the active question set is later changed via a new CSV upload.
- **FR-009**: System MUST prevent a student from having more than one in-progress session for the same assessment at a time.
- **FR-010**: System MUST restrict access to a student's submissions and results to that student and authorized admins only.
- **FR-011**: System MUST display the computed result to the student immediately upon submission; scoring is always instant and fully automated, with no asynchronous processing or human review step.
- **FR-012**: System MUST allow any authenticated student to start the assessment at no cost; no order, purchase, or payment check is required before starting.
- **FR-013**: System MUST parse the uploaded CSV and extract each row as a question with its text, ordered answer options, and a flag indicating the correct option.
- **FR-014**: System MUST validate the CSV structure on upload — checking for required columns, valid option counts, and exactly one correct option per question — and reject malformed files with specific error messages.
- **FR-015**: System MUST restrict assessment-start and question-answering access to the student role only.
- **FR-016**: System MUST restrict CSV upload and submission-view-all access to the admin role only.
- **FR-017**: System MUST load the current active CSV-derived question set when a student starts an assessment, and snapshot that version for the session.

### Key Entities

- **Assessment Template**: A versioned definition of the assessment — title, description, ordered list of questions, scoring rules, whether it is currently active, and which CSV upload produced it. Only one version is active at a time; prior versions are retained for scoring past submissions.
- **Question**: A single multiple-choice prompt belonging to an Assessment Template — text, its ordered list of answer Options, its order within the assessment, and whether it is mandatory.
- **Option**: One selectable choice for a Question — its text and whether it is the correct answer.
- **Submission**: One instance of a student taking an assessment — references the student and the specific Assessment Template version used, plus start time, completion time, and status (in-progress or completed).
- **Response**: A student's selected Option for one Question within a Submission.
- **Result**: The computed outcome of a completed Submission — number of correct answers, overall score, and total questions.
- **CSV Import Record**: Tracks each admin CSV upload — filename, upload timestamp, validation status, error details if rejected, and which Assessment Template version it produced.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A student can complete the assessment, from start to seeing their result, in under 5 minutes.
- **SC-002**: A result is available to the student within 3 seconds of submission for at least 100% of submissions.
- **SC-003**: 100% of a student's completed submissions and their original results remain retrievable by that student at any later time, unaffected by subsequent CSV uploads.
- **SC-004**: An admin can upload a new CSV and have it live for new sessions in under 15 minutes, without engineering assistance.
- **SC-005**: At least 90% of students who start the assessment go on to submit it (low mid-assessment abandonment).
- **SC-006**: CSV validation errors are reported to the admin within 10 seconds of upload, with specific line-level detail.

## Assumptions

- This feature is delivered as a distinct, independently deployable capability, consistent with the existing platform's modular structure (separate auth, users, orders, payments, and notifications capabilities already exist).
- Only two roles exist: admin and student. There is no multi-tier role hierarchy for v1.
- The CSV file `mcq_template.csv` is provided by the admin and follows a defined schema (question text, option 1–N, correct option indicator, mandatory flag).
- Each question has exactly one correct option (single-select MCQ) for v1; multi-select questions are out of scope unless specified later.
- Scoring is deterministic and rule-based (correct/incorrect option matching), not requiring machine learning.
- Access to the assessment is free for every student; it is not gated behind an order or payment, so this feature does not need to integrate with the existing orders/payments capability.
- Completed submissions and results are retained indefinitely by default (no automatic deletion), consistent with typical assessment record-keeping, until a specific retention policy is provided.
- Students are authenticated through the existing auth module; no separate authentication mechanism is required.
