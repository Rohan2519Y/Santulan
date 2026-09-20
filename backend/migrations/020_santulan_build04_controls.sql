-- SanTulan 2.0 canonical schema — BUILD 04 v3.1 §9 (040: consent, assent and verification gate controls). Adds NO table.
--   consent_verified_method_ck     VERIFIED requires a nonblank verification_method (an approved method CODE, never evidence)
--   consent_protocol_nonblank_ck   protocol_version must be nonblank
--   uq_consent_active_type_protocol  one non-withdrawn record per participant / type / protocol
--   build04_consent_gate(uuid)     deterministic gate status: minor flag, gate open, required types, missing VERIFIED types
-- validate_consent_row() (migration 015) already retains the BUILD 04 type / giver / age / timestamp / transition
-- controls; the nonblank-method rule is enforced by the CHECK constraint (SQLSTATE 23514) and the audited service, so the
-- trigger function is not redefined. The gate below is read-only and never opens an attempt.
SET LOCAL search_path TO santulan, public;

ALTER TABLE consents ADD CONSTRAINT consent_verified_method_ck CHECK (
  status <> 'VERIFIED' OR (verification_method IS NOT NULL AND btrim(verification_method) <> '')
);
ALTER TABLE consents ADD CONSTRAINT consent_protocol_nonblank_ck CHECK (btrim(protocol_version) <> '');

CREATE UNIQUE INDEX uq_consent_active_type_protocol ON consents (participant_id, consent_type, protocol_version)
  WHERE status <> 'WITHDRAWN';

-- Returns no row for a participant the caller may not read (no existence oracle).
CREATE FUNCTION build04_consent_gate(p_participant uuid)
RETURNS TABLE (is_minor boolean, gate_open boolean, required_types text[], missing_types text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
  WITH req AS (
    SELECT pt.participant_id, pt.is_minor,
           CASE WHEN pt.is_minor THEN ARRAY['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT']
                ELSE ARRAY['ADULT_SELF_CONSENT'] END AS types
      FROM participants pt
     WHERE pt.participant_id = p_participant AND can_read_participant(pt.participant_id)
  )
  SELECT req.is_minor,
         participant_has_required_consent(req.participant_id),
         req.types,
         ARRAY(SELECT u.t FROM unnest(req.types) WITH ORDINALITY AS u(t, n)
                WHERE NOT EXISTS (SELECT 1 FROM consents c
                                   WHERE c.participant_id = req.participant_id AND c.consent_type::text = u.t
                                     AND c.status = 'VERIFIED' AND c.withdrawn_at IS NULL)
                ORDER BY u.n)
    FROM req
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA santulan FROM PUBLIC;
