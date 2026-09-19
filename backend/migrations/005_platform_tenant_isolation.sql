-- Platform SQL database: tenant isolation (row-level security).
--
-- Exactly the mechanism in docs/SQL-Database-Schema.md section 4: RLS enabled on each
-- school-owned table (every table carrying a school_id column) with one policy,
-- tenant_isolation, comparing school_id to the school the application sets once per
-- request/transaction:
--
--     SELECT set_config('app.current_school_id', '<school uuid>', true);   -- (= SET LOCAL)
--
-- The document's example is  school_id = current_setting('app.current_school_id')::uuid.
-- The only change here is the two-argument form current_setting(name, true) wrapped in
-- NULLIF(..., ''): with no school set it yields NULL, so the comparison is NULL and no row
-- qualifies - the "returns zero rows instead of every school's rows" behaviour the
-- document describes - rather than raising "unrecognized configuration parameter".
--
-- Platform-scope (cross-school) access is a separate role with BYPASSRLS, as the document
-- says; no bypass setting is introduced here. Table owners and superusers are not subject
-- to RLS, so isolation applies to the non-owner application role (app_runtime).

ALTER TABLE accounts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_assignments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalation_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records      ENABLE ROW LEVEL SECURITY;
ALTER TABLE scp_consents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_signals        ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_guidance_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_sessions       ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON accounts
    USING (school_id = NULLIF(current_setting('app.current_school_id', true), '')::uuid);
CREATE POLICY tenant_isolation ON school_assignments
    USING (school_id = NULLIF(current_setting('app.current_school_id', true), '')::uuid);
CREATE POLICY tenant_isolation ON escalation_events
    USING (school_id = NULLIF(current_setting('app.current_school_id', true), '')::uuid);
CREATE POLICY tenant_isolation ON consent_records
    USING (school_id = NULLIF(current_setting('app.current_school_id', true), '')::uuid);
CREATE POLICY tenant_isolation ON scp_consents
    USING (school_id = NULLIF(current_setting('app.current_school_id', true), '')::uuid);
CREATE POLICY tenant_isolation ON queue_signals
    USING (school_id = NULLIF(current_setting('app.current_school_id', true), '')::uuid);
CREATE POLICY tenant_isolation ON class_guidance_state
    USING (school_id = NULLIF(current_setting('app.current_school_id', true), '')::uuid);
CREATE POLICY tenant_isolation ON group_sessions
    USING (school_id = NULLIF(current_setting('app.current_school_id', true), '')::uuid);
