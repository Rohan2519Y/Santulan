-- SanTulan 2.0 canonical schema — BUILD 01 v3.1 §6.19–6.25 (006: growth plans and pathways).
-- Primary keys of these tables are named `id` in the contract.
SET LOCAL search_path TO santulan, public;

-- 6.19 growth_plans
CREATE TABLE growth_plans (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id        uuid NOT NULL REFERENCES participants(participant_id) ON DELETE RESTRICT,
  source_attempt_id     uuid NOT NULL REFERENCES assessment_attempts(attempt_id) ON DELETE RESTRICT,
  assessment_version_id uuid NOT NULL REFERENCES assessment_versions(assessment_version_id) ON DELETE RESTRICT,
  growth_plan_version   text NOT NULL,
  status                growth_plan_status NOT NULL DEFAULT 'DRAFT',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- 6.20 growth_priorities
CREATE TABLE growth_priorities (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id              uuid NOT NULL REFERENCES growth_plans(id) ON DELETE CASCADE,
  domain_code          text NOT NULL CHECK (valid_domain_code(domain_code)),
  candidate_rank       integer NULL CHECK (candidate_rank IS NULL OR candidate_rank > 0),
  participant_selected boolean NOT NULL DEFAULT false,
  priority_text        text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- 6.21 growth_goals
CREATE TABLE growth_goals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  priority_id     uuid NOT NULL UNIQUE REFERENCES growth_priorities(id) ON DELETE CASCADE,
  goal_text       text NOT NULL,
  cue             text NULL,
  response        text NULL,
  fallback_action text NULL,
  frequency       text NULL,
  review_date     date NULL,
  status          growth_goal_status NOT NULL DEFAULT 'PLANNED',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 6.22 growth_actions
CREATE TABLE growth_actions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id        uuid NOT NULL REFERENCES growth_goals(id) ON DELETE CASCADE,
  action_code    text NOT NULL,
  action_version text NOT NULL,
  action_text    text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (action_code, action_version) REFERENCES development_actions(action_code, library_version) ON DELETE RESTRICT
);

-- 6.23 growth_reviews
CREATE TABLE growth_reviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id       uuid NOT NULL REFERENCES growth_goals(id) ON DELETE CASCADE,
  review_date   date NOT NULL,
  what_happened text NULL,
  barrier       text NULL,
  learning      text NULL,
  adjustment    text NULL,
  evidence_note text NULL,
  next_step     text NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 6.24 pathway_decisions
CREATE TABLE pathway_decisions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id         uuid NOT NULL REFERENCES participants(participant_id) ON DELETE RESTRICT,
  source_attempt_id      uuid NOT NULL REFERENCES assessment_attempts(attempt_id) ON DELETE RESTRICT,
  domain_code            text NULL CHECK (domain_code IS NULL OR valid_domain_code(domain_code)),
  pathway_code           pathway_code NOT NULL,
  trigger_code           text NOT NULL,
  evidence_state         evidence_state NOT NULL,
  decision_source        pathway_decision_source NOT NULL,
  decision_reason        text NOT NULL,
  status                 text NOT NULL CHECK (status IN ('S0','S1','S2','S3','S4','S5','S6','S7')),
  created_at             timestamptz NOT NULL DEFAULT now(),
  review_due             date NULL,
  policy_version         text NOT NULL,
  pathway_engine_version text NOT NULL
);

-- 6.25 pathway_reviews
CREATE TABLE pathway_reviews (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pathway_decision_id uuid NOT NULL REFERENCES pathway_decisions(id) ON DELETE CASCADE,
  outcome             pathway_review_outcome NOT NULL,
  evidence_note       text NULL,
  support_change      text NULL,
  next_step           text NULL,
  reviewed_by         uuid NULL REFERENCES admin_users(admin_user_id) ON DELETE SET NULL,
  reviewed_at         timestamptz NOT NULL DEFAULT now()
);
