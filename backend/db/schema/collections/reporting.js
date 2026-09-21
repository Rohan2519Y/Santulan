/* Reports, growth and pathway collections (BUILD 01 section 6.17-6.25; BUILD 07; CR-006-9 content_hash). */
const E = require('../enums');
const D = require('../dsl');

const { uuid, str, int, bool, date, isoDate, hex64, collection, isNull, notNull, implies, inList } = D;

const reports = collection('reports', 'B', {
  participant_id: uuid(),
  attempt_id: uuid(),
  report_version: str({ nonblank: true }),
  report_type: str({ nonblank: true }),
  generation_status: str({ enum: E.REPORT_STATUS }),
  retry_count: int({ min: 0 }),
  generated_at: date({ nullable: true }),
  last_error_code: str({ nullable: true }),
  last_error_at: date({ nullable: true }),
  content_hash: hex64({ nullable: true }),
  created_at: date(),
}, [
  // A terminal report always carries its fingerprint; a report in progress or failed never does (G-29).
  implies(inList('$generation_status', ['REPORT_READY', 'UNDER_REVIEW', 'NOT_ELIGIBLE']), notNull('$content_hash')),
  implies(inList('$generation_status', ['PENDING', 'FAILED_RETRYABLE']), isNull('$content_hash')),
]);

const reportSections = collection('report_sections', 'B', {
  report_id: uuid(),
  section_type: str({ enum: E.SECTION_TYPE }),
  is_released_to_participant: bool(),
  domain_code: str({ enum: E.DOMAIN, nullable: true }),
  content_version: str({ nonblank: true }),
  locale: str({ nonblank: true }),
  display_order: int({ min: 1 }),
  content_snapshot: str({ nonblank: true }),
  created_at: date(),
});

const growthPlans = collection('growth_plans', 'B', {
  participant_id: uuid(),
  source_attempt_id: uuid(),
  assessment_version_id: uuid(),
  growth_plan_version: str({ nonblank: true }),
  status: str({ enum: E.GROWTH_PLAN_STATUS }),
  created_at: date(),
  updated_at: date(),
});

const growthPriorities = collection('growth_priorities', 'B', {
  plan_id: uuid(),
  domain_code: str({ enum: E.DOMAIN }),
  candidate_rank: int({ min: 1, nullable: true }),
  participant_selected: bool(),
  priority_text: str({ nonblank: true }),
  created_at: date(),
});

const growthGoals = collection('growth_goals', 'B', {
  priority_id: uuid(),
  goal_text: str({ nonblank: true }),
  cue: str({ nullable: true }),
  response: str({ nullable: true }),
  fallback_action: str({ nullable: true }),
  frequency: str({ nullable: true }),
  review_date: isoDate({ nullable: true }),
  status: str({ enum: E.GROWTH_GOAL_STATUS }),
  created_at: date(),
  updated_at: date(),
});

const growthActions = collection('growth_actions', 'B', {
  goal_id: uuid(),
  action_code: str({ nonblank: true }),
  action_version: str({ nonblank: true }),
  action_text: str({ nonblank: true }),
  created_at: date(),
});

const growthReviews = collection('growth_reviews', 'A', {
  goal_id: uuid(),
  review_date: isoDate(),
  what_happened: str({ nullable: true }),
  barrier: str({ nullable: true }),
  learning: str({ nullable: true }),
  adjustment: str({ nullable: true }),
  evidence_note: str({ nullable: true }),
  next_step: str({ nullable: true }),
  created_at: date(),
});

const pathwayDecisions = collection('pathway_decisions', 'A', {
  participant_id: uuid(),
  source_attempt_id: uuid(),
  domain_code: str({ enum: E.DOMAIN, nullable: true }),
  pathway_code: str({ enum: E.PATHWAY_CODE }),
  trigger_code: str({ nonblank: true }),
  evidence_state: str({ enum: E.EVIDENCE }),
  decision_source: str({ enum: E.PATHWAY_SOURCE }),
  decision_reason: str({ nonblank: true }),
  status: str({ enum: E.PATHWAY_STATUS }),
  created_at: date(),
  review_due: isoDate({ nullable: true }),
  policy_version: str({ nonblank: true }),
  pathway_engine_version: str({ nonblank: true }),
});

const pathwayReviews = collection('pathway_reviews', 'A', {
  pathway_decision_id: uuid(),
  outcome: str({ enum: E.PATHWAY_REVIEW_OUTCOME }),
  evidence_note: str({ nullable: true }),
  support_change: str({ nullable: true }),
  next_step: str({ nullable: true }),
  reviewed_by: uuid({ nullable: true }),
  reviewed_at: date(),
});

module.exports = [reports, reportSections, growthPlans, growthPriorities, growthGoals, growthActions, growthReviews, pathwayDecisions, pathwayReviews];
