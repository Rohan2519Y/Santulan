# Feature Specification: Assessment Microservice

**Feature Branch**: `001-assessment-service`

**Created**: 2026-09-16

**Status**: Draft

**Input**: User description: "i want to make the microservice of the assesment"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Take an Assessment and Get a Result (Priority: P1)

A registered user starts the assessment, answers each question in the defined set, submits their responses, and immediately sees their computed result.

**Why this priority**: This is the core value of the feature — without it there is nothing to deploy. It must work standalone as the MVP.

**Independent Test**: Can be fully tested by logging in as a user, completing every question in an active assessment, submitting it, and verifying a result is displayed and saved — delivers the entire core value on its own.

**Acceptance Scenarios**:

1. **Given** a logged-in user with no in-progress assessment, **When** they start the assessment, **Then** the system presents the current set of active questions in order.
2. **Given** a user has answered all mandatory questions, **When** they submit the assessment, **Then** the system computes and displays a result and stores the submission and result against their account.
3. **Given** a user has not answered every mandatory question, **When** they attempt to submit, **Then** the system blocks submission and indicates which questions are missing.

---

### User Story 2 - View Assessment History (Priority: P2)

A user who has completed one or more assessments can return later and view a list of their past submissions with each result.

**Why this priority**: Lets users track change over time, which is core to the value of a repeatable self-assessment, but the product still works for a single first-time completion without it.

**Independent Test**: Can be fully tested by completing two assessments as the same user on different dates and confirming both appear, correctly dated, with their original results.

**Acceptance Scenarios**:

1. **Given** a user has completed at least one assessment, **When** they open their assessment history, **Then** they see every past submission with its completion date and result.
2. **Given** a user has never completed an assessment, **When** they open their assessment history, **Then** they see an empty state rather than an error.

---

### User Story 3 - Manage Assessment Content (Priority: P3)

An authorized administrator creates or updates the set of questions, answer options, and scoring rules that make up the assessment, without needing a code change or deployment.

**Why this priority**: Needed for the assessment to stay current and correct over time, but the first version of the feature can launch with a fixed, seeded question set while this is built.

**Independent Test**: Can be fully tested by having an administrator publish a new version of the question set and confirming new user submissions use it while past submissions keep their original scoring.

**Acceptance Scenarios**:

1. **Given** an authorized administrator, **When** they publish a new or edited question set, **Then** new assessment sessions use the updated content.
2. **Given** an assessment question set has been updated, **When** a user views a submission completed under a prior version, **Then** the original questions, answers, and result for that submission remain unchanged.

---

### Edge Cases

- What happens when a user closes the browser or loses connection mid-assessment? (Resume vs. discard on next visit)
- How does the system handle a user attempting to start a second assessment while one is already in progress?
- How does the system handle a submission where the active question set changed between when the user started and when they submitted?
- What happens if a user tries to access another user's submission or result directly?
- How does the system handle an administrator retiring a question set that has in-progress (not yet submitted) sessions using it?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow an authenticated user to start a new assessment session.
- **FR-002**: System MUST present the current active set of assessment questions to the user in a defined order.
- **FR-003**: System MUST require every mandatory question to be answered before a submission is accepted, and MUST identify which required questions are missing when submission is blocked.
- **FR-004**: System MUST calculate a result from a user's submitted responses by scoring each answered multiple-choice question against its correct option and aggregating the correct answers into an overall score (e.g., number/percentage correct).
- **FR-005**: System MUST persist every completed submission and its result, linked to the submitting user and timestamped.
- **FR-006**: Users MUST be able to view their own complete assessment history and every past result.
- **FR-007**: System MUST allow an authorized administrator to create, edit, and retire assessment question sets and scoring rules without a code deployment.
- **FR-008**: System MUST preserve the original questions, answers, and scoring outcome of a past submission even after the active question set is later changed.
- **FR-009**: System MUST prevent a user from having more than one in-progress session for the same assessment at a time.
- **FR-010**: System MUST restrict access to a user's submissions and results to that user and authorized administrators only.
- **FR-011**: System MUST display the computed result to the user immediately upon submission; scoring is always instant and fully automated, with no asynchronous processing or human review step.
- **FR-012**: System MUST allow any authenticated, registered user to start the assessment at no cost; no order, purchase, or payment check is required before starting.

### Key Entities

- **Assessment Template**: A versioned definition of the assessment — title, description, ordered list of questions, scoring rules, and whether it is currently active. Only one version is active at a time; prior versions are retained for scoring past submissions.
- **Question**: A single multiple-choice prompt belonging to an Assessment Template — text, its ordered list of answer Options, its order within the assessment, and whether it is mandatory.
- **Option**: One selectable choice for a Question — its text and whether it is the correct answer.
- **Submission**: One instance of a user taking an assessment — references the user and the specific Assessment Template version used, plus start time, completion time, and status (in-progress or completed).
- **Response**: A user's selected Option for one Question within a Submission.
- **Result**: The computed outcome of a completed Submission — number of correct answers, overall score, and total questions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can complete the assessment, from start to seeing their result, in under 5 minutes.
- **SC-002**: A result is available to the user within 3 seconds of submission for at least 100% of submissions.
- **SC-003**: 100% of a user's completed submissions and their original results remain retrievable by that user at any later time, unaffected by subsequent question-set updates.
- **SC-004**: An administrator can publish a new or updated question set and have it live for new sessions in under 15 minutes, without engineering assistance.
- **SC-005**: At least 90% of users who start the assessment go on to submit it (low mid-assessment abandonment).

## Assumptions

- This feature is delivered as a distinct, independently deployable capability, consistent with the existing platform's modular structure (separate auth, users, orders, payments, and notifications capabilities already exist).
- Only authenticated, registered users can take the assessment for v1; there is no anonymous/guest assessment flow.
- The assessment is a generic, admin-authored multiple-choice quiz — content is not tied to a specific domain (e.g., wellness or HR); administrators supply their own questions, options, and correct answers.
- Each question has exactly one correct option (single-select MCQ) for v1; multi-select questions are out of scope unless specified later.
- Scoring is deterministic and rule-based (correct/incorrect option matching), not requiring machine learning.
- Access to the assessment is free for every authenticated user; it is not gated behind an order or payment, so this feature does not need to integrate with the existing orders/payments capability.
- Completed submissions and results are retained indefinitely by default (no automatic deletion), consistent with typical assessment record-keeping, until a specific retention policy is provided.
