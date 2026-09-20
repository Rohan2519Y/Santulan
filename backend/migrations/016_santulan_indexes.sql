-- SanTulan 2.0 canonical schema — BUILD 01 v3.1 §8 (009: index and concurrency contract).
-- Exactly the 29 indexes listed in §8; NO additions without an approved change record.
-- The two partial UNIQUE indexes uq_one_nonterminal_attempt_per_participant and uq_current_response are critical
-- concurrency locks and MUST NOT be weakened to application-only checks.
SET LOCAL search_path TO santulan, public;

CREATE INDEX idx_institutions_parent ON institutions (parent_institution_id) WHERE parent_institution_id IS NOT NULL;
CREATE INDEX idx_cohorts_institution_status ON cohorts (institution_id, status);
CREATE UNIQUE INDEX uq_participants_auth_subject ON participants (auth_provider, auth_provider_subject_id) WHERE auth_provider_subject_id IS NOT NULL;
CREATE INDEX idx_participants_institution ON participants (institution_id) WHERE institution_id IS NOT NULL;
CREATE INDEX idx_participants_cohort ON participants (cohort_id) WHERE cohort_id IS NOT NULL;
CREATE INDEX idx_participant_history_participant ON participant_cohort_history (participant_id, assigned_at DESC);
CREATE INDEX idx_consents_participant_status ON consents (participant_id, status);
CREATE UNIQUE INDEX uq_verified_consent_per_protocol ON consents (participant_id, consent_type, protocol_version) WHERE status = 'VERIFIED';
CREATE INDEX idx_items_version_domain_order ON items (assessment_version_id, domain_code, display_order);
CREATE INDEX idx_items_version_subdomain ON items (assessment_version_id, subdomain_code);
CREATE INDEX idx_items_code ON items (item_code);
CREATE INDEX idx_attempts_participant_status ON assessment_attempts (participant_id, status);
CREATE UNIQUE INDEX uq_one_nonterminal_attempt_per_participant ON assessment_attempts (participant_id)
  WHERE status NOT IN ('REPORT_READY', 'INVALID', 'EXPIRED');
CREATE UNIQUE INDEX uq_response_version ON responses (attempt_id, item_id, response_version);
CREATE UNIQUE INDEX uq_current_response ON responses (attempt_id, item_id) WHERE is_current = true;
CREATE INDEX idx_responses_attempt_current ON responses (attempt_id, is_current);
CREATE INDEX idx_response_events_attempt_time ON response_events (attempt_id, occurred_at);
CREATE INDEX idx_quality_flags_attempt ON quality_flags (attempt_id, flag_code);
CREATE INDEX idx_scores_attempt ON score_results (attempt_id, domain_code);
CREATE INDEX idx_reports_participant ON reports (participant_id, created_at DESC);
CREATE INDEX idx_report_sections_report ON report_sections (report_id, display_order);
CREATE INDEX idx_growth_plans_participant ON growth_plans (participant_id, created_at DESC);
CREATE INDEX idx_growth_priorities_plan ON growth_priorities (plan_id, candidate_rank);
CREATE INDEX idx_growth_reviews_goal ON growth_reviews (goal_id, review_date DESC);
CREATE INDEX idx_pathway_decisions_participant ON pathway_decisions (participant_id, created_at DESC);
CREATE INDEX idx_pathway_reviews_decision ON pathway_reviews (pathway_decision_id, reviewed_at DESC);
CREATE INDEX idx_research_exports_requested_by ON research_exports (requested_by, created_at DESC);
CREATE INDEX idx_audit_logs_target ON audit_logs (target_entity, target_id, occurred_at DESC);
CREATE INDEX idx_audit_logs_actor ON audit_logs (actor_type, actor_id, occurred_at DESC);
