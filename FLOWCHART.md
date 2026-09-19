# Current Work — Capability Assessment Flow

```mermaid
flowchart TD
    Start([User opens app]) --> Login[POST /api/v1/auth/login<br/>JWT Bearer + role claim]

    subgraph Participant [Participant Flow]
        direction TB
        Login --> RoleCheck{role == participant?}
        RoleCheck -- no --> Denied[403 FORBIDDEN]
        RoleCheck -- yes --> Profile[POST /assessments/profile<br/>declare profile / route / age band]
        Profile --> Consent{minor?}
        Consent -- adult --> C1[POST /assessments/consents<br/>ADULT_SELF_CONSENT]
        Consent -- minor --> C2[POST /assessments/consents<br/>PARENT_GUARDIAN_CONSENT<br/>+ STUDENT_ASSENT]
        C1 & C2 --> Attempt[POST /assessments/attempts<br/>start-or-resume<br/>eligibility + one-active-attempt guard]
        Attempt --> QuestionLoop
        QuestionLoop --> Scale{select ResponseScale<br/>1-5, Almost never..Always}
        Scale --> Save[POST /attempts/:id/responses<br/>INSERT ON CONFLICT idempotency_key<br/>is_current = true per item]
        Save --> Next{more items?}
        Next -- yes --> QuestionLoop
        Next -- no / pause --> Pause[POST /attempts/:id/pause]
        Pause --> Resume[POST /attempts/:id/resume]
        Resume --> QuestionLoop
        QuestionLoop --> Submit[POST /attempts/:id/submit<br/>lock + validate]
    end

    Submit --> ScorePipeline[Sync deterministic pipeline]
    ScorePipeline --> QF[Quality flags Q01-Q09<br/>recorded, never mutate responses]
    ScorePipeline --> Score[Per-domain scoring<br/>mean 1.00-5.00 + completeness<br/>status S0-S5 / SH]
    Score --> Report[Report assembly<br/>interpretation rules + snapshot sections]
    Report --> ReportReady{report state}
    ReportReady -- FAILED_RETRYABLE --> Retry[POST /reports/:id/retry]
    Retry --> Report
    ReportReady -- REPORT_READY / QUALITY_HOLD --> Show[GET /reports/:id<br/>7 domain scorecards]
    Show --> Results([Results page<br/>normal vs neutral treatment])

    subgraph Admin [Admin Flow]
        AdminLogin[Login as admin] --> Import[POST /admin/assessments/import<br/>xlsx TECH_READY via multer + SheetJS]
        Import --> Upsert[Batch upsert versioned items<br/>idempotent on item_code+version]
        Admin --> Control[POST /admin/assessments/control<br/>Open / Paused / Stopped + reason]
        Admin --> Submissions[GET /admin/assessments/submissions<br/>status + session + flag chips]
        Submissions --> Detail[GET /submissions/:id<br/>scorecards + flag badges]
        Detail --> Review[PATCH /quality-flags/:id<br/>needs-review vs reviewed]
    end

    Results <--> Submissions
```

**Contained work (feature 002)**: raw-`pg` data layer (no ORM), hand-written migrations, RLS defense-in-depth on `responses`, frozen item pools (175 + 171 items), seeded admin + participant users.