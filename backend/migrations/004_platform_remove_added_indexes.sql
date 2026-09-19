-- Platform SQL database: strict conformance to docs/SQL-Database-Schema.md.
--
-- 003_platform_schema.sql (already applied) created nine indexes that the schema
-- document does not define. The requirement for this database is the design in that
-- document and nothing added on top, so they are removed here. (003 is not edited:
-- the migration runner records applied files by name and never re-runs them.)
--
-- Only the nine indexes added in 003's "Added indexes" section are dropped; every
-- index the document defines is untouched. The document itself notes (section 5) that
-- extra composite indexes are added "once real query patterns are known".

DROP INDEX IF EXISTS idx_scp_sessions_student_checkpoint;
DROP INDEX IF EXISTS idx_escalation_school_status;
DROP INDEX IF EXISTS idx_escalation_events_student;
DROP INDEX IF EXISTS idx_consent_records_student;
DROP INDEX IF EXISTS idx_scp_consents_student;
DROP INDEX IF EXISTS idx_scp_assents_student;
DROP INDEX IF EXISTS idx_queue_signals_student;
DROP INDEX IF EXISTS idx_protocol_route_events_student;
DROP INDEX IF EXISTS idx_queue_signals_school;
