# Santulan flows

Two flows: the **participant journey** and the **question-set lifecycle** an administrator runs to make that journey possible.
Both follow `specs/006-mongodb-question-upload/` (behaviour carried from `specs/005-v3-1-canonical-alignment/`).

## 1. Participant journey

```mermaid
flowchart TD
  A[Visitor] --> B{Route}
  B -->|OPEN| C[Request one-time code<br/>verify]
  B -->|INSTITUTIONAL| D[Roster import by a Super Admin<br/>one-time credential file]
  C --> E[Declare age only]
  D --> E
  E --> F{Age}
  F -->|under 13 or over 25| X[Not eligible - nothing is created]
  F -->|13 to 17| G[Minor: parent or guardian consent<br/>and student assent]
  F -->|18 to 25| H[Adult self-consent]
  G --> I{Consent gate}
  H --> I
  I -->|any required consent missing or withdrawn| J[Cannot start]
  I -->|all verified| K{Both participation gates open?}
  K -->|assessment control is stopped or paused,<br/>or no question set is open for the age group| L[Assessment not open]
  K -->|open| M[Create the one attempt<br/>bound to the open question set]
  M --> N[Answer, up to 4 sessions<br/>each question shows its own options]
  N --> O[Submit - idempotent, locks the attempt]
  O --> P[Quality check]
  P -->|Q06: answer from another set| Q[Attempt INVALID - neutral T12 report]
  P -->|approved safeguarding trigger Q09| R[Attempt QUALITY_HOLD - neutral T11 report<br/>P5 handoff, never scored]
  P -->|clear| S[Score - seven domain results<br/>exact completeness status, no imputation]
  S --> T[Evidence state<br/>S1 by default; S2 only with the audited pilot switch]
  T --> U[Report]
  U -->|S2+ domain without approved wording| V[Report fails closed - retry after wording is approved]
  U -->|otherwise| W[Report ready: seven-axis chart from the PROFILE section,<br/>approved wording for S2+ domains only]
  W --> Y[Growth plan and pathways are prepared but hidden<br/>until the development and pathway release switches are ON]
```

Nothing in the journey shows a participant a raw score outside the released report. There is no score endpoint.

## 2. Question-set lifecycle (Super Admin)

```mermaid
flowchart TD
  A[Download the template] --> B[Fill in questions and options 2 to 20 each]
  B --> C[Upload with the age group]
  C --> D{Whole file valid?}
  D -->|no| E[Every problem listed with row and column<br/>nothing stored, one audit row]
  E --> B
  D -->|yes| F[Draft set - content hash computed, participation CLOSED]
  F --> G[Review]
  G --> H{Freeze}
  H -->|a domain has no eligible core question| I[Refused - names the domain]
  H -->|ok| J[Frozen - permanent, content hash sealed]
  J --> K{Open for the age group - reason required}
  K -->|another set is already open for that age group| L[Refused - close it first]
  K -->|hash verified| M[Open - new attempts get this set]
  M --> N[Close - reason required<br/>running attempts keep their set]
  J --> O[A changed file becomes revision 2 - a new draft<br/>the frozen revision is never edited]
```

## 3. What gates what

| Gate | Where | Default |
|------|-------|---------|
| Assessment control (OPEN / PAUSED / STOPPED) | latest audit event | OPEN when never changed |
| Question set open for the age group | set `participation_state` | CLOSED |
| Consent gate | consent records | closed until verified |
| `pilotS2` | audited switch | OFF → every domain stays `S1` |
| `advancedEvidence` | audited switch | OFF |
| `developmentRelease` | audited switch | OFF → priorities, actions and growth plans hidden |
| `pathwayRelease` | audited switch | OFF |
| Approved wording | governed loading (`wording-load.js --approve`) | none → S2+ reports fail closed |
