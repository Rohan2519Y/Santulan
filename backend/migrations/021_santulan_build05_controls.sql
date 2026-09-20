-- SanTulan 2.0 canonical schema — BUILD 05 v3.1 §11 (050: assessment delivery controls). Adds NO table.
--   response_idempotency_nonblank_ck   blank response idempotency keys are rejected
--   uq_submit_idempotency              one SUBMIT idempotency key per attempt (partial expression index on response_events)
--   build05_validate_response_event_session()  an event's session_number can never exceed the attempt's session_count
--   submit_attempt(uuid, text)         idempotent, atomic submission with active-session closure; REPLACES submit_attempt(uuid)
--   participation_control_state()      operational control plane (R-18): latest PARTICIPATION_CONTROL audit event, default OPEN
--   assert_attempt_actor(uuid)         FAIL-CLOSED fix: with no actor context the 015 version evaluated NOT (false OR NULL) = NULL, so
--                                      the IF never raised and the delivery procedures accepted an empty context
-- save_response(...) is already the payload-bound, advisory-locked version (migration 015, B05-AUD-001/009), so it is not
-- redefined here. Scoring and quality are NOT invoked by any of these objects (BUILD 05 §1, §8).
SET LOCAL search_path TO santulan, public;

-- No context (or a NULL participant id) must deny, never allow (Constitution: fail closed).
CREATE OR REPLACE FUNCTION assert_attempt_actor(p_participant uuid) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = santulan, public, pg_temp AS
$$
BEGIN
  IF NOT COALESCE(ctx_is_privileged() OR (ctx_actor_scope() = 'PARTICIPANT' AND p_participant = ctx_participant_id()), false) THEN
    RAISE EXCEPTION 'the current actor may not act on this attempt' USING ERRCODE = 'SN011';
  END IF;
END $$;

ALTER TABLE responses ADD CONSTRAINT response_idempotency_nonblank_ck CHECK (btrim(idempotency_key) <> '');

CREATE UNIQUE INDEX uq_submit_idempotency ON response_events (attempt_id, (metadata ->> 'idempotency_key'))
  WHERE event_type = 'SUBMIT';

CREATE FUNCTION build05_validate_response_event_session() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
DECLARE v_count integer;
BEGIN
  IF NEW.session_number IS NOT NULL THEN
    SELECT session_count INTO v_count FROM assessment_attempts WHERE attempt_id = NEW.attempt_id;
    IF v_count IS NOT NULL AND NEW.session_number > v_count THEN
      RAISE EXCEPTION 'event session % exceeds the attempt session count %', NEW.session_number, v_count USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_events_session BEFORE INSERT ON response_events
  FOR EACH ROW EXECUTE FUNCTION build05_validate_response_event_session();

-- The legacy one-argument signature has no idempotency and must not remain callable.
DROP FUNCTION submit_attempt(uuid);

CREATE FUNCTION submit_attempt(p_attempt uuid, p_submission_key text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
DECLARE a assessment_attempts%ROWTYPE; ex response_events%ROWTYPE;
BEGIN
  IF p_submission_key IS NULL OR btrim(p_submission_key) = '' THEN
    RAISE EXCEPTION 'a submission idempotency key is required' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO a FROM assessment_attempts WHERE attempt_id = p_attempt FOR UPDATE;   -- serialises concurrent submits
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
  IF a.status = 'IN_PROGRESS' THEN
    INSERT INTO response_events (attempt_id, event_type, session_number, metadata)
    VALUES (p_attempt, 'SESSION_END', a.session_count, '{"reason": "submit"}'::jsonb);
  END IF;
  UPDATE assessment_attempts SET status = 'SUBMITTED', submitted_at = now(), last_activity_at = now() WHERE attempt_id = p_attempt;
  INSERT INTO response_events (attempt_id, event_type, session_number, metadata)
  VALUES (p_attempt, 'SUBMIT', NULLIF(a.session_count, 0), jsonb_build_object('idempotency_key', p_submission_key));
END $$;

-- Control plane (R-18): the latest PARTICIPATION_CONTROL audit event decides; no event means OPEN.
-- Recorded events carry new_state = {"state": "OPEN" | "STOPPED"}. An unrecognised state fails closed (STOPPED).
CREATE FUNCTION participation_control_state() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
  SELECT COALESCE((SELECT CASE WHEN new_state ->> 'state' = 'OPEN' THEN 'OPEN' ELSE 'STOPPED' END
                     FROM audit_logs WHERE action_type = 'PARTICIPATION_CONTROL'
                    ORDER BY occurred_at DESC, log_id DESC LIMIT 1), 'OPEN')
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA santulan FROM PUBLIC;
