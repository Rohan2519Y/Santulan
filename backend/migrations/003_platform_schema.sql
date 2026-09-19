-- Platform SQL database, part 1 of 3: types, tables, indexes.
--
-- Source: docs/SQL-Database-Schema.md (sections 3.1 - 3.10), reproduced as written
-- except for three deliberate fixes where that document's ER diagram and its DDL
-- disagree (each marked "Deviation from the doc DDL" below) and nine added indexes
-- (final section). Rationale: specs/004-platform-sql-database/research.md sections 3 and 8.
--
-- Added ALONGSIDE the feature-002 tables: nothing from 001/002 is altered, and no new
-- table shares a name with an existing one. UUID keys use gen_random_uuid(), which is
-- built in from PostgreSQL 13 (no pgcrypto extension needed).
--
-- Part 2 (004_platform_integrity_triggers.sql) adds triggers and erase_student();
-- part 3 (005_platform_tenant_isolation.sql) adds row-level security.

-- ============================================================================
-- 3.1 Identity, tenancy, and permissions
-- ============================================================================

CREATE TYPE account_type_enum AS ENUM ('school_user', 'platform_staff', 'superuser');
CREATE TYPE account_status_enum AS ENUM ('pending', 'active', 'suspended', 'locked', 'deleted');
CREATE TYPE role_enum AS ENUM ('student', 'parent', 'counsellor', 'principal', 'teacher', 'support', 'superuser');

CREATE TABLE schools (
    school_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                    TEXT NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'pilot' CHECK (status IN ('pilot','active','inactive')),
    board                   TEXT,
    city                    TEXT,
    state                   TEXT,
    district                TEXT,
    address                 TEXT,
    contact_email           TEXT,
    contact_person_name     TEXT,
    contact_person_mobile   TEXT,
    pilot_start_date        DATE,
    pilot_end_date          DATE,
    student_count_estimate  INT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Identity + credentials + role in one row: credentials are a strict 1:1
-- with an account (every login reads both), and `role` has never been
-- many-to-many in practice — see §1, "Pass two." Restrict who can SELECT
-- password_hash with a column-level GRANT/REVOKE instead of a table split:
--   REVOKE SELECT (password_hash, reset_token_hash) ON accounts FROM app_readonly;
-- login_id (student-only: school-issued) and work_email (staff-only)
-- live on student_profiles/staff_profiles instead of here — see §1,
-- "Pass six." Every remaining column is genuinely cross-role: email/
-- mobile/phone are used by parents and staff alike, not exclusive to one.
CREATE TABLE accounts (
    account_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_type            account_type_enum NOT NULL,
    role                    role_enum NOT NULL,
    status                  account_status_enum NOT NULL DEFAULT 'pending',
    school_id               UUID REFERENCES schools(school_id),
    email                   TEXT UNIQUE,
    mobile                  TEXT UNIQUE,
    phone                   TEXT,
    name                    TEXT NOT NULL,
    language                TEXT NOT NULL DEFAULT 'en',
    -- Nullable: a parent account can be created in status='pending' at
    -- student-registration time, before that parent has ever activated a
    -- login or set a password — see parent_profiles / student_profiles
    -- below and §1, "Pass four."
    password_hash           TEXT,
    reset_token_hash        TEXT,
    reset_token_expires_at  TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at           TIMESTAMPTZ,
    -- Deviation from the doc DDL (its ER diagram shows this column): soft-delete /
    -- erasure time. See specs/004-platform-sql-database/data-model.md section 2, fix 2.
    deleted_at              TIMESTAMPTZ,
    CONSTRAINT school_id_matches_account_type CHECK (
        (account_type = 'school_user' AND school_id IS NOT NULL) OR
        (account_type != 'school_user' AND school_id IS NULL)
    ),
    CONSTRAINT password_required_unless_pending CHECK (
        password_hash IS NOT NULL OR status = 'pending'
    )
);
CREATE INDEX idx_accounts_school_id ON accounts(school_id);

-- No parent_name_onboarding/parent_mobile_onboarding here — a parent
-- contact captured at student registration now becomes a real accounts +
-- parent_profiles row immediately (status='pending' until the parent
-- activates), not free text on the student. See §1, "Pass four."
CREATE TABLE student_profiles (
    account_id                  UUID PRIMARY KEY REFERENCES accounts(account_id) ON DELETE CASCADE,
    login_id                    TEXT UNIQUE,  -- school-issued; NULL until the school issues one (see onboarding_state below)
    class_name                  TEXT,
    section                     TEXT,
    roll                        TEXT,
    date_of_birth               DATE,
    age_band                    TEXT,
    class_band                  TEXT,
    -- 'active' is reached once the school has issued login_id + password
    -- (accounts.password_hash) AND consent is on file (consent_records) —
    -- no separate activation-code/PIN step in between.
    onboarding_state            TEXT NOT NULL DEFAULT 'dormant'
                                CHECK (onboarding_state IN ('dormant','consent_recorded','active','withdrawn')),
    escalation_level            INT NOT NULL DEFAULT 1 CHECK (escalation_level BETWEEN 1 AND 5),
    interaction_count           INT NOT NULL DEFAULT 0,
    modules_completed           INT NOT NULL DEFAULT 0
);

CREATE TABLE staff_profiles (
    account_id      UUID PRIMARY KEY REFERENCES accounts(account_id) ON DELETE CASCADE,
    work_email      TEXT UNIQUE,  -- staff authenticate with this, not accounts.email
    designation     TEXT,
    position        TEXT,
    state           TEXT,
    district        TEXT,
    is_approved     BOOLEAN NOT NULL DEFAULT false,
    approved_by     UUID REFERENCES accounts(account_id),
    approved_at     TIMESTAMPTZ
);

-- Role-specific detail for parent accounts, following the same rule as
-- student_profiles/staff_profiles: extend accounts only where the role
-- has genuine columns to hold. linked_student_account_ids covers the
-- many-to-many parent<->student link in this same table (a parent linked
-- to several children lists them all here; a student linked to two
-- parents appears in two different parents' arrays) instead of a separate
-- join table — see §1, "Pass four" for what that trades away (no
-- database-enforced FK per array element, no per-link status/history).
--
-- A row here (and its parent accounts row) is created at student
-- registration time, not only at parent signup: the school records a
-- primary parent contact, which creates accounts(status='pending',
-- password_hash=NULL, name, mobile) + this row with
-- linked_student_account_ids = {that student}. relation_type is nullable
-- because it may not be confirmed yet at that point. When the parent
-- later activates (sets a password, status moves to 'active'), it's the
-- same row throughout — no migration from placeholder to real data.
CREATE TABLE parent_profiles (
    account_id                    UUID PRIMARY KEY REFERENCES accounts(account_id) ON DELETE CASCADE,
    relation_type                 TEXT CHECK (relation_type IN ('mother','father','guardian','other')),
    occupation                    TEXT,
    alternate_mobile              TEXT,
    linked_student_account_ids    UUID[] NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_parent_profiles_students ON parent_profiles USING GIN (linked_student_account_ids);

CREATE TYPE school_assignment_role_enum AS ENUM (
    'principal','counsellor','teacher','coordinator',
    'support_readonly','support_limited_edit'
);

-- Unifies what an earlier draft split into three near-identical tables
-- (school_staff_assignments, support_school_assignments, class_assignments)
-- — all were "an account, scoped to a school, in some role, for some
-- period," differing only in allowed role values and one optional column.
-- Also replaces schools.principal_id / counsellor_ids[] / etc.: a join
-- table supports real unassignment (revoke a row), which array fields
-- never could.
CREATE TABLE school_assignments (
    assignment_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id        UUID NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    school_id         UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
    assignment_role   school_assignment_role_enum NOT NULL,
    class_label       TEXT,  -- only meaningful for teacher/coordinator; NULL otherwise
    assigned_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    assigned_by       UUID REFERENCES accounts(account_id),
    revoked_at        TIMESTAMPTZ
);
CREATE INDEX idx_school_assignments_school ON school_assignments(school_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_school_assignments_account ON school_assignments(account_id) WHERE revoked_at IS NULL;
-- At most one active principal per school:
CREATE UNIQUE INDEX uq_one_active_principal_per_school
    ON school_assignments(school_id)
    WHERE assignment_role = 'principal' AND revoked_at IS NULL;

-- Closed vocabularies from backend/specs/01-user-types-permissions/schema.json,
-- enforced here rather than as lookup tables (see §7). 'assessment',
-- 'pulse', and 'sathi' are not values here — those resources no longer
-- have a backing table in this release (see §3.2), so granting a
-- capability against them would be granting access to nothing.
CREATE TYPE resource_enum AS ENUM (
    'profile','relationship','school_membership','class_assignment','student',
    'counsellor_note','wellbeing_flag','consent',
    'protocol','guidance','report','support_note','credential','account',
    'audit','school','platform_config','crisis_metadata'
);
CREATE TYPE action_enum AS ENUM (
    'list','read','create','update','delete','execute','approve','assign','export','manage'
);
CREATE TYPE scope_type_enum AS ENUM (
    'self','linked_child','school','class','assigned_student','platform','synthetic_only'
);

CREATE TABLE capability_grants (
    grant_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id   UUID NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    resource     resource_enum NOT NULL,
    action       action_enum NOT NULL,
    fields       TEXT[],                    -- field allowlist; meaningful only when action = 'update'
    scope_type   scope_type_enum NOT NULL,
    scope_id     TEXT NOT NULL,
    granted_by   UUID NOT NULL REFERENCES accounts(account_id),
    expires_at   TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ,
    CONSTRAINT fields_only_on_update CHECK (fields IS NULL OR action = 'update')
);
CREATE INDEX idx_capgrants_account ON capability_grants(account_id) WHERE revoked_at IS NULL;

-- ============================================================================
-- 3.3 Escalation and counsellor notes
-- ============================================================================

CREATE TABLE escalation_events (
    escalation_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_account_id  UUID NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    school_id           UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
    user_type            TEXT NOT NULL,
    escalation_level     INT NOT NULL CHECK (escalation_level BETWEEN 3 AND 5),
    trigger_reason        TEXT NOT NULL,
    status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
    acknowledged_by       UUID REFERENCES accounts(account_id),
    acknowledged_at       TIMESTAMPTZ,
    resolved_by           UUID REFERENCES accounts(account_id),
    resolved_at           TIMESTAMPTZ,
    resolution_notes      TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_escalation_school ON escalation_events(school_id);

CREATE TABLE counsellor_notes (
    note_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    counsellor_account_id UUID NOT NULL REFERENCES accounts(account_id),
    student_account_id   UUID NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    content_sealed        BYTEA NOT NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_counsellor_notes_student ON counsellor_notes(student_account_id);

-- ============================================================================
-- 3.4 Consent (onboarding + SCP)
-- ============================================================================

CREATE TABLE consent_records (
    consent_id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_account_id         UUID NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    school_id                  UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
    reference                  TEXT,
    method                     TEXT,
    consent_date               DATE,
    consenting_parent_name     TEXT,
    consenting_parent_channel  TEXT,
    status                     TEXT NOT NULL,
    withdrawn_at               TIMESTAMPTZ,
    withdrawn_reason           TEXT,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_consent_records_school ON consent_records(school_id);

CREATE TABLE scp_consents (
    consent_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_account_id   UUID NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    parent_account_id    UUID REFERENCES accounts(account_id),
    school_id            UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
    status                TEXT NOT NULL,
    granted_at            TIMESTAMPTZ,
    granted_by            UUID REFERENCES accounts(account_id),
    granted_via           TEXT,
    valid_from            DATE,
    valid_until           DATE,
    withdrawn_at          TIMESTAMPTZ,
    withdrawn_reason      TEXT,
    academic_year         TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_scp_consents_school ON scp_consents(school_id);

-- ============================================================================
-- 3.5 SCP (Santulan Capability Profile)
-- ============================================================================

-- item_responses_sealed / domain_scores stay JSONB — same reasoning as
-- the other map-shaped fields in §1: always read/written as one session,
-- never queried per-item or per-domain at the SQL level.
CREATE TABLE scp_sessions (
    session_id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_account_id            UUID NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    administration_id             TEXT,
    session_code                   TEXT,
    form_id                        TEXT,
    checkpoint                     TEXT NOT NULL,
    state                          TEXT NOT NULL,
    participation_status           TEXT,
    scheduled_at                   TIMESTAMPTZ,
    started_at                     TIMESTAMPTZ,
    completed_at                   TIMESTAMPTZ,
    last_activity_at               TIMESTAMPTZ,
    checkpoint_window_closes_at    TIMESTAMPTZ,
    block_order_seed               INT,
    resume_count                   INT NOT NULL DEFAULT 0,
    answered_count                 INT NOT NULL DEFAULT 0,
    total_items                    INT,
    device_shared                  BOOLEAN NOT NULL DEFAULT false,
    validity_outcome               TEXT,
    item_responses_sealed          JSONB,   -- {item_id: sealed_value}, Class A; populated as answered
    domain_scores                  JSONB,   -- {domain_code: {stage, validity_outcome}}; populated once scored
    voided_at                      TIMESTAMPTZ,
    voided_by                      UUID REFERENCES accounts(account_id),
    void_reason                    TEXT
);
CREATE INDEX idx_scp_sessions_student ON scp_sessions(student_account_id);

CREATE TABLE scp_assents (
    assent_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_account_id  UUID NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    session_id           UUID NOT NULL REFERENCES scp_sessions(session_id) ON DELETE CASCADE,
    assented              BOOLEAN,
    assented_at           TIMESTAMPTZ,
    declined_at           TIMESTAMPTZ,
    -- Deviation from the doc DDL (its ER diagram marks session_id UK: "one assent per
    -- session"). See data-model.md section 2, fix 3.
    CONSTRAINT uq_scp_assents_one_per_session UNIQUE (session_id)
);

-- ============================================================================
-- 3.6 Protocol library
-- ============================================================================

-- steps/avoid/stop_and_route stay as ordered TEXT[] — a handful of
-- admin-curated lines per protocol, never queried by their own text, just
-- rendered as a whole alongside the protocol that owns them.
CREATE TABLE protocols (
    protocol_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    protocol_code    TEXT NOT NULL UNIQUE,
    name             TEXT NOT NULL,
    domain           TEXT,
    sub_capability   TEXT,
    band             TEXT,
    tier             INT,
    mode             TEXT,
    group_size       TEXT,
    deliverable_by   TEXT,
    sessions         INT,
    minutes          INT,
    purpose          TEXT,
    review_wks       INT,
    review_status    TEXT NOT NULL DEFAULT 'draft' CHECK (review_status IN ('draft','approved','retired')),
    steps            TEXT[] NOT NULL,
    avoid            TEXT[] NOT NULL DEFAULT '{}',
    stop_and_route    TEXT[] NOT NULL DEFAULT '{}',
    version          INT NOT NULL DEFAULT 1,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE protocol_orientations (
    orientation_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id       UUID NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    protocol_id      UUID NOT NULL REFERENCES protocols(protocol_id) ON DELETE CASCADE,
    completed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (account_id, protocol_id)
);

CREATE TABLE protocol_route_events (
    event_id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    practitioner_account_id UUID NOT NULL REFERENCES accounts(account_id),
    protocol_id              UUID NOT NULL REFERENCES protocols(protocol_id),
    student_account_id       UUID NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    session_context           TEXT,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 3.7 Guidance and queue
-- ============================================================================

CREATE TABLE queue_signals (
    signal_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_account_id      UUID NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    -- Deviation from the doc DDL (its ER diagram shows this column, "denormalized -
    -- added"): every school-owned row carries its school so tenant isolation (005)
    -- can filter on it. See data-model.md section 2, fix 1.
    school_id               UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
    attention_level          INT NOT NULL,
    reason                    TEXT,
    entry_point               TEXT,
    suggested_protocol_id     UUID REFERENCES protocols(protocol_id),
    resolved_at               TIMESTAMPTZ,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE class_guidance_state (
    state_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id      UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
    class_label    TEXT NOT NULL,
    pattern_code   TEXT NOT NULL,
    term_context   TEXT,
    band           TEXT,
    coverage       NUMERIC(5,2),
    cell_size      INT,
    UNIQUE (school_id, class_label)
);

-- ============================================================================
-- 3.8 Content and group sessions
-- ============================================================================

-- target_roles/target_school_ids stay as arrays — small, admin-set lists
-- read alongside the module itself; empty target_school_ids means "all
-- schools," matching current semantics exactly.
CREATE TABLE content_modules (
    module_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title               TEXT NOT NULL,
    module_type         TEXT,
    audience            TEXT,
    content             TEXT,
    language            TEXT NOT NULL DEFAULT 'en',
    is_published        BOOLEAN NOT NULL DEFAULT false,
    published_at        TIMESTAMPTZ,
    published_by        UUID REFERENCES accounts(account_id),
    target_roles         TEXT[] NOT NULL DEFAULT '{student}',
    target_school_ids    UUID[] NOT NULL DEFAULT '{}',
    order_index          INT NOT NULL DEFAULT 0,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE module_completions (
    completion_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id       UUID NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    module_id        UUID NOT NULL REFERENCES content_modules(module_id) ON DELETE CASCADE,
    completed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (account_id, module_id)
);

CREATE TABLE group_sessions (
    group_session_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    counsellor_account_id UUID NOT NULL REFERENCES accounts(account_id),
    school_id             UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
    title                  TEXT NOT NULL,
    session_date           DATE NOT NULL,
    session_time           TEXT,
    module_id              UUID REFERENCES content_modules(module_id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_group_sessions_school ON group_sessions(school_id);

-- ============================================================================
-- 3.10 Audit (consolidated)
-- ============================================================================

CREATE TABLE audit_events (
    audit_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_class        TEXT NOT NULL,
    actor_account_id   UUID NOT NULL REFERENCES accounts(account_id),
    actor_role         TEXT NOT NULL,
    actor_school_id    UUID REFERENCES schools(school_id),
    target_type        TEXT,
    target_id          TEXT,
    outcome            TEXT,
    detail             JSONB,
    source_ip          TEXT,
    user_agent         TEXT,
    occurred_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_events_school ON audit_events(actor_school_id);
CREATE INDEX idx_audit_events_actor ON audit_events(actor_account_id);

-- ============================================================================
-- Added indexes (not in the doc DDL; research.md section 8)
-- ============================================================================

-- SC-009: "latest session per student per checkpoint" without a scan (doc section 5 names this pair).
CREATE INDEX idx_scp_sessions_student_checkpoint ON scp_sessions (student_account_id, checkpoint, completed_at DESC);
-- SC-009: "a school's open escalations"; status added to the doc's suggested (school_id, ...) pair.
CREATE INDEX idx_escalation_school_status ON escalation_events (school_id, status, created_at DESC);

-- Foreign-key indexes on the student-erasure cascade paths (FR-038) and the row-level-security
-- lookups; the doc leaves these unindexed, so erasing one student would scan each table.
CREATE INDEX idx_escalation_events_student ON escalation_events (student_account_id);
CREATE INDEX idx_consent_records_student ON consent_records (student_account_id);
CREATE INDEX idx_scp_consents_student ON scp_consents (student_account_id);
CREATE INDEX idx_scp_assents_student ON scp_assents (student_account_id);
CREATE INDEX idx_queue_signals_student ON queue_signals (student_account_id);
CREATE INDEX idx_protocol_route_events_student ON protocol_route_events (student_account_id);

-- Tenant isolation (005) filters queue signals by school.
CREATE INDEX idx_queue_signals_school ON queue_signals (school_id);
