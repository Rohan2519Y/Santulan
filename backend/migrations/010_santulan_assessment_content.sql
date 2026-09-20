-- SanTulan 2.0 canonical schema — BUILD 01 v3.1 §6.6–6.8, §6.14–6.16 (003: assessment content).
SET LOCAL search_path TO santulan, public;

-- 6.6 response_scales
CREATE TABLE response_scales (
  response_scale_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version           text NOT NULL UNIQUE,
  scale_points      integer NOT NULL CHECK (scale_points >= 2),
  anchor_labels     jsonb NOT NULL,
  keying_definition jsonb NOT NULL,
  content_hash      text NOT NULL,
  frozen_at         timestamptz NULL,
  status            content_status NOT NULL DEFAULT 'DRAFT',
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT response_scale_frozen_ck CHECK ((status = 'FROZEN' AND frozen_at IS NOT NULL) OR status <> 'FROZEN')
);

-- 6.7 assessment_versions
CREATE TABLE assessment_versions (
  assessment_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_label         text NOT NULL UNIQUE,
  configuration         assessment_track NOT NULL,
  participant_min_age   smallint NOT NULL,
  participant_max_age   smallint NOT NULL,
  response_scale_id     uuid NOT NULL REFERENCES response_scales(response_scale_id) ON DELETE RESTRICT,
  content_hash          text NOT NULL,
  source_file_hash      text NOT NULL,
  frozen_at             timestamptz NULL,
  status                content_status NOT NULL DEFAULT 'DRAFT',
  participation_state   assessment_participation_state NOT NULL DEFAULT 'CLOSED',
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assessment_age_range_ck CHECK (
    participant_min_age BETWEEN 13 AND 25 AND participant_max_age BETWEEN 13 AND 25 AND participant_min_age <= participant_max_age
  ),
  CONSTRAINT assessment_configuration_age_ck CHECK (
    (configuration = 'ADOLESCENT' AND participant_min_age = 13 AND participant_max_age = 17) OR
    (configuration = 'EMERGING_ADULT' AND participant_min_age = 18 AND participant_max_age = 25)
  ),
  CONSTRAINT assessment_frozen_ck CHECK ((status = 'FROZEN' AND frozen_at IS NOT NULL) OR status <> 'FROZEN')
);

-- 6.8 items
CREATE TABLE items (
  item_id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_version_id uuid NOT NULL REFERENCES assessment_versions(assessment_version_id) ON DELETE RESTRICT,
  item_code             text NOT NULL,
  domain_code           text NOT NULL CHECK (valid_domain_code(domain_code)),
  subdomain_code        text NOT NULL CHECK (valid_subdomain_code(subdomain_code)),
  subdomain_name        text NOT NULL,
  item_text             text NOT NULL,
  keying                item_keying NOT NULL,
  age_band              text NOT NULL CHECK (age_band IN ('13–17', '18–25', '13–25')),
  context               text NOT NULL CHECK (context IN ('General', 'School', 'College/Work', 'Digital')),
  layer                 item_layer NOT NULL DEFAULT 'CORE',
  pilot_status          text NOT NULL,
  display_order         integer NOT NULL CHECK (display_order > 0),
  status                item_runtime_status NOT NULL DEFAULT 'ACTIVE',
  item_content_hash     text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT item_subdomain_domain_ck CHECK (subdomain_belongs_to_domain(domain_code, subdomain_code)),
  UNIQUE (assessment_version_id, item_code),
  UNIQUE (assessment_version_id, display_order)
);

-- 6.14 interpretation_rules
CREATE TABLE interpretation_rules (
  rule_id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_version_id uuid NOT NULL REFERENCES assessment_versions(assessment_version_id) ON DELETE RESTRICT,
  domain_code           text NOT NULL CHECK (valid_domain_code(domain_code)),
  developmental_band    developmental_band NULL,
  evidence_state        evidence_state NOT NULL,
  locale                text NOT NULL DEFAULT 'en',
  rule_code             text NOT NULL,
  approved_text_template text NOT NULL,
  version               text NOT NULL,
  status                controlled_content_status NOT NULL DEFAULT 'DRAFT',
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assessment_version_id, rule_code, version, locale)
);

-- 6.15 development_actions
CREATE TABLE development_actions (
  action_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_code       text NOT NULL,
  library_version   text NOT NULL,
  domain_code       text NOT NULL CHECK (valid_domain_code(domain_code)),
  subdomain_code    text NOT NULL CHECK (valid_subdomain_code(subdomain_code)),
  progression_level progression_level NOT NULL,
  action_text       text NOT NULL,
  age_band          text NOT NULL,
  action_type       text NULL,
  duration_minutes  integer NULL CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
  practice_window   text NULL,
  evidence_status   text NOT NULL,
  control_flags     jsonb NOT NULL DEFAULT '{}'::jsonb,
  active            boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT development_action_subdomain_domain_ck CHECK (subdomain_belongs_to_domain(domain_code, subdomain_code)),
  UNIQUE (action_code, library_version)
);

-- 6.16 reflection_prompts
CREATE TABLE reflection_prompts (
  prompt_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_code    text NOT NULL,
  domain_code    text NOT NULL CHECK (valid_domain_code(domain_code)),
  subdomain_code text NULL CHECK (subdomain_code IS NULL OR valid_subdomain_code(subdomain_code)),
  prompt_text    text NOT NULL,
  age_band       text NOT NULL,
  sequence       integer NOT NULL CHECK (sequence > 0),
  version        text NOT NULL,
  status         controlled_content_status NOT NULL DEFAULT 'DRAFT',
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reflection_prompt_subdomain_domain_ck CHECK (subdomain_code IS NULL OR subdomain_belongs_to_domain(domain_code, subdomain_code)),
  UNIQUE (prompt_code, version)
);
