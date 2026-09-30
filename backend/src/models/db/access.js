/*
 * Access rules per collection: how a scope sees the collection (kind) and which fields the application may ever update
 * (Tier B "named mutation"; Tier A collections have no update path at all, with one narrow exception - `items.status`,
 * whether a question is shown to participants, never its content). The credential enforces the same limits at the
 * store (role santulan_runtime); this table is the application half of the guarantee.
 *
 * kinds
 *   participant  the participants collection (self for a participant; institution match for an institution admin)
 *   tenantSelf   institutions (an institution admin sees only their own)
 *   tenant       carries institution_id (cohorts)
 *   owned        carries participant_id (own rows for a participant; the institution's participants for an institution admin)
 *   child        owned through a parent collection (checked by parent visibility; the foreign key must be in the filter)
 *   reference    question sets and questions (readable by any valid scope)
 *   privileged   only SUPER_ADMIN / SYSTEM can read or write
 *
 * writeBy: 'privileged' on any kind means a participant may READ their own rows but only SUPER_ADMIN / SYSTEM may INSERT them (reports,
 * sections, growth plans and candidates, pathway rows are produced by the engines, never by a participant credential).
 */
const ACCESS = {
  participants: { kind: 'participant', update: ['status', 'updated_at'] },
  institutions: { kind: 'tenantSelf', update: ['institution_name', 'institution_type', 'parent_institution_id', 'status', 'updated_at'] },
  cohorts: { kind: 'tenant', field: 'institution_id', update: ['cohort_name', 'academic_year', 'developmental_band', 'education_stage', 'status', 'updated_at'] },
  admin_users: { kind: 'privileged', update: ['status', 'updated_at'] },
  participant_profiles: { kind: 'owned', field: 'participant_id', update: null },
  participant_pilot_details: { kind: 'owned', field: 'participant_id', update: null },
  participant_cohort_history: { kind: 'owned', field: 'participant_id', update: null },
  consents: { kind: 'owned', field: 'participant_id', update: ['status', 'granted_at', 'verified_at', 'withdrawn_at', 'verification_method'] },

  assessment_versions: { kind: 'reference', writeBy: 'privileged', update: ['status', 'frozen_at', 'participation_state'] },
  items: { kind: 'reference', writeBy: 'privileged', update: ['status'] }, // the only field ever updatable on an item - whether it's shown to participants
  interpretation_rules: { kind: 'privileged', update: ['status'] },
  development_actions: { kind: 'privileged', update: ['active'] },
  reflection_prompts: { kind: 'privileged', update: ['status'] },

  assessment_attempts: { kind: 'owned', field: 'participant_id', update: ['status', 'session_count', 'started_at', 'submitted_at', 'completed_at', 'last_activity_at', 'scoring_version', 'lock_version'] },
  responses: { kind: 'child', parent: 'assessment_attempts', field: 'attempt_id', update: ['is_current'] }, // only via the responses repository's retireCurrent
  response_events: { kind: 'child', parent: 'assessment_attempts', field: 'attempt_id', update: null },

  quality_flags: { kind: 'privileged', update: ['disposition', 'reviewed_by', 'reviewed_at', 'review_note'] },
  score_results: { kind: 'privileged', update: null },
  reports: { kind: 'owned', field: 'participant_id', writeBy: 'privileged', update: ['generation_status', 'retry_count', 'generated_at', 'last_error_code', 'last_error_at', 'content_hash'] },
  report_sections: { kind: 'child', parent: 'reports', field: 'report_id', writeBy: 'privileged', update: ['is_released_to_participant'], participantFilter: { is_released_to_participant: true } },

  growth_plans: { kind: 'owned', field: 'participant_id', writeBy: 'privileged', update: ['status', 'updated_at'] },
  growth_priorities: { kind: 'child', parent: 'growth_plans', field: 'plan_id', writeBy: 'privileged', update: ['participant_selected', 'priority_text'] },
  growth_goals: { kind: 'child', parent: 'growth_priorities', field: 'priority_id', update: ['goal_text', 'cue', 'response', 'fallback_action', 'frequency', 'review_date', 'status', 'updated_at'] },
  growth_actions: { kind: 'child', parent: 'growth_goals', field: 'goal_id', update: ['action_text'] },
  growth_reviews: { kind: 'child', parent: 'growth_goals', field: 'goal_id', update: null },
  pathway_decisions: { kind: 'owned', field: 'participant_id', writeBy: 'privileged', update: null },
  pathway_reviews: { kind: 'child', parent: 'pathway_decisions', field: 'pathway_decision_id', writeBy: 'privileged', update: null },

  research_exports: { kind: 'privileged', update: ['status', 'file_reference', 'completed_at'] },
  audit_logs: { kind: 'privileged', update: null, anyoneMayInsert: true },
  dev_identity_credentials: { kind: 'privileged', update: ['secret_hash', 'must_change', 'status', 'updated_at'] },
};

const RESEARCH_VIEWS = [
  'v_research_participants', 'v_research_attempts', 'v_research_item_responses', 'v_research_domain_scores',
  'v_research_quality_flags', 'v_research_response_events', 'v_research_assessment_versions', 'v_research_cohorts',
];

module.exports = { ACCESS, RESEARCH_VIEWS };
