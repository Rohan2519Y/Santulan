-- SanTulan 2.0 canonical schema — BUILD 03 v3.1 §11 (030: registration controls). Adds NO table.
--   participant_open_scope_ck            OPEN participants carry no institution / cohort / external id (B03-AUD-002)
--   uq_participant_institution_external_id  external student id unique inside one institution (B03-AUD-004)
--   build03_resolve_registration(age)    deterministic eligibility / track / minor / version label / consent types
--   build03_assert_catalog_route(age)    fails closed (SN012) when the catalog and the routing contract drift apart
-- BUILD 03 also lists uq_participant_auth_identity (B03-AUD-003); it is identical to uq_participants_auth_subject from
-- BUILD 01 §8 (partial unique on auth_provider, auth_provider_subject_id) and is therefore NOT created twice.
-- Custom SQLSTATE SN012 = catalog drift (mapped to HTTP 503 CATALOG_DRIFT by the API).
SET LOCAL search_path TO santulan, public;

ALTER TABLE participants ADD CONSTRAINT participant_open_scope_ck CHECK (
  participation_route <> 'OPEN' OR (institution_id IS NULL AND cohort_id IS NULL AND external_student_id IS NULL)
);

CREATE UNIQUE INDEX uq_participant_institution_external_id ON participants (institution_id, external_student_id)
  WHERE external_student_id IS NOT NULL;

CREATE FUNCTION build03_resolve_registration(p_age smallint)
RETURNS TABLE (eligible boolean, assessment_track assessment_track, is_minor boolean, version_label text, consent_types text[])
LANGUAGE sql IMMUTABLE SET search_path = santulan, public, pg_temp AS
$$
  SELECT COALESCE(p_age BETWEEN 13 AND 25, false),
         resolve_assessment_track(p_age),
         CASE WHEN p_age BETWEEN 13 AND 25 THEN p_age < 18 END,
         CASE resolve_assessment_track(p_age)
           WHEN 'ADOLESCENT' THEN 'santulan-adolescent-pilot-v3.1'
           WHEN 'EMERGING_ADULT' THEN 'santulan-emergingadult-pilot-v3.1' END,
         CASE resolve_assessment_track(p_age)
           WHEN 'ADOLESCENT' THEN ARRAY['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT']
           WHEN 'EMERGING_ADULT' THEN ARRAY['ADULT_SELF_CONSENT'] END
$$;

CREATE FUNCTION build03_assert_catalog_route(p_age smallint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM build03_resolve_registration(p_age);
  IF NOT r.eligible THEN
    RAISE EXCEPTION 'age % is not eligible (13-25)', p_age USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM assessment_versions v
        WHERE v.version_label = r.version_label AND v.configuration = r.assessment_track
          AND v.participant_min_age = CASE r.assessment_track WHEN 'ADOLESCENT' THEN 13 ELSE 18 END
          AND v.participant_max_age = CASE r.assessment_track WHEN 'ADOLESCENT' THEN 17 ELSE 25 END) THEN
    RAISE EXCEPTION 'assessment catalog drift: % is missing or its age range changed', r.version_label USING ERRCODE = 'SN012';
  END IF;
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA santulan FROM PUBLIC;
