-- FR-016 defense-in-depth (T053): app-layer ownership checks are the primary
-- control (every participant-facing controller scopes by participant_profile_id
-- already); this adds a database-enforced backstop on the most sensitive
-- table (raw immutable responses, BF-01) per research.md §2's set_config
-- pattern, adapted to app.participant_profile_id since this feature's data
-- model has no institution_id column.
ALTER TABLE "responses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "responses" FORCE ROW LEVEL SECURITY;

CREATE POLICY "responses_participant_or_admin_bypass" ON "responses"
  USING (
    "participant_profile_id" = NULLIF(current_setting('app.participant_profile_id', true), '')
    OR NULLIF(current_setting('app.bypass_rls', true), '') = 'true'
  )
  WITH CHECK (
    "participant_profile_id" = NULLIF(current_setting('app.participant_profile_id', true), '')
    OR NULLIF(current_setting('app.bypass_rls', true), '') = 'true'
  );
