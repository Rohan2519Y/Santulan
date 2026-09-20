-- SanTulan 2.0 canonical schema — BUILD 01 v3.1 §6.26, §6.28 (007: research exports and audit).
SET LOCAL search_path TO santulan, public;

-- 6.26 research_exports
CREATE TABLE research_exports (
  export_id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by                 uuid NOT NULL REFERENCES admin_users(admin_user_id) ON DELETE RESTRICT,
  filters                      jsonb NOT NULL DEFAULT '{}'::jsonb,
  anonymisation_version        text NOT NULL,
  source_assessment_version_id uuid NOT NULL REFERENCES assessment_versions(assessment_version_id) ON DELETE RESTRICT,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  status                       research_export_status NOT NULL DEFAULT 'REQUESTED',
  file_reference               text NULL,
  completed_at                 timestamptz NULL
);

-- 6.28 audit_logs
CREATE TABLE audit_logs (
  log_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type     audit_actor_type NOT NULL,
  actor_id       uuid NULL,
  action_type    text NOT NULL,
  target_entity  text NOT NULL,
  target_id      uuid NULL,
  previous_state jsonb NULL,
  new_state      jsonb NULL,
  reason         text NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  correlation_id text NULL
);

-- BUILD 01 §6 / BUILD 03 T03-028 / BUILD 05 B05-041: exactly 28 canonical base tables.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM information_schema.tables WHERE table_schema = 'santulan' AND table_type = 'BASE TABLE';
  IF n <> 28 THEN
    RAISE EXCEPTION 'santulan schema must contain exactly 28 tables, found %', n;
  END IF;
END $$;
