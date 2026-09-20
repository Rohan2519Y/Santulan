-- SanTulan 2.0 canonical schema — BUILD 06 v3.1 §13 (060: quality and scoring controls). Adds NO table.
--   uq_quality_flag_logical            one logical flag per attempt / domain / code (detector retries are idempotent).
--                                      BUILD 06 ADDITION to the BUILD 01 index list (recorded in the traceability notes).
--   trg_quality_flags_facts            detection facts are immutable; only disposition / review fields may change
--   trg_quality_flags_q09              a Q09 flag routes the attempt to QUALITY_HOLD (never to a score)
--   trg_scores_immutable               score_results are append-only: a new governed scoring_version, never an UPDATE
--   trg_events_quality                 QUALITY_CHECK_COMPLETED needs outcome CLEAR|HOLD|INVALID; CLEAR contradicts Q06/Q09
--   build06_detect_q06 / _apply_q06    deterministic version-mismatch detector; hard scoring stop (attempt -> INVALID)
--   score_attempt(uuid,text,jsonb)     the ONLY scorer: server-only, quality-first, one transaction, seven domain rows
--   v_candidate_subdomain_scores       research-only derived view (not a 29th table); C4.2 and C2.10 carry interpretation_hold
-- Discrepancy recorded (Principle I): BUILD 01 §7 allows a raw score at exactly 60% completeness; BUILD 06 §7 makes exactly
-- 40% missing MS04 (no raw score, S0). The scorer follows BUILD 06 (the stricter rule) - see also migration 015's header.
-- ASSUMED (D-11): the severity of a Q06 flag is HIGH (BUILD 06 fixes only Q09 = CRITICAL). Custom SQLSTATE SN013 = quality
-- check not clear (mapped to HTTP 409 QUALITY_NOT_CLEAR). Q05 / Q08 / Q01-Q04 / Q07 detectors are NOT implemented here (no
-- approved thresholds or protocol); the scorer never invents a cutoff.
SET LOCAL search_path TO santulan, public;

-- ------------------------------------------------------------------------------------------------ quality flags
CREATE UNIQUE INDEX uq_quality_flag_logical ON quality_flags (attempt_id, (COALESCE(domain_code, '')), flag_code);

CREATE FUNCTION build06_guard_quality_facts() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
BEGIN
  IF (to_jsonb(NEW) - 'disposition' - 'reviewed_by' - 'reviewed_at' - 'review_note')
     <> (to_jsonb(OLD) - 'disposition' - 'reviewed_by' - 'reviewed_at' - 'review_note') THEN
    RAISE EXCEPTION 'quality detection facts are immutable; only the review fields may change' USING ERRCODE = 'SN004';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_quality_flags_facts BEFORE UPDATE ON quality_flags
  FOR EACH ROW EXECUTE FUNCTION build06_guard_quality_facts();

-- Q09 (safeguarding) is CRITICAL (q09_critical_ck) and must route to a human hold; it is never converted to a score.
CREATE FUNCTION build06_route_q09() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
BEGIN
  IF NEW.flag_code = 'Q09' THEN
    UPDATE assessment_attempts SET status = 'QUALITY_HOLD'
     WHERE attempt_id = NEW.attempt_id AND status IN ('STARTED', 'IN_PROGRESS', 'PAUSED', 'SUBMITTED', 'SCORING', 'SCORED');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_quality_flags_q09 AFTER INSERT ON quality_flags
  FOR EACH ROW EXECUTE FUNCTION build06_route_q09();

-- ------------------------------------------------------------------------------------------------ immutable scores
CREATE FUNCTION build06_guard_score_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
BEGIN
  RAISE EXCEPTION 'score results are immutable; a recalculation needs a new governed scoring_version' USING ERRCODE = 'SN004';
END $$;
CREATE TRIGGER trg_scores_immutable BEFORE UPDATE OR DELETE ON score_results
  FOR EACH ROW EXECUTE FUNCTION build06_guard_score_mutation();

-- ------------------------------------------------------------------------------------------------ quality outcome event
CREATE FUNCTION build06_validate_quality_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
DECLARE v_outcome text; v_status attempt_status;
BEGIN
  IF NEW.event_type <> 'QUALITY_CHECK_COMPLETED' THEN RETURN NEW; END IF;
  v_outcome := NEW.metadata ->> 'outcome';
  IF v_outcome IS NULL OR v_outcome NOT IN ('CLEAR', 'HOLD', 'INVALID') THEN
    RAISE EXCEPTION 'a quality check records an outcome of CLEAR, HOLD or INVALID' USING ERRCODE = '23514';
  END IF;
  SELECT status INTO v_status FROM assessment_attempts WHERE attempt_id = NEW.attempt_id;
  IF v_status IS NOT NULL AND v_status NOT IN ('SUBMITTED', 'QUALITY_HOLD') THEN
    RAISE EXCEPTION 'a quality check runs on a SUBMITTED attempt (attempt is %)', v_status USING ERRCODE = 'SN003';
  END IF;
  IF v_outcome = 'CLEAR' AND EXISTS (SELECT 1 FROM quality_flags WHERE attempt_id = NEW.attempt_id AND flag_code IN ('Q06', 'Q09')) THEN
    RAISE EXCEPTION 'a CLEAR outcome contradicts a Q06 or Q09 flag' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_events_quality BEFORE INSERT ON response_events
  FOR EACH ROW EXECUTE FUNCTION build06_validate_quality_event();

-- ------------------------------------------------------------------------------------------------ Q06 version mismatch
CREATE FUNCTION build06_detect_q06(p_attempt uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
  SELECT EXISTS (SELECT 1 FROM responses r
                   JOIN assessment_attempts a ON a.attempt_id = r.attempt_id
                   JOIN items i ON i.item_id = r.item_id
                  WHERE r.attempt_id = p_attempt AND r.is_current AND i.assessment_version_id <> a.assessment_version_id)
$$;

-- Records the Q06 flag (idempotent) and stops the attempt: version mismatch is a hard scoring stop.
CREATE FUNCTION build06_apply_q06(p_attempt uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
BEGIN
  IF NOT ctx_is_privileged() THEN
    RAISE EXCEPTION 'only a privileged server context may record quality outcomes' USING ERRCODE = 'SN011';
  END IF;
  INSERT INTO quality_flags (attempt_id, domain_code, flag_code, severity) VALUES (p_attempt, NULL, 'Q06', 'HIGH')
  ON CONFLICT DO NOTHING;
  UPDATE assessment_attempts SET status = 'INVALID'
   WHERE attempt_id = p_attempt AND status NOT IN ('INVALID', 'EXPIRED', 'REPORT_READY');
END $$;

-- ------------------------------------------------------------------------------------------------ the scorer
-- p_evidence: { "C1": "S1" | "S2" | "SH" ... } governed evidence states for THIS assessment version; a missing domain is S1.
-- Returns 'SCORED', 'ALREADY_SCORED' (safe retry) or 'INVALID_Q06'. Any error rolls back every row it wrote.
CREATE FUNCTION score_attempt(p_attempt uuid, p_scoring_version text, p_evidence jsonb DEFAULT '{}'::jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
DECLARE
  a assessment_attempts%ROWTYPE; v assessment_versions%ROWTYPE; v_scale content_status;
  v_bands text[]; v_contexts text[]; v_outcome text; v_rows integer; v_other integer;
  d text; v_eligible integer; v_answered integer; v_mean numeric; v_missing_x100 integer;
  v_raw numeric; v_state evidence_state; v_cfg text;
BEGIN
  IF NOT ctx_is_privileged() THEN
    RAISE EXCEPTION 'scoring is a server-only operation' USING ERRCODE = 'SN011';
  END IF;
  IF p_scoring_version IS NULL OR btrim(p_scoring_version) = '' THEN
    RAISE EXCEPTION 'a scoring version is required' USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('santulan.score_attempt:' || p_attempt::text, 0));
  SELECT * INTO a FROM assessment_attempts WHERE attempt_id = p_attempt FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'attempt % not found', p_attempt USING ERRCODE = 'P0002';
  END IF;

  -- a retry of a completed identical scoring version returns the existing set; a different version cannot append or overwrite
  SELECT count(*) FILTER (WHERE scoring_version = p_scoring_version), count(*) FILTER (WHERE scoring_version <> p_scoring_version)
    INTO v_rows, v_other FROM score_results WHERE attempt_id = p_attempt;
  IF v_other > 0 THEN
    RAISE EXCEPTION 'the attempt is already scored under a different scoring version' USING ERRCODE = 'SN010';
  END IF;
  IF v_rows > 0 THEN
    RETURN 'ALREADY_SCORED';
  END IF;

  IF a.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'only a SUBMITTED attempt can be scored (attempt is %)', a.status USING ERRCODE = 'SN003';
  END IF;
  SELECT * INTO v FROM assessment_versions WHERE assessment_version_id = a.assessment_version_id;
  SELECT status INTO v_scale FROM response_scales WHERE response_scale_id = v.response_scale_id;
  IF v.status <> 'FROZEN' OR v_scale IS DISTINCT FROM 'FROZEN' THEN
    RAISE EXCEPTION 'the assessment version and its response scale must both be FROZEN' USING ERRCODE = 'SN009';
  END IF;

  -- Q06 is deterministic and takes precedence: a response to an item of another version is a hard scoring stop
  IF build06_detect_q06(p_attempt) THEN
    PERFORM build06_apply_q06(p_attempt);
    RETURN 'INVALID_Q06';
  END IF;

  -- Phase 3 ordering: the latest recorded quality outcome must be CLEAR (and no Q06/Q09 flag may exist)
  SELECT metadata ->> 'outcome' INTO v_outcome FROM response_events
   WHERE attempt_id = p_attempt AND event_type = 'QUALITY_CHECK_COMPLETED' ORDER BY occurred_at DESC, event_id DESC LIMIT 1;
  IF v_outcome IS DISTINCT FROM 'CLEAR' OR EXISTS (SELECT 1 FROM quality_flags WHERE attempt_id = p_attempt AND flag_code IN ('Q06', 'Q09')) THEN
    RAISE EXCEPTION 'the quality check must complete with outcome CLEAR before scoring' USING ERRCODE = 'SN013';
  END IF;

  -- keying: every pilot item is POSITIVE; a REVERSE item has no approved keying definition and fails closed
  IF EXISTS (SELECT 1 FROM items WHERE assessment_version_id = a.assessment_version_id AND layer = 'CORE' AND status = 'ACTIVE' AND keying <> 'POSITIVE') THEN
    RAISE EXCEPTION 'a REVERSE-keyed item was found and no approved keying definition exists' USING ERRCODE = 'SN007';
  END IF;

  IF v.configuration = 'ADOLESCENT' THEN
    v_bands := ARRAY['13–17', '13–25']; v_contexts := ARRAY['School', 'General', 'Digital'];
  ELSE
    v_bands := ARRAY['18–25', '13–25']; v_contexts := ARRAY['College/Work', 'General', 'Digital'];
  END IF;

  FOREACH d IN ARRAY ARRAY['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'] LOOP
    SELECT count(*), count(r.response_id), avg(r.response_value::numeric)
      INTO v_eligible, v_answered, v_mean
      FROM items i
      LEFT JOIN responses r ON r.item_id = i.item_id AND r.attempt_id = p_attempt AND r.is_current
     WHERE i.assessment_version_id = a.assessment_version_id AND i.domain_code = d AND i.layer = 'CORE' AND i.status = 'ACTIVE'
       AND i.age_band = ANY (v_bands) AND i.context = ANY (v_contexts);
    IF v_eligible = 0 THEN
      RAISE EXCEPTION 'domain % has no eligible items in the frozen version', d USING ERRCODE = 'SN012';
    END IF;

    -- exact integer arithmetic on the missing share: missing% >= 40 (MS04) and >= 20 (MS03) are boundary-inclusive
    v_missing_x100 := (v_eligible - v_answered) * 100;
    IF v_answered = 0 OR v_missing_x100 >= 40 * v_eligible THEN                    -- MS04: no domain score
      v_raw := NULL; v_state := 'S0';
    ELSE
      v_raw := round(v_mean, 2);
      IF v_missing_x100 >= 20 * v_eligible THEN                                    -- MS03: research only, no participant interpretation
        v_state := 'S1';
      ELSE                                                                         -- MS01 / MS02: governed evidence state, default S1
        v_cfg := p_evidence ->> d;
        v_state := COALESCE(v_cfg, 'S1')::evidence_state;
        IF v_state = 'S0' THEN
          RAISE EXCEPTION 'S0 cannot be configured for a scored domain' USING ERRCODE = '23514';
        END IF;
      END IF;
    END IF;

    INSERT INTO score_results (attempt_id, participant_id, assessment_version_id, domain_code, raw_score, completeness_rate, score_status, scoring_version)
    VALUES (p_attempt, a.participant_id, a.assessment_version_id, d, v_raw, round(v_answered::numeric / v_eligible, 4), v_state, p_scoring_version);
  END LOOP;

  UPDATE assessment_attempts SET status = 'SCORING' WHERE attempt_id = p_attempt;
  UPDATE assessment_attempts SET status = 'SCORED', scoring_version = p_scoring_version, completed_at = clock_timestamp() WHERE attempt_id = p_attempt;
  RETURN 'SCORED';
END $$;

-- ------------------------------------------------------------------------------------------------ research-only view
-- Candidate subdomain means for validation studies. NOT a canonical table and never participant-facing: PUBLIC has no
-- access, the grant script keeps app_runtime away from it, and security_invoker keeps the caller's RLS in force.
CREATE VIEW v_candidate_subdomain_scores WITH (security_invoker = true) AS
SELECT a.attempt_id, a.participant_id, a.assessment_version_id, i.domain_code, i.subdomain_code, i.subdomain_name,
       count(*)::integer AS eligible_items,
       count(r.response_id)::integer AS answered_items,
       round(avg(r.response_value::numeric), 2) AS candidate_mean,
       (i.subdomain_code IN ('C4.2', 'C2.10')) AS interpretation_hold
  FROM assessment_attempts a
  JOIN assessment_versions v ON v.assessment_version_id = a.assessment_version_id
  JOIN items i ON i.assessment_version_id = a.assessment_version_id AND i.layer = 'CORE' AND i.status = 'ACTIVE'
  LEFT JOIN responses r ON r.attempt_id = a.attempt_id AND r.item_id = i.item_id AND r.is_current
 WHERE (v.configuration = 'ADOLESCENT' AND i.age_band IN ('13–17', '13–25') AND i.context IN ('School', 'General', 'Digital'))
    OR (v.configuration = 'EMERGING_ADULT' AND i.age_band IN ('18–25', '13–25') AND i.context IN ('College/Work', 'General', 'Digital'))
 GROUP BY a.attempt_id, a.participant_id, a.assessment_version_id, i.domain_code, i.subdomain_code, i.subdomain_name;
REVOKE ALL ON v_candidate_subdomain_scores FROM PUBLIC;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA santulan FROM PUBLIC;
