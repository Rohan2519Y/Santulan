-- SanTulan 2.0 canonical schema — BUILD 01 v3.1 §5, §7 (008: state machines, provenance, immutability, API functions,
-- release gates). Includes the BUILD 05 hardening of save_response (payload-bound idempotency, advisory lock —
-- B05-AUD-001/009). Submission-key idempotency, the session-number trigger and removal of the legacy
-- submit_attempt(uuid) follow in the BUILD 05 migration.
--
-- Discrepancy recorded (Principle I): BUILD 01 §7 says "<60% completeness: no raw score"; BUILD 06 §7 says exactly
-- 40% missing (=60% completeness) is MS04 (no raw score). This file enforces BUILD 01 verbatim (< 0.60); the BUILD 06
-- scorer writes NULL at <= 0.60.
SET LOCAL search_path TO santulan, public;

ALTER DEFAULT PRIVILEGES IN SCHEMA santulan REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Helpers from 008 that reference other santulan objects must not depend on the caller's search_path.
ALTER FUNCTION subdomain_belongs_to_domain(text, text) SET search_path = santulan, public, pg_temp;
ALTER FUNCTION resolve_assessment_track(smallint) SET search_path = santulan, public, pg_temp;
ALTER FUNCTION resolve_developmental_band(smallint) SET search_path = santulan, public, pg_temp;
ALTER FUNCTION ctx_is_privileged() SET search_path = santulan, public, pg_temp;

-- ================================================================ consent gate (BUILD 01 §3.1, §5.1)
CREATE FUNCTION participant_has_required_consent(p_participant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
  SELECT COALESCE((
    SELECT CASE
      WHEN p.is_minor THEN
        EXISTS (SELECT 1 FROM consents c WHERE c.participant_id = p.participant_id
                  AND c.consent_type = 'PARENT_GUARDIAN_CONSENT' AND c.status = 'VERIFIED' AND c.withdrawn_at IS NULL)
        AND EXISTS (SELECT 1 FROM consents c WHERE c.participant_id = p.participant_id
                  AND c.consent_type = 'STUDENT_ASSENT' AND c.status = 'VERIFIED' AND c.withdrawn_at IS NULL)
      ELSE
        EXISTS (SELECT 1 FROM consents c WHERE c.participant_id = p.participant_id
                  AND c.consent_type = 'ADULT_SELF_CONSENT' AND c.status = 'VERIFIED' AND c.withdrawn_at IS NULL)
    END
    FROM participants p WHERE p.participant_id = p_participant
  ), false)
$$;

CREATE FUNCTION validate_consent_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
DECLARE v_minor boolean;
BEGIN
  SELECT is_minor INTO v_minor FROM participants WHERE participant_id = NEW.participant_id;
  IF v_minor IS NULL THEN
    RETURN NEW;  -- unknown participant: the foreign key reports it
  END IF;

  -- type / age compatibility
  IF v_minor AND NEW.consent_type = 'ADULT_SELF_CONSENT' THEN
    RAISE EXCEPTION 'a minor cannot hold ADULT_SELF_CONSENT' USING ERRCODE = '23514';
  END IF;
  IF NOT v_minor AND NEW.consent_type IN ('PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT') THEN
    RAISE EXCEPTION 'an adult cannot hold % (adult self-consent applies)', NEW.consent_type USING ERRCODE = '23514';
  END IF;
  -- type / giver compatibility
  IF NEW.consent_type = 'PARENT_GUARDIAN_CONSENT' AND NEW.giver_relationship = 'SELF' THEN
    RAISE EXCEPTION 'parent/guardian consent cannot be given by SELF' USING ERRCODE = '23514';
  END IF;
  IF NEW.consent_type IN ('STUDENT_ASSENT', 'ADULT_SELF_CONSENT') AND NEW.giver_relationship <> 'SELF' THEN
    RAISE EXCEPTION '% must be given by SELF', NEW.consent_type USING ERRCODE = '23514';
  END IF;
  -- status / timestamp consistency
  IF NEW.status IN ('GRANTED', 'VERIFIED') AND NEW.granted_at IS NULL THEN
    RAISE EXCEPTION 'status % requires granted_at', NEW.status USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'VERIFIED' AND NEW.verified_at IS NULL THEN
    RAISE EXCEPTION 'VERIFIED requires verified_at' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'WITHDRAWN' AND NEW.withdrawn_at IS NULL THEN
    RAISE EXCEPTION 'WITHDRAWN requires withdrawn_at' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' THEN
      RAISE EXCEPTION 'a consent record must be created PENDING' USING ERRCODE = 'SN003';
    END IF;
  ELSE
    IF OLD.status = 'WITHDRAWN' AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'WITHDRAWN is terminal; create a new record for re-consent' USING ERRCODE = 'SN003';
    END IF;
    IF OLD.participant_id <> NEW.participant_id OR OLD.consent_type <> NEW.consent_type
       OR OLD.protocol_version <> NEW.protocol_version THEN
      RAISE EXCEPTION 'participant, type and protocol version of a consent are immutable' USING ERRCODE = 'SN004';
    END IF;
    IF (OLD.granted_at IS NOT NULL AND NEW.granted_at IS DISTINCT FROM OLD.granted_at)
       OR (OLD.verified_at IS NOT NULL AND NEW.verified_at IS DISTINCT FROM OLD.verified_at)
       OR (OLD.withdrawn_at IS NOT NULL AND NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at) THEN
      RAISE EXCEPTION 'consent timestamps are immutable once set' USING ERRCODE = 'SN004';
    END IF;
    IF OLD.status <> NEW.status AND NOT (
         (OLD.status = 'PENDING'  AND NEW.status IN ('GRANTED', 'WITHDRAWN')) OR
         (OLD.status = 'GRANTED'  AND NEW.status IN ('VERIFIED', 'WITHDRAWN')) OR
         (OLD.status = 'VERIFIED' AND NEW.status = 'WITHDRAWN')) THEN
      RAISE EXCEPTION 'consent transition % -> % is not allowed', OLD.status, NEW.status USING ERRCODE = 'SN003';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_consents_validate BEFORE INSERT OR UPDATE ON consents
  FOR EACH ROW EXECUTE FUNCTION validate_consent_row();

-- ================================================================ participant scope (BUILD 01 §7 "Participant scope")
CREATE FUNCTION enforce_participant_scope() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
BEGIN
  IF NEW.cohort_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM cohorts c WHERE c.cohort_id = NEW.cohort_id AND c.institution_id = NEW.institution_id) THEN
    RAISE EXCEPTION 'the cohort does not belong to the participant institution' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.santulan_id <> OLD.santulan_id THEN
    RAISE EXCEPTION 'santulan_id is never reassigned' USING ERRCODE = 'SN004';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_participants_scope BEFORE INSERT OR UPDATE ON participants
  FOR EACH ROW EXECUTE FUNCTION enforce_participant_scope();

-- ================================================================ frozen content (BUILD 01 §4, §7 "Frozen content")
CREATE FUNCTION guard_frozen_scale() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
BEGIN
  IF OLD.status = 'FROZEN' THEN
    RAISE EXCEPTION 'a FROZEN response scale is immutable; create a new version' USING ERRCODE = 'SN004';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER trg_scales_frozen BEFORE UPDATE OR DELETE ON response_scales
  FOR EACH ROW EXECUTE FUNCTION guard_frozen_scale();

CREATE FUNCTION guard_frozen_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
DECLARE v_scale content_status;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'FROZEN' THEN
      RAISE EXCEPTION 'a FROZEN assessment version cannot be deleted' USING ERRCODE = 'SN004';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'FROZEN' THEN
    -- only the release state may change on a frozen version (BUILD 01 §12.1)
    IF (to_jsonb(NEW) - 'participation_state') <> (to_jsonb(OLD) - 'participation_state') THEN
      RAISE EXCEPTION 'a FROZEN assessment version is immutable; only participation_state may change' USING ERRCODE = 'SN004';
    END IF;
  ELSIF NEW.status = 'FROZEN' THEN
    SELECT status INTO v_scale FROM response_scales WHERE response_scale_id = NEW.response_scale_id;
    IF v_scale IS DISTINCT FROM 'FROZEN' THEN
      RAISE EXCEPTION 'freeze the response scale before freezing the assessment version' USING ERRCODE = 'SN003';
    END IF;
  END IF;
  IF NEW.participation_state = 'OPEN' AND NEW.status <> 'FROZEN' THEN
    RAISE EXCEPTION 'participation can only be opened on a FROZEN version' USING ERRCODE = 'SN009';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_versions_frozen BEFORE UPDATE OR DELETE ON assessment_versions
  FOR EACH ROW EXECUTE FUNCTION guard_frozen_version();

CREATE FUNCTION guard_frozen_item() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
DECLARE v_status content_status;
BEGIN
  SELECT status INTO v_status FROM assessment_versions
   WHERE assessment_version_id = CASE WHEN TG_OP = 'INSERT' THEN NEW.assessment_version_id ELSE OLD.assessment_version_id END;
  IF v_status = 'FROZEN' THEN
    RAISE EXCEPTION 'items of a FROZEN assessment version are immutable' USING ERRCODE = 'SN004';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER trg_items_frozen BEFORE INSERT OR UPDATE OR DELETE ON items
  FOR EACH ROW EXECUTE FUNCTION guard_frozen_item();

-- ================================================================ attempts (BUILD 01 §5.2, §7)
CREATE FUNCTION enforce_attempt_create() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
DECLARE p participants%ROWTYPE; v assessment_versions%ROWTYPE; s content_status;
BEGIN
  SELECT * INTO p FROM participants WHERE participant_id = NEW.participant_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT * INTO v FROM assessment_versions WHERE assessment_version_id = NEW.assessment_version_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF p.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'participant is not ACTIVE' USING ERRCODE = 'SN011';
  END IF;
  IF NEW.age_years_at_attempt NOT BETWEEN v.participant_min_age AND v.participant_max_age THEN
    RAISE EXCEPTION 'age % is outside the range % of assessment version %', NEW.age_years_at_attempt,
      v.participant_min_age || '-' || v.participant_max_age, v.version_label USING ERRCODE = '23514';
  END IF;
  IF NOT participant_has_required_consent(NEW.participant_id) THEN
    RAISE EXCEPTION 'the required VERIFIED consent records are missing' USING ERRCODE = 'SN001';
  END IF;
  SELECT status INTO s FROM response_scales WHERE response_scale_id = v.response_scale_id;
  IF v.status <> 'FROZEN' OR s IS DISTINCT FROM 'FROZEN' OR v.participation_state <> 'OPEN' THEN
    RAISE EXCEPTION 'assessment version % is not open for participation', v.version_label USING ERRCODE = 'SN009';
  END IF;
  IF NEW.status <> 'CREATED' OR NEW.session_count <> 0 THEN
    RAISE EXCEPTION 'an attempt starts CREATED with no sessions' USING ERRCODE = 'SN003';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_attempts_create BEFORE INSERT ON assessment_attempts
  FOR EACH ROW EXECUTE FUNCTION enforce_attempt_create();

CREATE FUNCTION enforce_attempt_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
BEGIN
  IF NEW.participant_id <> OLD.participant_id OR NEW.assessment_version_id <> OLD.assessment_version_id
     OR NEW.age_years_at_attempt <> OLD.age_years_at_attempt THEN
    RAISE EXCEPTION 'participant, assessment version and age of an attempt are immutable' USING ERRCODE = 'SN004';
  END IF;
  IF NEW.session_count < OLD.session_count OR NEW.session_count > OLD.session_count + 1 THEN
    RAISE EXCEPTION 'session_count may only increase by one per session boundary' USING ERRCODE = 'SN004';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'CREATED'      AND NEW.status IN ('STARTED', 'EXPIRED', 'INVALID')) OR
       (OLD.status = 'STARTED'      AND NEW.status IN ('IN_PROGRESS', 'PAUSED', 'SUBMITTED', 'QUALITY_HOLD', 'INVALID', 'EXPIRED')) OR
       (OLD.status = 'IN_PROGRESS'  AND NEW.status IN ('PAUSED', 'SUBMITTED', 'QUALITY_HOLD', 'INVALID', 'EXPIRED')) OR
       (OLD.status = 'PAUSED'       AND NEW.status IN ('IN_PROGRESS', 'SUBMITTED', 'QUALITY_HOLD', 'INVALID', 'EXPIRED')) OR
       (OLD.status = 'SUBMITTED'    AND NEW.status IN ('SCORING', 'QUALITY_HOLD', 'INVALID')) OR
       (OLD.status = 'SCORING'      AND NEW.status IN ('SCORED', 'QUALITY_HOLD', 'INVALID')) OR
       (OLD.status = 'SCORED'       AND NEW.status IN ('REPORT_READY', 'QUALITY_HOLD', 'INVALID')) OR
       (OLD.status = 'QUALITY_HOLD' AND NEW.status IN ('SCORING', 'SCORED', 'INVALID', 'EXPIRED'))) THEN
    RAISE EXCEPTION 'attempt transition % -> % is not allowed', OLD.status, NEW.status USING ERRCODE = 'SN003';
  END IF;
  NEW.lock_version := OLD.lock_version + 1;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_attempts_update BEFORE UPDATE ON assessment_attempts
  FOR EACH ROW EXECUTE FUNCTION enforce_attempt_update();

-- ================================================================ responses (BUILD 01 §7 "Response versioning")
CREATE FUNCTION validate_response_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
DECLARE a assessment_attempts%ROWTYPE; i items%ROWTYPE; v_points integer; v_max integer; v_prior responses%ROWTYPE;
BEGIN
  SELECT * INTO a FROM assessment_attempts WHERE attempt_id = NEW.attempt_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT * INTO i FROM items WHERE item_id = NEW.item_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF a.status NOT IN ('STARTED', 'IN_PROGRESS') THEN
    RAISE EXCEPTION 'responses cannot be written while the attempt is %', a.status USING ERRCODE = 'SN008';
  END IF;
  IF i.assessment_version_id <> a.assessment_version_id THEN
    RAISE EXCEPTION 'item belongs to another assessment version (Q06 version mismatch)' USING ERRCODE = 'SN002';
  END IF;
  IF i.layer <> 'CORE' OR i.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'only ACTIVE CORE items are answerable in the pilot' USING ERRCODE = '23514';
  END IF;
  SELECT s.scale_points INTO v_points
    FROM assessment_versions av JOIN response_scales s USING (response_scale_id)
   WHERE av.assessment_version_id = a.assessment_version_id;
  IF NEW.response_value !~ '^[0-9]+$' OR NEW.response_value::integer NOT BETWEEN 1 AND v_points THEN
    RAISE EXCEPTION 'response value % is outside the frozen 1-% scale', NEW.response_value, v_points USING ERRCODE = 'SN007';
  END IF;
  IF NOT NEW.is_current THEN
    RAISE EXCEPTION 'a new response version is inserted as the CURRENT version' USING ERRCODE = '23514';
  END IF;

  SELECT max(response_version) INTO v_max FROM responses WHERE attempt_id = NEW.attempt_id AND item_id = NEW.item_id;
  IF v_max IS NULL THEN
    IF NEW.response_version <> 1 OR NEW.supersedes_response_id IS NOT NULL THEN
      RAISE EXCEPTION 'the first response version is 1 and supersedes nothing' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT * INTO v_prior FROM responses WHERE attempt_id = NEW.attempt_id AND item_id = NEW.item_id AND response_version = v_max;
    IF NEW.response_version <> v_max + 1 OR NEW.supersedes_response_id IS DISTINCT FROM v_prior.response_id THEN
      RAISE EXCEPTION 'response versions must be contiguous and supersede the immediate prior version' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_responses_validate BEFORE INSERT ON responses
  FOR EACH ROW EXECUTE FUNCTION validate_response_insert();

-- Raw responses: content is immutable for every role; the only permitted change is retiring is_current.
CREATE FUNCTION guard_response_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'raw responses are append-only and cannot be deleted' USING ERRCODE = 'SN004';
  END IF;
  IF OLD.is_current AND NOT NEW.is_current
     AND (to_jsonb(NEW) - 'is_current') = (to_jsonb(OLD) - 'is_current') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'raw responses are immutable; append a new version instead' USING ERRCODE = 'SN004';
END $$;
CREATE TRIGGER trg_responses_immutable BEFORE UPDATE OR DELETE ON responses
  FOR EACH ROW EXECUTE FUNCTION guard_response_mutation();

-- ================================================================ scoring / report / growth / pathway provenance (BUILD 01 §7)
CREATE FUNCTION validate_score_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
DECLARE a assessment_attempts%ROWTYPE;
BEGIN
  SELECT * INTO a FROM assessment_attempts WHERE attempt_id = NEW.attempt_id;
  IF FOUND AND (a.participant_id <> NEW.participant_id OR a.assessment_version_id <> NEW.assessment_version_id) THEN
    RAISE EXCEPTION 'score participant and assessment version must match the attempt' USING ERRCODE = 'SN010';
  END IF;
  IF NEW.completeness_rate < 0.60 AND NEW.raw_score IS NOT NULL THEN
    RAISE EXCEPTION 'below 60%% completeness no raw score is allowed' USING ERRCODE = '23514';
  END IF;
  IF NEW.completeness_rate <= 0.80 AND NEW.score_status IN ('S2', 'S3', 'S4', 'S5') THEN
    RAISE EXCEPTION 'at or below 80%% completeness participant interpretation (S2+) is prohibited' USING ERRCODE = '23514';
  END IF;
  IF NEW.score_status IN ('S3', 'S4', 'S5')
     AND COALESCE(current_setting('app.allow_advanced_evidence_states', true), '') <> 'on' THEN
    RAISE EXCEPTION 'advanced evidence states S3-S5 require the server release gate' USING ERRCODE = 'SN011';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_scores_validate BEFORE INSERT ON score_results
  FOR EACH ROW EXECUTE FUNCTION validate_score_row();

CREATE FUNCTION validate_report_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
DECLARE a assessment_attempts%ROWTYPE;
BEGIN
  SELECT * INTO a FROM assessment_attempts WHERE attempt_id = NEW.attempt_id;
  IF FOUND AND a.participant_id <> NEW.participant_id THEN
    RAISE EXCEPTION 'report participant must match the attempt participant' USING ERRCODE = 'SN010';
  END IF;
  IF FOUND AND NEW.generation_status = 'REPORT_READY'
     AND (TG_OP = 'INSERT' OR OLD.generation_status IS DISTINCT FROM 'REPORT_READY')
     AND a.status <> 'SCORED' THEN
    RAISE EXCEPTION 'a report can become REPORT_READY only for a SCORED attempt (attempt is %)', a.status USING ERRCODE = 'SN010';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_reports_validate BEFORE INSERT OR UPDATE ON reports
  FOR EACH ROW EXECUTE FUNCTION validate_report_row();

CREATE FUNCTION validate_report_section_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
DECLARE v_status report_generation_status;
BEGIN
  IF NEW.is_released_to_participant THEN
    SELECT generation_status INTO v_status FROM reports WHERE report_id = NEW.report_id;
    IF v_status IS NULL OR v_status NOT IN ('REPORT_READY', 'UNDER_REVIEW', 'NOT_ELIGIBLE') THEN
      RAISE EXCEPTION 'report sections are released only after the report is REPORT_READY (or a terminal T11/T12 state)' USING ERRCODE = 'SN010';
    END IF;
    IF NEW.section_type IN ('PRIORITY', 'ACTION')
       AND COALESCE(current_setting('app.allow_development_release', true), '') <> 'on' THEN
      RAISE EXCEPTION 'PRIORITY/ACTION sections need the development release gate' USING ERRCODE = 'SN011';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_report_sections_validate BEFORE INSERT OR UPDATE ON report_sections
  FOR EACH ROW EXECUTE FUNCTION validate_report_section_row();

CREATE FUNCTION validate_growth_plan_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
DECLARE a assessment_attempts%ROWTYPE;
BEGIN
  SELECT * INTO a FROM assessment_attempts WHERE attempt_id = NEW.source_attempt_id;
  IF FOUND AND (a.participant_id <> NEW.participant_id OR a.assessment_version_id <> NEW.assessment_version_id) THEN
    RAISE EXCEPTION 'growth plan participant and version must match the source attempt' USING ERRCODE = 'SN010';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_growth_plans_validate BEFORE INSERT ON growth_plans
  FOR EACH ROW EXECUTE FUNCTION validate_growth_plan_row();

CREATE FUNCTION validate_pathway_decision_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
DECLARE a assessment_attempts%ROWTYPE;
BEGIN
  SELECT * INTO a FROM assessment_attempts WHERE attempt_id = NEW.source_attempt_id;
  IF FOUND AND a.participant_id <> NEW.participant_id THEN
    RAISE EXCEPTION 'pathway participant must match the source attempt' USING ERRCODE = 'SN010';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_pathway_decisions_validate BEFORE INSERT ON pathway_decisions
  FOR EACH ROW EXECUTE FUNCTION validate_pathway_decision_row();

-- ================================================================ audit immutability and lineage delete guard
CREATE FUNCTION guard_audit_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = 'SN004';
END $$;
CREATE TRIGGER trg_audit_immutable BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION guard_audit_mutation();

CREATE FUNCTION block_lineage_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
BEGIN
  RAISE EXCEPTION '% rows are never hard-deleted (status-based archival only)', TG_TABLE_NAME USING ERRCODE = 'SN004';
END $$;
CREATE TRIGGER trg_no_delete BEFORE DELETE ON institutions FOR EACH ROW EXECUTE FUNCTION block_lineage_delete();
CREATE TRIGGER trg_no_delete BEFORE DELETE ON cohorts FOR EACH ROW EXECUTE FUNCTION block_lineage_delete();
CREATE TRIGGER trg_no_delete BEFORE DELETE ON participants FOR EACH ROW EXECUTE FUNCTION block_lineage_delete();
CREATE TRIGGER trg_no_delete BEFORE DELETE ON participant_cohort_history FOR EACH ROW EXECUTE FUNCTION block_lineage_delete();
CREATE TRIGGER trg_no_delete BEFORE DELETE ON consents FOR EACH ROW EXECUTE FUNCTION block_lineage_delete();
CREATE TRIGGER trg_no_delete BEFORE DELETE ON assessment_attempts FOR EACH ROW EXECUTE FUNCTION block_lineage_delete();
CREATE TRIGGER trg_no_delete BEFORE DELETE ON response_events FOR EACH ROW EXECUTE FUNCTION block_lineage_delete();
CREATE TRIGGER trg_no_delete BEFORE DELETE ON quality_flags FOR EACH ROW EXECUTE FUNCTION block_lineage_delete();
CREATE TRIGGER trg_no_delete BEFORE DELETE ON score_results FOR EACH ROW EXECUTE FUNCTION block_lineage_delete();
CREATE TRIGGER trg_no_delete BEFORE DELETE ON reports FOR EACH ROW EXECUTE FUNCTION block_lineage_delete();
CREATE TRIGGER trg_no_delete BEFORE DELETE ON admin_users FOR EACH ROW EXECUTE FUNCTION block_lineage_delete();

-- ================================================================ delivery procedures (BUILD 01 §7.1; PUBLIC revoked below)
-- These run as the owner (bypassing table RLS), so each verifies the caller itself: a PARTICIPANT context may act
-- only on its own attempt; SUPER_ADMIN / SYSTEM may act on any.
CREATE FUNCTION assert_attempt_actor(p_participant uuid) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = santulan, public, pg_temp AS
$$
BEGIN
  IF NOT (ctx_is_privileged() OR (ctx_actor_scope() = 'PARTICIPANT' AND p_participant = ctx_participant_id())) THEN
    RAISE EXCEPTION 'the current actor may not act on this attempt' USING ERRCODE = 'SN011';
  END IF;
END $$;

CREATE FUNCTION save_response(p_attempt uuid, p_item uuid, p_value text, p_time integer, p_order integer, p_idempotency text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
DECLARE a assessment_attempts%ROWTYPE; ex responses%ROWTYPE; v_prior responses%ROWTYPE; v_version integer; v_id uuid;
BEGIN
  IF p_idempotency IS NULL OR btrim(p_idempotency) = '' THEN
    RAISE EXCEPTION 'an idempotency key is required' USING ERRCODE = '23514';
  END IF;
  -- Same-key replays (including concurrent ones) are serialised before the lookup (B05-AUD-009).
  PERFORM pg_advisory_xact_lock(hashtextextended('santulan.save_response:' || p_idempotency, 0));

  SELECT * INTO a FROM assessment_attempts WHERE attempt_id = p_attempt FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'attempt % not found', p_attempt USING ERRCODE = 'P0002';
  END IF;
  PERFORM assert_attempt_actor(a.participant_id);

  SELECT * INTO ex FROM responses WHERE idempotency_key = p_idempotency;
  IF FOUND THEN
    -- A key is a safe retry only when the whole payload matches (B05-AUD-001).
    IF ex.attempt_id = p_attempt AND ex.item_id = p_item AND ex.response_value = p_value
       AND ex.response_time_ms IS NOT DISTINCT FROM p_time AND ex.presented_order IS NOT DISTINCT FROM p_order THEN
      RETURN ex.response_id;
    END IF;
    RAISE EXCEPTION 'idempotency key reused with a different payload' USING ERRCODE = 'SN006';
  END IF;

  SELECT * INTO v_prior FROM responses WHERE attempt_id = p_attempt AND item_id = p_item AND is_current;
  IF FOUND THEN
    v_version := v_prior.response_version + 1;
    UPDATE responses SET is_current = false WHERE response_id = v_prior.response_id;
  ELSE
    v_version := 1;
  END IF;

  INSERT INTO responses (attempt_id, item_id, response_value, response_version, is_current, supersedes_response_id,
                         response_time_ms, presented_order, idempotency_key)
  VALUES (p_attempt, p_item, p_value, v_version, true, v_prior.response_id, p_time, p_order, p_idempotency)
  RETURNING response_id INTO v_id;

  INSERT INTO response_events (attempt_id, item_id, event_type, session_number, metadata)
  VALUES (p_attempt, p_item, 'RESPONSE_SAVED', NULLIF(a.session_count, 0),
          jsonb_build_object('response_id', v_id, 'response_version', v_version));
  UPDATE assessment_attempts SET last_activity_at = now() WHERE attempt_id = p_attempt;
  RETURN v_id;
END $$;

CREATE FUNCTION begin_or_resume_session(p_attempt uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
DECLARE a assessment_attempts%ROWTYPE;
BEGIN
  SELECT * INTO a FROM assessment_attempts WHERE attempt_id = p_attempt FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'attempt % not found', p_attempt USING ERRCODE = 'P0002';
  END IF;
  PERFORM assert_attempt_actor(a.participant_id);

  IF a.status = 'CREATED' THEN                                   -- first true session
    UPDATE assessment_attempts SET status = 'STARTED', session_count = 1, started_at = now(), last_activity_at = now()
     WHERE attempt_id = p_attempt;
    UPDATE assessment_attempts SET status = 'IN_PROGRESS' WHERE attempt_id = p_attempt;
    INSERT INTO response_events (attempt_id, event_type, session_number) VALUES (p_attempt, 'SESSION_START', 1);
    RETURN 1;
  ELSIF a.status IN ('STARTED', 'IN_PROGRESS') THEN              -- reconnect: no new session
    IF a.status = 'STARTED' THEN
      UPDATE assessment_attempts SET status = 'IN_PROGRESS' WHERE attempt_id = p_attempt;
    END IF;
    UPDATE assessment_attempts SET last_activity_at = now() WHERE attempt_id = p_attempt;
    INSERT INTO response_events (attempt_id, event_type, session_number, metadata)
    VALUES (p_attempt, 'RESUME', a.session_count, '{"reconnect": true}'::jsonb);
    RETURN a.session_count;
  ELSIF a.status = 'PAUSED' THEN                                 -- new true session
    IF a.session_count >= 4 THEN
      RAISE EXCEPTION 'the four-session limit has been reached' USING ERRCODE = 'SN005';
    END IF;
    UPDATE assessment_attempts SET status = 'IN_PROGRESS', session_count = a.session_count + 1, last_activity_at = now()
     WHERE attempt_id = p_attempt;
    INSERT INTO response_events (attempt_id, event_type, session_number) VALUES (p_attempt, 'SESSION_START', a.session_count + 1);
    RETURN a.session_count + 1;
  END IF;
  RAISE EXCEPTION 'a session cannot be started while the attempt is %', a.status USING ERRCODE = 'SN008';
END $$;

CREATE FUNCTION pause_session(p_attempt uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
DECLARE a assessment_attempts%ROWTYPE;
BEGIN
  SELECT * INTO a FROM assessment_attempts WHERE attempt_id = p_attempt FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'attempt % not found', p_attempt USING ERRCODE = 'P0002';
  END IF;
  PERFORM assert_attempt_actor(a.participant_id);
  IF a.status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'only an IN_PROGRESS attempt can be paused (attempt is %)', a.status USING ERRCODE = 'SN003';
  END IF;
  UPDATE assessment_attempts SET status = 'PAUSED', last_activity_at = now() WHERE attempt_id = p_attempt;
  INSERT INTO response_events (attempt_id, event_type, session_number, metadata)
  VALUES (p_attempt, 'PAUSE', a.session_count, jsonb_build_object('reason', p_reason)),
         (p_attempt, 'SESSION_END', a.session_count, jsonb_build_object('reason', p_reason));
END $$;

-- Legacy signature; replaced by submit_attempt(uuid, text) in the BUILD 05 migration.
CREATE FUNCTION submit_attempt(p_attempt uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
DECLARE a assessment_attempts%ROWTYPE;
BEGIN
  SELECT * INTO a FROM assessment_attempts WHERE attempt_id = p_attempt FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'attempt % not found', p_attempt USING ERRCODE = 'P0002';
  END IF;
  PERFORM assert_attempt_actor(a.participant_id);
  IF a.status NOT IN ('STARTED', 'IN_PROGRESS', 'PAUSED') THEN
    RAISE EXCEPTION 'an attempt in status % cannot be submitted', a.status USING ERRCODE = 'SN003';
  END IF;
  IF a.status = 'IN_PROGRESS' THEN
    INSERT INTO response_events (attempt_id, event_type, session_number, metadata)
    VALUES (p_attempt, 'SESSION_END', a.session_count, '{"reason": "submit"}'::jsonb);
  END IF;
  UPDATE assessment_attempts SET status = 'SUBMITTED', submitted_at = now(), last_activity_at = now() WHERE attempt_id = p_attempt;
  INSERT INTO response_events (attempt_id, event_type, session_number) VALUES (p_attempt, 'SUBMIT', NULLIF(a.session_count, 0));
END $$;

-- PUBLIC gets no EXECUTE on any santulan function (BUILD 01 §7.1); the grant script re-grants to the named roles.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA santulan FROM PUBLIC;
