-- SanTulan 2.0 canonical schema — BUILD 05 §8 refinement. Adds NO table.
-- submit_attempt(uuid, text) stamped submitted_at with now(), which is the START time of the transaction. A response saved
-- by a transaction that began after the submitting one but took the attempt lock first is a legitimate, accepted answer, yet
-- its answered_at (also transaction start) could then be LATER than submitted_at. clock_timestamp() is taken while the attempt
-- row is locked, after every earlier save has committed, so every accepted response has answered_at <= submitted_at.
SET LOCAL search_path TO santulan, public;

CREATE OR REPLACE FUNCTION submit_attempt(p_attempt uuid, p_submission_key text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
DECLARE a assessment_attempts%ROWTYPE; ex response_events%ROWTYPE; v_now timestamptz;
BEGIN
  IF p_submission_key IS NULL OR btrim(p_submission_key) = '' THEN
    RAISE EXCEPTION 'a submission idempotency key is required' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO a FROM assessment_attempts WHERE attempt_id = p_attempt FOR UPDATE;   -- serialises concurrent submits and saves
  IF NOT FOUND THEN
    RAISE EXCEPTION 'attempt % not found', p_attempt USING ERRCODE = 'P0002';
  END IF;
  PERFORM assert_attempt_actor(a.participant_id);

  SELECT * INTO ex FROM response_events WHERE attempt_id = p_attempt AND event_type = 'SUBMIT';
  IF FOUND THEN
    IF ex.metadata ->> 'idempotency_key' = p_submission_key THEN
      RETURN;                                            -- safe retry: no duplicate SUBMIT
    END IF;
    RAISE EXCEPTION 'the attempt was already submitted with a different key' USING ERRCODE = 'SN006';
  END IF;

  IF a.status NOT IN ('STARTED', 'IN_PROGRESS', 'PAUSED') THEN
    RAISE EXCEPTION 'an attempt in status % cannot be submitted', a.status USING ERRCODE = 'SN003';
  END IF;
  v_now := clock_timestamp();
  IF a.status = 'IN_PROGRESS' THEN
    INSERT INTO response_events (attempt_id, event_type, session_number, occurred_at, metadata)
    VALUES (p_attempt, 'SESSION_END', a.session_count, v_now, '{"reason": "submit"}'::jsonb);
  END IF;
  UPDATE assessment_attempts SET status = 'SUBMITTED', submitted_at = v_now, last_activity_at = v_now WHERE attempt_id = p_attempt;
  INSERT INTO response_events (attempt_id, event_type, session_number, occurred_at, metadata)
  VALUES (p_attempt, 'SUBMIT', NULLIF(a.session_count, 0), v_now, jsonb_build_object('idempotency_key', p_submission_key));
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA santulan FROM PUBLIC;
