-- SanTulan 2.0 canonical schema — BUILD 01 v3.1 §6.9–6.11 (004: assessment delivery).
SET LOCAL search_path TO santulan, public;

-- 6.9 assessment_attempts
CREATE TABLE assessment_attempts (
  attempt_id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id                uuid NOT NULL REFERENCES participants(participant_id) ON DELETE RESTRICT,
  assessment_version_id         uuid NOT NULL REFERENCES assessment_versions(assessment_version_id) ON DELETE RESTRICT,
  age_years_at_attempt          smallint NOT NULL CHECK (age_years_at_attempt BETWEEN 13 AND 25),
  developmental_band_at_attempt developmental_band GENERATED ALWAYS AS (resolve_developmental_band(age_years_at_attempt)) STORED,
  status                        attempt_status NOT NULL DEFAULT 'CREATED',
  session_count                 integer NOT NULL DEFAULT 0 CHECK (session_count BETWEEN 0 AND 4),
  created_at                    timestamptz NOT NULL DEFAULT now(),
  started_at                    timestamptz NULL,
  submitted_at                  timestamptz NULL,
  completed_at                  timestamptz NULL,
  last_activity_at              timestamptz NULL,
  scoring_version               text NULL,
  lock_version                  bigint NOT NULL DEFAULT 0
);

-- 6.10 responses
CREATE TABLE responses (
  response_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id             uuid NOT NULL REFERENCES assessment_attempts(attempt_id) ON DELETE RESTRICT,
  item_id                uuid NOT NULL REFERENCES items(item_id) ON DELETE RESTRICT,
  response_value         text NOT NULL,
  response_version       integer NOT NULL CHECK (response_version > 0),
  is_current             boolean NOT NULL DEFAULT true,
  supersedes_response_id uuid NULL REFERENCES responses(response_id) ON DELETE RESTRICT,
  response_time_ms       integer NULL CHECK (response_time_ms IS NULL OR response_time_ms >= 0),
  presented_order        integer NULL CHECK (presented_order IS NULL OR presented_order > 0),
  answered_at            timestamptz NOT NULL DEFAULT now(),
  idempotency_key        text NOT NULL UNIQUE
);

-- 6.11 response_events
CREATE TABLE response_events (
  event_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id     uuid NOT NULL REFERENCES assessment_attempts(attempt_id) ON DELETE RESTRICT,
  item_id        uuid NULL REFERENCES items(item_id) ON DELETE RESTRICT,
  event_type     response_event_type NOT NULL,
  session_number integer NULL CHECK (session_number BETWEEN 1 AND 4),
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb
);
