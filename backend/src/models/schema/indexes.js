/*
 * The 50 named canonical indexes of data-model section 5 (+ one dev-only). Every index has a name; none is anonymous.
 * SQL "IS NOT NULL" -> partial filter { field: { $type: 'string' } }; SQL "NOT IN (...)" -> a positive $in list
 * ($nin / $ne are rejected by MongoDB in partial filters - verified, research R-M03).
 */
const NONTERMINAL_ATTEMPT = ['CREATED', 'STARTED', 'IN_PROGRESS', 'PAUSED', 'SUBMITTED', 'SCORING', 'SCORED', 'QUALITY_HOLD'];
const str = { $type: 'string' };

const ix = (name, collection, keys, opts = {}) => ({ name, collection, keys, unique: !!opts.unique, partial: opts.partial || null, group: opts.group });

const indexes = [
  // 5.1 - the 29 BUILD 01 section 8 indexes
  ix('idx_institutions_parent', 'institutions', { parent_institution_id: 1 }, { partial: { parent_institution_id: str } }),
  ix('idx_cohorts_institution_status', 'cohorts', { institution_id: 1, status: 1 }),
  ix('uq_participants_auth_subject', 'participants', { auth_provider: 1, auth_provider_subject_id: 1 }, { unique: true, partial: { auth_provider_subject_id: str } }),
  ix('idx_participants_institution', 'participants', { institution_id: 1 }, { partial: { institution_id: str } }),
  ix('idx_participants_cohort', 'participants', { cohort_id: 1 }, { partial: { cohort_id: str } }),
  ix('idx_participant_history_participant', 'participant_cohort_history', { participant_id: 1, assigned_at: -1 }),
  ix('uq_participant_profiles_participant', 'participant_profiles', { participant_id: 1 }, { unique: true }), // one profile per participant (never edited, so this also catches an accidental double-submit)
  ix('idx_consents_participant_status', 'consents', { participant_id: 1, status: 1 }),
  ix('uq_verified_consent_per_protocol', 'consents', { participant_id: 1, consent_type: 1, protocol_version: 1 }, { unique: true, partial: { status: 'VERIFIED' } }),
  ix('idx_items_version_domain_order', 'items', { assessment_version_id: 1, domain_code: 1, display_order: 1 }),
  ix('idx_items_version_subdomain', 'items', { assessment_version_id: 1, subdomain_code: 1 }),
  ix('idx_items_code', 'items', { item_code: 1 }),
  ix('idx_attempts_participant_status', 'assessment_attempts', { participant_id: 1, status: 1 }),
  ix('uq_one_nonterminal_attempt_per_participant', 'assessment_attempts', { participant_id: 1 }, { unique: true, partial: { status: { $in: NONTERMINAL_ATTEMPT } } }),
  ix('uq_response_version', 'responses', { attempt_id: 1, item_id: 1, response_version: 1 }, { unique: true }),
  ix('uq_current_response', 'responses', { attempt_id: 1, item_id: 1 }, { unique: true, partial: { is_current: true } }),
  ix('idx_responses_attempt_current', 'responses', { attempt_id: 1, is_current: 1 }),
  ix('idx_response_events_attempt_time', 'response_events', { attempt_id: 1, occurred_at: 1 }),
  ix('idx_quality_flags_attempt', 'quality_flags', { attempt_id: 1, flag_code: 1 }),
  ix('idx_scores_attempt', 'score_results', { attempt_id: 1, domain_code: 1 }),
  ix('idx_reports_participant', 'reports', { participant_id: 1, created_at: -1 }),
  ix('idx_report_sections_report', 'report_sections', { report_id: 1, display_order: 1 }),
  ix('idx_growth_plans_participant', 'growth_plans', { participant_id: 1, created_at: -1 }),
  ix('idx_growth_priorities_plan', 'growth_priorities', { plan_id: 1, candidate_rank: 1 }),
  ix('idx_growth_reviews_goal', 'growth_reviews', { goal_id: 1, review_date: -1 }),
  ix('idx_pathway_decisions_participant', 'pathway_decisions', { participant_id: 1, created_at: -1 }),
  ix('idx_pathway_reviews_decision', 'pathway_reviews', { pathway_decision_id: 1, reviewed_at: -1 }),
  ix('idx_research_exports_requested_by', 'research_exports', { requested_by: 1, created_at: -1 }),
  ix('idx_audit_logs_target', 'audit_logs', { target_entity: 1, target_id: 1, occurred_at: -1 }),
  ix('idx_audit_logs_actor', 'audit_logs', { actor_type: 1, actor_id: 1, occurred_at: -1 }),

  // 5.2 - indexes added by BUILD 03-06 in feature 005
  ix('uq_participant_institution_external_id', 'participants', { institution_id: 1, external_student_id: 1 }, { unique: true, partial: { external_student_id: str } }),
  ix('uq_consent_active_type_protocol', 'consents', { participant_id: 1, consent_type: 1, protocol_version: 1 }, { unique: true, partial: { status: { $in: ['PENDING', 'GRANTED', 'VERIFIED'] } } }),
  ix('uq_submit_idempotency', 'response_events', { attempt_id: 1, 'metadata.idempotency_key': 1 }, { unique: true, partial: { event_type: 'SUBMIT' } }),
  ix('uq_quality_flag_logical', 'quality_flags', { attempt_id: 1, domain_code: 1, flag_code: 1 }, { unique: true }),

  // 5.3 - inline UNIQUE constraints of BUILD 01 section 6
  ix('uq_institutions_code', 'institutions', { institution_code: 1 }, { unique: true }),
  ix('uq_participants_santulan_id', 'participants', { santulan_id: 1 }, { unique: true }),
  ix('uq_cohorts_institution_code', 'cohorts', { institution_id: 1, cohort_code: 1 }, { unique: true }),
  ix('uq_admin_users_auth', 'admin_users', { auth_provider: 1, auth_provider_subject_id: 1 }, { unique: true }),
  ix('uq_items_version_code', 'items', { assessment_version_id: 1, item_code: 1 }, { unique: true }),
  ix('uq_items_version_order', 'items', { assessment_version_id: 1, display_order: 1 }, { unique: true }),
  ix('uq_interpretation_rules_key', 'interpretation_rules', { assessment_version_id: 1, rule_code: 1, version: 1, locale: 1 }, { unique: true }),
  ix('uq_development_actions_key', 'development_actions', { action_code: 1, library_version: 1 }, { unique: true }),
  ix('uq_reflection_prompts_key', 'reflection_prompts', { prompt_code: 1, version: 1 }, { unique: true }),
  ix('uq_responses_idempotency', 'responses', { idempotency_key: 1 }, { unique: true }),
  ix('uq_scores_key', 'score_results', { attempt_id: 1, domain_code: 1, scoring_version: 1 }, { unique: true }),
  ix('uq_reports_attempt', 'reports', { attempt_id: 1 }, { unique: true }),
  ix('uq_report_sections_order', 'report_sections', { report_id: 1, display_order: 1 }, { unique: true }),
  ix('uq_growth_goals_priority', 'growth_goals', { priority_id: 1 }, { unique: true }),

  // 5.4 - added by change record 006
  ix('uq_one_open_set_per_age_group', 'assessment_versions', { configuration: 1 }, { unique: true, partial: { participation_state: 'OPEN' } }),
  ix('uq_one_live_revision_per_label', 'assessment_versions', { version_label: 1 }, { unique: true, partial: { status: { $in: ['DRAFT', 'FROZEN'] } } }),
  ix('uq_one_approved_rule_per_dimension', 'interpretation_rules',
    { assessment_version_id: 1, domain_code: 1, developmental_band: 1, evidence_state: 1, locale: 1, layer: 1 },
    { unique: true, partial: { status: 'APPROVED' } }),
];

// Dev-only collection (not a canonical entity, not counted in the 50).
const devIndexes = [
  ix('uq_dev_identity', 'dev_identity_credentials', { provider: 1, subject_id: 1 }, { unique: true }),
];

module.exports = { indexes, devIndexes, NONTERMINAL_ATTEMPT };
