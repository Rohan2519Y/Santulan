-- SanTulan 2.0 canonical schema — BUILD 01 v3.1 §9 (010: row-level security) + BUILD 09 §4–§6 (FORCE RLS,
-- institution isolation keyed on a non-NULL institution_id, fail-closed without context).
--
-- Context (set per transaction by the server, never by the client — research R-03):
--   app.actor_scope   PARTICIPANT | INSTITUTION_ADMIN | RESEARCH_OPERATOR | SUPER_ADMIN | SYSTEM
--   app.participant_id / app.admin_user_id / app.institution_id
-- No context => ctx_*() are NULL => every comparison is false => no rows.
SET LOCAL search_path TO santulan, public;

-- ---------------------------------------------------------------- policy helpers (SECURITY DEFINER: they read the
-- tables they protect without recursing into those tables' own policies)
CREATE FUNCTION own_participant(p_participant uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = santulan, public, pg_temp AS
$$ SELECT COALESCE(ctx_actor_scope() = 'PARTICIPANT' AND p_participant = ctx_participant_id(), false) $$;

CREATE FUNCTION can_read_participant(p_participant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
  SELECT COALESCE(
    ctx_is_privileged()
    OR own_participant(p_participant)
    OR (ctx_actor_scope() = 'INSTITUTION_ADMIN' AND ctx_institution_id() IS NOT NULL
        AND EXISTS (SELECT 1 FROM participants p
                     WHERE p.participant_id = p_participant AND p.institution_id = ctx_institution_id())),
    false)
$$;

CREATE FUNCTION can_read_attempt(p_attempt uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$ SELECT COALESCE((SELECT can_read_participant(a.participant_id) FROM assessment_attempts a WHERE a.attempt_id = p_attempt), false) $$;

CREATE FUNCTION can_read_report(p_report uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
  SELECT COALESCE((SELECT ctx_is_privileged()
                          OR (r.generation_status IN ('REPORT_READY', 'UNDER_REVIEW', 'NOT_ELIGIBLE') AND can_read_participant(r.participant_id))
                     FROM reports r WHERE r.report_id = p_report), false)
$$;

CREATE FUNCTION participant_of_plan(p_plan uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$ SELECT participant_id FROM growth_plans WHERE id = p_plan $$;
CREATE FUNCTION participant_of_priority(p_priority uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$ SELECT g.participant_id FROM growth_priorities pr JOIN growth_plans g ON g.id = pr.plan_id WHERE pr.id = p_priority $$;
CREATE FUNCTION participant_of_goal(p_goal uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$ SELECT g.participant_id FROM growth_goals go JOIN growth_priorities pr ON pr.id = go.priority_id
     JOIN growth_plans g ON g.id = pr.plan_id WHERE go.id = p_goal $$;

CREATE FUNCTION can_read_pathway(p_decision uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = santulan, public, pg_temp AS
$$
  SELECT COALESCE((SELECT ctx_is_privileged() OR (d.pathway_code <> 'P5' AND can_read_participant(d.participant_id))
                     FROM pathway_decisions d WHERE d.id = p_decision), false)
$$;

-- ---------------------------------------------------------------- enable + force on every canonical table
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'santulan' LOOP
    EXECUTE format('ALTER TABLE santulan.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE santulan.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- content / reference tables
CREATE POLICY p_response_scales_read ON response_scales FOR SELECT USING (ctx_actor_scope() IS NOT NULL);
CREATE POLICY p_assessment_versions_read ON assessment_versions FOR SELECT
  USING (ctx_is_privileged() OR (ctx_actor_scope() IS NOT NULL AND status = 'FROZEN'));
CREATE POLICY p_items_read ON items FOR SELECT
  USING (ctx_is_privileged() OR (ctx_actor_scope() IS NOT NULL AND EXISTS (
           SELECT 1 FROM assessment_versions v WHERE v.assessment_version_id = items.assessment_version_id AND v.status = 'FROZEN')));
CREATE POLICY p_interpretation_rules_read ON interpretation_rules FOR SELECT
  USING (ctx_is_privileged() OR (ctx_actor_scope() IS NOT NULL AND status = 'APPROVED'));
CREATE POLICY p_development_actions_read ON development_actions FOR SELECT
  USING (ctx_is_privileged() OR (ctx_actor_scope() IS NOT NULL AND active));
CREATE POLICY p_reflection_prompts_read ON reflection_prompts FOR SELECT
  USING (ctx_is_privileged() OR (ctx_actor_scope() IS NOT NULL AND status = 'APPROVED'));

CREATE POLICY p_reference_write_scales ON response_scales FOR ALL USING (ctx_is_privileged()) WITH CHECK (ctx_is_privileged());
CREATE POLICY p_reference_write_versions ON assessment_versions FOR ALL USING (ctx_is_privileged()) WITH CHECK (ctx_is_privileged());
CREATE POLICY p_reference_write_items ON items FOR ALL USING (ctx_is_privileged()) WITH CHECK (ctx_is_privileged());
CREATE POLICY p_reference_write_rules ON interpretation_rules FOR ALL USING (ctx_is_privileged()) WITH CHECK (ctx_is_privileged());
CREATE POLICY p_reference_write_actions ON development_actions FOR ALL USING (ctx_is_privileged()) WITH CHECK (ctx_is_privileged());
CREATE POLICY p_reference_write_prompts ON reflection_prompts FOR ALL USING (ctx_is_privileged()) WITH CHECK (ctx_is_privileged());

-- ---------------------------------------------------------------- organisation and identity
CREATE POLICY p_institutions_read ON institutions FOR SELECT
  USING (ctx_is_privileged()
         OR (ctx_institution_id() IS NOT NULL AND institution_id = ctx_institution_id())
         OR EXISTS (SELECT 1 FROM participants p WHERE p.participant_id = ctx_participant_id() AND p.institution_id = institutions.institution_id));
CREATE POLICY p_cohorts_read ON cohorts FOR SELECT
  USING (ctx_is_privileged()
         OR (ctx_institution_id() IS NOT NULL AND institution_id = ctx_institution_id())
         OR EXISTS (SELECT 1 FROM participants p WHERE p.participant_id = ctx_participant_id() AND p.institution_id = cohorts.institution_id));
CREATE POLICY p_admin_write_institutions ON institutions FOR ALL USING (ctx_is_privileged()) WITH CHECK (ctx_is_privileged());
CREATE POLICY p_admin_write_cohorts ON cohorts FOR ALL USING (ctx_is_privileged()) WITH CHECK (ctx_is_privileged());

CREATE POLICY p_participants_read ON participants FOR SELECT USING (can_read_participant(participant_id));
CREATE POLICY p_participants_write ON participants FOR ALL USING (ctx_is_privileged()) WITH CHECK (ctx_is_privileged());
CREATE POLICY p_history_read ON participant_cohort_history FOR SELECT USING (can_read_participant(participant_id));
CREATE POLICY p_history_write ON participant_cohort_history FOR ALL USING (ctx_is_privileged()) WITH CHECK (ctx_is_privileged());
CREATE POLICY p_consents_read ON consents FOR SELECT USING (can_read_participant(participant_id));
CREATE POLICY p_consents_write ON consents FOR ALL USING (ctx_is_privileged()) WITH CHECK (ctx_is_privileged());

-- ---------------------------------------------------------------- delivery
CREATE POLICY p_attempts_read ON assessment_attempts FOR SELECT USING (can_read_participant(participant_id));
CREATE POLICY p_attempts_write ON assessment_attempts FOR ALL USING (ctx_is_privileged()) WITH CHECK (ctx_is_privileged());
CREATE POLICY p_responses_read ON responses FOR SELECT USING (can_read_attempt(attempt_id));
CREATE POLICY p_responses_write ON responses FOR ALL USING (ctx_is_privileged()) WITH CHECK (ctx_is_privileged());
CREATE POLICY p_events_read ON response_events FOR SELECT USING (can_read_attempt(attempt_id));
CREATE POLICY p_events_write ON response_events FOR ALL USING (ctx_is_privileged()) WITH CHECK (ctx_is_privileged());

-- ---------------------------------------------------------------- quality, scoring, reporting
CREATE POLICY p_quality_admin ON quality_flags FOR ALL
  USING (ctx_is_privileged() OR (ctx_actor_scope() = 'INSTITUTION_ADMIN' AND can_read_attempt(attempt_id)))
  WITH CHECK (ctx_is_privileged() OR (ctx_actor_scope() = 'INSTITUTION_ADMIN' AND can_read_attempt(attempt_id)));
-- S0 / S1 / SH (research-only or held) scores are never participant-readable (BUILD 01 SEC-01).
CREATE POLICY p_scores_read ON score_results FOR SELECT
  USING (ctx_is_privileged() OR (score_status IN ('S2', 'S3', 'S4', 'S5') AND can_read_participant(participant_id)));
CREATE POLICY p_scores_write ON score_results FOR ALL USING (ctx_is_privileged()) WITH CHECK (ctx_is_privileged());
CREATE POLICY p_reports_read ON reports FOR SELECT
  USING (ctx_is_privileged()
         OR (generation_status IN ('REPORT_READY', 'UNDER_REVIEW', 'NOT_ELIGIBLE') AND can_read_participant(participant_id)));
CREATE POLICY p_reports_write ON reports FOR ALL USING (ctx_is_privileged()) WITH CHECK (ctx_is_privileged());
CREATE POLICY p_report_sections_read ON report_sections FOR SELECT
  USING (ctx_is_privileged() OR (is_released_to_participant AND can_read_report(report_id)));
CREATE POLICY p_report_sections_write ON report_sections FOR ALL USING (ctx_is_privileged()) WITH CHECK (ctx_is_privileged());

-- ---------------------------------------------------------------- growth plans (participant-owned) and pathways
CREATE POLICY p_growth_plans_read ON growth_plans FOR SELECT USING (can_read_participant(participant_id));
CREATE POLICY p_growth_plans_write ON growth_plans FOR ALL
  USING (ctx_is_privileged() OR own_participant(participant_id))
  WITH CHECK (ctx_is_privileged() OR own_participant(participant_id));
CREATE POLICY p_growth_priorities_read ON growth_priorities FOR SELECT USING (can_read_participant(participant_of_plan(plan_id)));
CREATE POLICY p_growth_priorities_write ON growth_priorities FOR ALL
  USING (ctx_is_privileged() OR own_participant(participant_of_plan(plan_id)))
  WITH CHECK (ctx_is_privileged() OR own_participant(participant_of_plan(plan_id)));
CREATE POLICY p_growth_goals_read ON growth_goals FOR SELECT USING (can_read_participant(participant_of_priority(priority_id)));
CREATE POLICY p_growth_goals_write ON growth_goals FOR ALL
  USING (ctx_is_privileged() OR own_participant(participant_of_priority(priority_id)))
  WITH CHECK (ctx_is_privileged() OR own_participant(participant_of_priority(priority_id)));
CREATE POLICY p_growth_actions_read ON growth_actions FOR SELECT USING (can_read_participant(participant_of_goal(goal_id)));
CREATE POLICY p_growth_actions_write ON growth_actions FOR ALL
  USING (ctx_is_privileged() OR own_participant(participant_of_goal(goal_id)))
  WITH CHECK (ctx_is_privileged() OR own_participant(participant_of_goal(goal_id)));
CREATE POLICY p_growth_reviews_read ON growth_reviews FOR SELECT USING (can_read_participant(participant_of_goal(goal_id)));
CREATE POLICY p_growth_reviews_write ON growth_reviews FOR ALL
  USING (ctx_is_privileged() OR own_participant(participant_of_goal(goal_id)))
  WITH CHECK (ctx_is_privileged() OR own_participant(participant_of_goal(goal_id)));

-- P5 (safeguarding) decisions are never participant-visible; P1-P4 release stays an application/report gate.
CREATE POLICY p_pathway_decisions_read ON pathway_decisions FOR SELECT
  USING (ctx_is_privileged() OR (pathway_code <> 'P5' AND can_read_participant(participant_id)));
CREATE POLICY p_pathway_decisions_write ON pathway_decisions FOR ALL USING (ctx_is_privileged()) WITH CHECK (ctx_is_privileged());
CREATE POLICY p_pathway_reviews_read ON pathway_reviews FOR SELECT USING (can_read_pathway(pathway_decision_id));
CREATE POLICY p_pathway_reviews_write ON pathway_reviews FOR ALL USING (ctx_is_privileged()) WITH CHECK (ctx_is_privileged());

-- ---------------------------------------------------------------- research, admin, audit
CREATE POLICY p_research_exports_admin ON research_exports FOR ALL USING (ctx_is_privileged()) WITH CHECK (ctx_is_privileged());
CREATE POLICY p_admin_users_admin ON admin_users FOR SELECT USING (ctx_is_privileged());
CREATE POLICY p_admin_users_write ON admin_users FOR ALL USING (ctx_is_privileged()) WITH CHECK (ctx_is_privileged());
CREATE POLICY p_audit_logs_admin ON audit_logs FOR SELECT USING (ctx_is_privileged());
CREATE POLICY p_audit_logs_insert ON audit_logs FOR INSERT WITH CHECK (ctx_actor_scope() IS NOT NULL);

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA santulan FROM PUBLIC;
