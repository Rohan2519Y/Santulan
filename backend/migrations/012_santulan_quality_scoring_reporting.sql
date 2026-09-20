-- SanTulan 2.0 canonical schema — BUILD 01 v3.1 §6.12, 6.13, 6.17, 6.18 (005: quality, scoring, reporting).
SET LOCAL search_path TO santulan, public;

-- 6.12 quality_flags
CREATE TABLE quality_flags (
  flag_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id   uuid NOT NULL REFERENCES assessment_attempts(attempt_id) ON DELETE RESTRICT,
  domain_code  text NULL CHECK (domain_code IS NULL OR valid_domain_code(domain_code)),
  flag_code    quality_flag_code NOT NULL,
  severity     quality_severity NOT NULL,
  detected_at  timestamptz NOT NULL DEFAULT now(),
  disposition  quality_disposition NOT NULL DEFAULT 'UNREVIEWED',
  reviewed_by  uuid NULL REFERENCES admin_users(admin_user_id) ON DELETE SET NULL,
  reviewed_at  timestamptz NULL,
  review_note  text NULL,
  CONSTRAINT quality_review_ck CHECK ((reviewed_by IS NULL AND reviewed_at IS NULL) OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  CONSTRAINT q09_critical_ck CHECK (flag_code <> 'Q09' OR severity = 'CRITICAL')
);

-- 6.13 score_results
CREATE TABLE score_results (
  score_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id            uuid NOT NULL REFERENCES assessment_attempts(attempt_id) ON DELETE RESTRICT,
  participant_id        uuid NOT NULL REFERENCES participants(participant_id) ON DELETE RESTRICT,
  assessment_version_id uuid NOT NULL REFERENCES assessment_versions(assessment_version_id) ON DELETE RESTRICT,
  domain_code           text NOT NULL CHECK (valid_domain_code(domain_code)),
  raw_score             numeric(4,2) NULL CHECK (raw_score IS NULL OR raw_score BETWEEN 1.00 AND 5.00),
  completeness_rate     numeric(5,4) NOT NULL CHECK (completeness_rate BETWEEN 0 AND 1),
  score_status          evidence_state NOT NULL,
  scoring_version       text NOT NULL,
  calculated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, domain_code, scoring_version)
);

-- 6.17 reports
CREATE TABLE reports (
  report_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id    uuid NOT NULL REFERENCES participants(participant_id) ON DELETE RESTRICT,
  attempt_id        uuid NOT NULL UNIQUE REFERENCES assessment_attempts(attempt_id) ON DELETE RESTRICT,
  report_version    text NOT NULL,
  report_type       text NOT NULL,
  generation_status report_generation_status NOT NULL DEFAULT 'PENDING',
  retry_count       integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  generated_at      timestamptz NULL,
  last_error_code   text NULL,
  last_error_at     timestamptz NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- 6.18 report_sections
CREATE TABLE report_sections (
  section_id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id                  uuid NOT NULL REFERENCES reports(report_id) ON DELETE CASCADE,
  section_type               report_section_type NOT NULL,
  is_released_to_participant boolean NOT NULL DEFAULT false,
  domain_code                text NULL CHECK (domain_code IS NULL OR valid_domain_code(domain_code)),
  content_version            text NOT NULL,
  locale                     text NOT NULL DEFAULT 'en',
  display_order              integer NOT NULL CHECK (display_order > 0),
  content_snapshot           text NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id, display_order)
);
