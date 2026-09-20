-- SanTulan 2.0 canonical schema — BUILD 01 v3.1 §6.1–6.5, §6.27 (002: identity, organisation, consent).
-- Column definitions are BUILD 01 §6 verbatim; no PII columns (BUILD 03 §1).
SET LOCAL search_path TO santulan, public;

-- 6.1 institutions
CREATE TABLE institutions (
  institution_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_code      text NOT NULL UNIQUE,
  institution_name      text NOT NULL,
  institution_type      institution_type NOT NULL,
  parent_institution_id uuid NULL REFERENCES institutions(institution_id) ON DELETE RESTRICT,
  status                institution_status NOT NULL DEFAULT 'ACTIVE',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT institutions_not_self_parent CHECK (parent_institution_id IS NULL OR parent_institution_id <> institution_id)
);

-- 6.2 cohorts
CREATE TABLE cohorts (
  cohort_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id     uuid NOT NULL REFERENCES institutions(institution_id) ON DELETE RESTRICT,
  cohort_code        text NOT NULL,
  cohort_name        text NOT NULL,
  academic_year      text NULL,
  developmental_band developmental_band NULL,
  education_stage    text NULL,
  status             cohort_status NOT NULL DEFAULT 'ACTIVE',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (institution_id, cohort_code)
);

-- 6.27 admin_users (created before participant_cohort_history, which references it)
CREATE TABLE admin_users (
  admin_user_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role                     admin_role NOT NULL,
  auth_provider            text NOT NULL,
  auth_provider_subject_id text NOT NULL,
  status                   admin_status NOT NULL DEFAULT 'ACTIVE',
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (auth_provider, auth_provider_subject_id)
);

-- 6.3 participants
CREATE TABLE participants (
  participant_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  santulan_id               text NOT NULL UNIQUE,
  participation_route       participation_route NOT NULL,
  institution_id            uuid NULL REFERENCES institutions(institution_id) ON DELETE RESTRICT,
  cohort_id                 uuid NULL REFERENCES cohorts(cohort_id) ON DELETE RESTRICT,
  external_student_id       text NULL,
  age_years_at_registration smallint NOT NULL CHECK (age_years_at_registration BETWEEN 13 AND 25),
  developmental_band        developmental_band GENERATED ALWAYS AS (resolve_developmental_band(age_years_at_registration)) STORED,
  assessment_track          assessment_track GENERATED ALWAYS AS (resolve_assessment_track(age_years_at_registration)) STORED,
  is_minor                  boolean GENERATED ALWAYS AS (age_years_at_registration < 18) STORED,
  administration_language   text NOT NULL DEFAULT 'en',
  auth_provider             text NULL,
  auth_provider_subject_id  text NULL,
  status                    participant_status NOT NULL DEFAULT 'ACTIVE',
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT participant_institutional_scope_ck CHECK (
    participation_route <> 'INSTITUTIONAL' OR (institution_id IS NOT NULL AND cohort_id IS NOT NULL)
  ),
  CONSTRAINT participant_auth_pair_ck CHECK (
    (auth_provider IS NULL AND auth_provider_subject_id IS NULL) OR
    (auth_provider IS NOT NULL AND auth_provider_subject_id IS NOT NULL)
  )
);

-- 6.4 participant_cohort_history
CREATE TABLE participant_cohort_history (
  history_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES participants(participant_id) ON DELETE RESTRICT,
  cohort_id      uuid NOT NULL REFERENCES cohorts(cohort_id) ON DELETE RESTRICT,
  institution_id uuid NOT NULL REFERENCES institutions(institution_id) ON DELETE RESTRICT,
  assigned_at    timestamptz NOT NULL DEFAULT now(),
  removed_at     timestamptz NULL,
  assigned_by    uuid NULL REFERENCES admin_users(admin_user_id) ON DELETE SET NULL,
  reason         text NULL,
  CONSTRAINT cohort_history_time_ck CHECK (removed_at IS NULL OR removed_at >= assigned_at)
);

-- 6.5 consents
CREATE TABLE consents (
  consent_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id      uuid NOT NULL REFERENCES participants(participant_id) ON DELETE RESTRICT,
  consent_type        consent_type NOT NULL,
  giver_relationship  consent_relationship NOT NULL,
  protocol_version    text NOT NULL,
  verification_method text NULL,
  granted_at          timestamptz NULL,
  verified_at         timestamptz NULL,
  withdrawn_at        timestamptz NULL,
  status              consent_status NOT NULL DEFAULT 'PENDING',
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consent_granted_time_ck CHECK (granted_at IS NULL OR granted_at >= created_at),
  CONSTRAINT consent_verified_time_ck CHECK (verified_at IS NULL OR (granted_at IS NOT NULL AND verified_at >= granted_at)),
  CONSTRAINT consent_withdrawn_time_ck CHECK (withdrawn_at IS NULL OR withdrawn_at >= created_at)
);
