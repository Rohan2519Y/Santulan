-- SanTulan 2.0 canonical schema — BUILD 01 v3.1 §3, §4, §5 (000/001: roles, extensions, types, helpers).
-- Schema `santulan`. Forward-only. Values marked "-- ASSUMED (D-11)" are not enumerated in the on-disk
-- contract text and are the minimal set the prose implies.
--
-- Application error codes (custom SQLSTATE) raised by the guards in migration 015:
--   SN001 consent gate closed        SN002 version mismatch (Q06)     SN003 invalid state transition
--   SN004 immutable data             SN005 session limit reached      SN006 idempotency-key conflict
--   SN007 value outside frozen scale SN008 attempt locked/not writable SN009 assessment not open
--   SN010 provenance mismatch        SN011 not permitted for this actor

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS santulan;
SET LOCAL search_path TO santulan, public;

-- Roles are cluster-level; docker/init-app-role.sql creates them, this guard covers other environments.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'santulan_worker') THEN
    CREATE ROLE santulan_worker NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

-- ---------------------------------------------------------------- enums
CREATE TYPE institution_type AS ENUM ('SCHOOL', 'COLLEGE', 'UNIVERSITY');                       -- BUILD 01 §14.2
CREATE TYPE institution_status AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');                      -- ASSUMED (D-11)
CREATE TYPE cohort_status AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');                           -- ASSUMED (D-11)
CREATE TYPE developmental_band AS ENUM ('D1', 'D2', 'D3', 'D4');                                -- BUILD 01 §3.2
CREATE TYPE participation_route AS ENUM ('OPEN', 'INSTITUTIONAL');                              -- BUILD 03
CREATE TYPE assessment_track AS ENUM ('ADOLESCENT', 'EMERGING_ADULT');                          -- BUILD 01
CREATE TYPE participant_status AS ENUM ('ACTIVE', 'SUSPENDED', 'WITHDRAWN');                    -- ASSUMED (D-11)
CREATE TYPE consent_type AS ENUM ('PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT', 'ADULT_SELF_CONSENT'); -- BUILD 04
CREATE TYPE consent_relationship AS ENUM ('PARENT', 'GUARDIAN', 'SELF', 'INSTITUTION_DELEGATED'); -- BUILD 04
CREATE TYPE consent_status AS ENUM ('PENDING', 'GRANTED', 'VERIFIED', 'WITHDRAWN');             -- BUILD 01 §5.1
CREATE TYPE content_status AS ENUM ('DRAFT', 'FROZEN', 'RETIRED');                              -- ASSUMED (D-11)
CREATE TYPE assessment_participation_state AS ENUM ('CLOSED', 'OPEN', 'PAUSED', 'STOPPED');     -- BUILD 01/02 (assumed complete)
CREATE TYPE item_keying AS ENUM ('POSITIVE', 'REVERSE');                                        -- BUILD 02 §8
CREATE TYPE item_layer AS ENUM ('CORE', 'V', 'SJT', 'O');                                       -- BUILD 00
CREATE TYPE item_runtime_status AS ENUM ('ACTIVE', 'RETIRED');                                  -- BUILD 06 §4
CREATE TYPE controlled_content_status AS ENUM ('DRAFT', 'APPROVED', 'RETIRED');                 -- ASSUMED (D-11)
CREATE TYPE progression_level AS ENUM ('Foundation', 'Practice', 'Transfer');                   -- BUILD 07 §12
CREATE TYPE attempt_status AS ENUM ('CREATED', 'STARTED', 'IN_PROGRESS', 'PAUSED', 'SUBMITTED',
                                    'SCORING', 'SCORED', 'REPORT_READY', 'QUALITY_HOLD', 'INVALID', 'EXPIRED'); -- BUILD 01 §5.2
CREATE TYPE response_event_type AS ENUM ('SESSION_START', 'SESSION_END', 'PAUSE', 'RESUME', 'RESPONSE_SAVED',
                                         'SUBMIT', 'QUALITY_CHECK_COMPLETED', 'REPORT_RETRY');  -- BUILD 05–07 (complete list ASSUMED)
CREATE TYPE quality_flag_code AS ENUM ('Q01', 'Q02', 'Q03', 'Q04', 'Q05', 'Q06', 'Q07', 'Q08', 'Q09'); -- BUILD 01 §5.4
CREATE TYPE quality_severity AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');                     -- ASSUMED (D-11); CRITICAL required
CREATE TYPE quality_disposition AS ENUM ('UNREVIEWED', 'DISMISSED', 'CONFIRMED', 'ESCALATED');  -- ASSUMED (D-11); UNREVIEWED default
CREATE TYPE evidence_state AS ENUM ('S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'SH');                  -- BUILD 01 §5.3
CREATE TYPE report_generation_status AS ENUM ('PENDING', 'REPORT_READY', 'FAILED_RETRYABLE', 'UNDER_REVIEW', 'NOT_ELIGIBLE'); -- BUILD 07
CREATE TYPE report_section_type AS ENUM ('PROFILE', 'MEANING', 'PATTERN', 'STRENGTH', 'GROWTH',
                                         'PRIORITY', 'ACTION', 'CHANGE', 'UNDER_REVIEW', 'NOT_ELIGIBLE'); -- BUILD 07 §4
CREATE TYPE growth_plan_status AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED');              -- ASSUMED (D-11)
CREATE TYPE growth_goal_status AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED', 'DROPPED');           -- ASSUMED (D-11); PLANNED default
CREATE TYPE pathway_code AS ENUM ('P1', 'P2', 'P3', 'P4', 'P5');                                -- BUILD 07 §13
CREATE TYPE pathway_decision_source AS ENUM ('SYSTEM', 'PARTICIPANT', 'HUMAN_REVIEW');          -- ASSUMED (D-11)
CREATE TYPE pathway_review_outcome AS ENUM ('CONFIRMED', 'CHANGED', 'CLOSED', 'ESCALATED');     -- ASSUMED (D-11)
CREATE TYPE research_export_status AS ENUM ('REQUESTED', 'GENERATING', 'READY', 'FAILED');      -- BUILD 08 §7
CREATE TYPE admin_role AS ENUM ('SUPER_ADMIN', 'INSTITUTION_ADMIN', 'RESEARCH_OPERATOR');       -- BUILD 08 §3
CREATE TYPE admin_status AS ENUM ('ACTIVE', 'SUSPENDED', 'INACTIVE');                           -- ASSUMED (D-11)
CREATE TYPE audit_actor_type AS ENUM ('ADMIN', 'SYSTEM', 'PARTICIPANT');                        -- BUILD 08 §6 (PARTICIPANT ASSUMED)

-- ---------------------------------------------------------------- canonical construct helpers (BUILD 00 §5)
CREATE FUNCTION valid_domain_code(code text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT code IN ('C1','C2','C3','C4','C5','C6','C7') $$;

CREATE FUNCTION valid_subdomain_code(code text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT code = ANY (ARRAY[
  'C1.1','C1.2','C1.3','C1.4','C1.5','C1.6','C1.7',
  'C2.1','C2.2','C2.3','C2.4','C2.5','C2.6','C2.7','C2.8','C2.9','C2.10','C2.11',
  'C3.1','C3.2','C3.3','C3.4','C3.5','C3.6','C3.7','C3.8','C3.9','C3.10','C3.11','C3.12',
  'C4.1','C4.2','C4.3','C4.4','C4.5',
  'C5.1','C5.2','C5.3','C5.4','C5.5','C5.6','C5.7',
  'C6.1','C6.2','C6.3','C6.4','C6.5','C6.6','C6.7','C6.8','C6.9','C6.10',
  'C7A.1','C7A.2','C7A.3','C7A.4','C7A.5','C7A.6',
  'C7B.1','C7B.2','C7B.3','C7B.4','C7B.5','C7B.6','C7B.7',
  'C7C.1','C7C.2','C7C.3','C7C.4','C7C.5','C7C.6','C7C.7'
]) $$;

CREATE FUNCTION subdomain_belongs_to_domain(domain text, subdomain text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT valid_domain_code(domain) AND valid_subdomain_code(subdomain)
      AND CASE WHEN domain = 'C7' THEN subdomain ~ '^C7[ABC]\.'
               ELSE subdomain ~ ('^' || domain || '\.') END $$;

-- ---------------------------------------------------------------- age routing (BUILD 01 §3.1, §3.2)
CREATE FUNCTION resolve_assessment_track(age smallint) RETURNS assessment_track
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT CASE WHEN age BETWEEN 13 AND 17 THEN 'ADOLESCENT'::assessment_track
               WHEN age BETWEEN 18 AND 25 THEN 'EMERGING_ADULT'::assessment_track END $$;

CREATE FUNCTION resolve_developmental_band(age smallint) RETURNS developmental_band
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT CASE WHEN age BETWEEN 13 AND 15 THEN 'D1'::developmental_band
               WHEN age BETWEEN 16 AND 17 THEN 'D2'::developmental_band
               WHEN age BETWEEN 18 AND 20 THEN 'D3'::developmental_band
               WHEN age BETWEEN 21 AND 25 THEN 'D4'::developmental_band END $$;

-- ---------------------------------------------------------------- transaction context (BUILD 01 §4.1, research R-03)
-- Values are set per transaction by the server (set_config(..., true)); an absent value is NULL, so every
-- policy comparison is false => no context, no access.
CREATE FUNCTION ctx_actor_scope() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.actor_scope', true), '') $$;
CREATE FUNCTION ctx_participant_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.participant_id', true), '')::uuid $$;
CREATE FUNCTION ctx_admin_user_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.admin_user_id', true), '')::uuid $$;
CREATE FUNCTION ctx_institution_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.institution_id', true), '')::uuid $$;
CREATE FUNCTION ctx_is_privileged() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT COALESCE(ctx_actor_scope() IN ('SUPER_ADMIN', 'SYSTEM'), false) $$;
