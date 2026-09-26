# Santulan Flowchart

The reference flow through the platform: registration → age routing → consent → an open question set → an attempt →
quality → score → evidence state → report. Question-set upload/freeze/open/close is a separate flow feeding the
"open question set" step. This is a picture of `backend.md` sections 9-13 and `database.md`'s state machines — read
those for the field-level detail; this file is the map of how the pieces connect.

## 1. End-to-end participant lifecycle

```mermaid
flowchart TD
    R["Registration (OPEN or INSTITUTIONAL)"] --> AGE{Age 13-25?}
    AGE -->|No| INELIGIBLE["Ineligible - no record created"]
    AGE -->|"13-17"| MINOR["ADOLESCENT, minor"]
    AGE -->|"18-25"| ADULT["EMERGING_ADULT, adult"]

    MINOR --> CONSENT_MINOR["Needs VERIFIED StudentAssent AND VERIFIED ParentGuardianConsent"]
    ADULT --> CONSENT_ADULT["Needs VERIFIED AdultSelfConsent"]
    CONSENT_MINOR --> GATE{Consent gate open?}
    CONSENT_ADULT --> GATE

    GATE -->|No| WAIT["Attempt creation refused"]
    GATE -->|Yes| SETCHECK{"A FROZEN, OPEN question set exists for this age group, fingerprint intact?"}
    SETCHECK -->|No| WAIT2["Attempt creation refused (ASSESSMENT_NOT_OPEN / CATALOG_DRIFT)"]
    SETCHECK -->|Yes| CONTROL{"Control plane state is OPEN? (not PAUSED/STOPPED)"}
    CONTROL -->|No| WAIT3["New attempts refused; in-progress attempts unaffected"]
    CONTROL -->|Yes| CREATE["Attempt CREATED (one non-terminal attempt per participant)"]

    CREATE --> DELIVER["Delivery: sessions, save answers, pause/resume (see diagram 3)"]
    DELIVER --> SUBMIT["Attempt SUBMITTED"]
    SUBMIT --> QUALITY["Quality engine (see diagram 4)"]
    QUALITY -->|CLEAR| SCORE["Scoring: one row per domain, evidence state decided"]
    QUALITY -->|HOLD - Q09| HOLDR["QUALITY_HOLD - human review path, never scored"]
    QUALITY -->|INVALID - Q06| INVALIDR["Attempt INVALID - hard stop, never scored"]

    SCORE --> REPORT["Report worker builds sections"]
    HOLDR --> REPORT
    INVALIDR --> REPORT
    REPORT --> READY["REPORT_READY / UNDER_REVIEW / NOT_ELIGIBLE (terminal, participant-visible)"]
```

## 2. Question-set lifecycle (feeds "an open question set exists", above)

```mermaid
flowchart LR
    UPLOAD["Super Admin uploads a workbook"] --> VALIDATE{"Parses and validates? (2-20 options per question, every required domain covered)"}
    VALIDATE -->|No| REJECTED["Rejected - nothing written, every problem listed"]
    VALIDATE -->|Yes| DRAFT["DRAFT (content written, not yet permanent)"]
    DRAFT --> FREEZE["Freeze: records a deterministic content_hash"]
    FREEZE --> FROZEN["FROZEN - permanent, cannot be edited"]
    FROZEN --> OPEN["Open for one age group (participation_state OPEN)"]
    OPEN --> CLOSE["Close (participation_state CLOSED)"]
    CLOSE --> OPEN

    FROZEN -.->|"re-checked on open AND at server start-up"| HASHCHECK{"content_hash still matches?"}
    HASHCHECK -->|No| QUARANTINE["Quarantined - 503, refused for new attempts, existing data untouched"]
```

Only one set can be `OPEN` per age group at a time. A quarantined set stays quarantined until the underlying content
question is resolved (it is not an automatic or silent recovery).

## 3. Delivery: sessions, answers, pause and resume

```mermaid
flowchart TD
    CREATED["CREATED"] --> SESSION1["IN_PROGRESS (session 1)"]
    SESSION1 -->|explicit pause / logout / inactivity timeout| PAUSED1["PAUSED"]
    PAUSED1 -->|resume - true session boundary, count +1| SESSION2["IN_PROGRESS (session 2, up to 4)"]
    SESSION1 -->|reconnect while still in-progress - no count change| SESSION1
    SESSION2 -->|"..."| SESSIONN["up to session 4"]
    SESSIONN -->|resuming a 5th time| BLOCKED["Refused - SESSION_LIMIT (can still submit)"]

    SESSION1 --> SUBMIT["Submit - closes the active session, writes the submit event"]
    SESSION2 --> SUBMIT
    SESSIONN --> SUBMIT
    SUBMIT --> SUBMITTED["SUBMITTED"]
```

Each answer save is its own small transaction: verify the attempt is writable and the question belongs to the
attempt's frozen set → validate the option position → retire the previous current answer → insert the new version →
log a `RESPONSE_SAVED` event → update last activity. An idempotency key on each save means a network retry can never
create a duplicate logical answer.

## 4. Quality, scoring and reports

```mermaid
flowchart TD
    SUBMITTED["Attempt SUBMITTED"] --> Q06{"Q06: an answer belongs to a DIFFERENT question set?"}
    Q06 -->|Yes| INVALID["Attempt INVALID - hard stop, deterministic, takes precedence over everything else"]
    Q06 -->|No| DETECTORS["Approved quality detectors run (policy-driven)"]
    DETECTORS --> Q09{"Q09 raised? (safeguarding, CRITICAL, approved trigger sources only)"}
    Q09 -->|Yes| HOLD["QUALITY_HOLD - human review; Q09 detail never leaves that restricted view"]
    Q09 -->|No| CLEAR["Outcome CLEAR"]

    CLEAR --> SCORING["Score each domain: exact-integer completeness, no imputation"]
    SCORING --> EVIDENCE["decideEvidence: S0 (insufficient) .. S5, or SH (held) - governed switches can only lower/pin, never silently promote"]
    EVIDENCE --> Q07{"Any domain INCOMPLETE or INSUFFICIENT?"}
    Q07 -->|Yes| FLAG["Q07 raised per domain - review-only, never changes the score"]
    Q07 -->|No| SCORED["Attempt SCORED"]
    FLAG --> SCORED

    SCORED --> RENDER["Report worker renders every required section"]
    HOLD --> RENDERH["Report worker renders the UNDER_REVIEW report"]
    INVALID --> RENDERI["Report worker renders the NOT_ELIGIBLE report"]
    RENDER --> DONE["REPORT_READY"]
    RENDERH --> DONE2["UNDER_REVIEW"]
    RENDERI --> DONE3["NOT_ELIGIBLE"]

    RENDER -.->|rendering fails| RETRY["FAILED_RETRYABLE - no partial sections ever stored; retried only via a controlled, audited admin action"]
```

`response_events` records what happened *during* an attempt (pauses, resumes, saves); `audit_logs` records
*administrative* actions (an admin reviewing a flag, resetting a credential, exporting research data, viewing or
exporting a participant's raw answers). They are two different trails for two different audiences.

## Where to look next

- `backend.md` — the full narrative version of every flow above, plus authentication, workers, and how to trace one
  HTTP request through the code layer by layer.
- `database.md` — the entity-relationship diagram and what each MongoDB collection is for.
- `backend/README.md` — operational detail: scripts, environment variables, the scoped data-access layer, CI, logging.
