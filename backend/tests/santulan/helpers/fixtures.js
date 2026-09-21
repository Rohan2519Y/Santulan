/* Valid synthetic document factories (T046). No real personal data: prefixes STN-FX / FX-, every field present. */
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const now = () => new Date();
const hex = (seed = uuidv4()) => crypto.createHash('sha256').update(String(seed)).digest('hex');
const santulanId = () => {
  const A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let s = 'STN-';
  const b = crypto.randomBytes(20);
  for (let i = 0; i < 20; i += 1) s += A[b[i] & 31];
  return s;
};

const bandOf = (age) => (age <= 15 ? 'D1' : age <= 17 ? 'D2' : age <= 20 ? 'D3' : 'D4');

const institution = (o = {}) => ({
  _id: uuidv4(), institution_code: `FX-INST-${uuidv4().slice(0, 8)}`, institution_name: 'Fixture Institution', institution_type: 'SCHOOL',
  parent_institution_id: null, status: 'ACTIVE', created_at: now(), updated_at: now(), ...o,
});

const cohort = (institutionId, o = {}) => ({
  _id: uuidv4(), institution_id: institutionId, cohort_code: `FX-C-${uuidv4().slice(0, 8)}`, cohort_name: 'Fixture Cohort', academic_year: null,
  developmental_band: null, education_stage: null, status: 'ACTIVE', created_at: now(), updated_at: now(), ...o,
});

/** OPEN participant by default; pass { institution, cohort } ids for INSTITUTIONAL. */
const participant = (o = {}) => {
  const age = o.age_years_at_registration || 16;
  const inst = o.participation_route === 'INSTITUTIONAL';
  return {
    _id: uuidv4(), santulan_id: santulanId(), participation_route: 'OPEN', institution_id: null, cohort_id: null, external_student_id: null,
    age_years_at_registration: age, developmental_band: bandOf(age), assessment_track: age < 18 ? 'ADOLESCENT' : 'EMERGING_ADULT', is_minor: age < 18,
    administration_language: 'en', auth_provider: null, auth_provider_subject_id: null, status: 'ACTIVE', created_at: now(), updated_at: now(),
    ...(inst ? {} : {}), ...o,
  };
};

const admin = (o = {}) => ({
  _id: uuidv4(), role: 'SUPER_ADMIN', auth_provider: 'fx-dev', auth_provider_subject_id: `FX-ADMIN-${uuidv4().slice(0, 8)}`, status: 'ACTIVE',
  created_at: now(), updated_at: now(), ...o,
});

const consent = (participantId, o = {}) => ({
  _id: uuidv4(), participant_id: participantId, consent_type: 'ADULT_SELF_CONSENT', giver_relationship: 'SELF', protocol_version: 'FX-PROTOCOL-1',
  verification_method: null, granted_at: null, verified_at: null, withdrawn_at: null, status: 'PENDING', created_at: now(), ...o,
});

const verifiedConsent = (participantId, o = {}) => {
  const t0 = new Date(Date.now() - 60000);
  return consent(participantId, { status: 'VERIFIED', verification_method: 'FX-METHOD', created_at: t0, granted_at: new Date(t0.getTime() + 1000), verified_at: new Date(t0.getTime() + 2000), ...o });
};

const cohortHistory = (participantId, cohortId, institutionId, o = {}) => ({
  _id: uuidv4(), participant_id: participantId, cohort_id: cohortId, institution_id: institutionId, assigned_at: now(), removed_at: null, assigned_by: null, reason: null, ...o,
});

const versionDoc = (o = {}) => ({
  _id: uuidv4(), version_label: `fx-set-${uuidv4().slice(0, 8)}`, revision: 1, configuration: 'ADOLESCENT', participant_min_age: 13, participant_max_age: 17,
  content_hash: hex(), source_file_hash: hex(), frozen_at: null, status: 'DRAFT', participation_state: 'CLOSED', created_at: now(), ...o,
});

const STD_OPTIONS = ['Almost never', 'Rarely', 'Sometimes', 'Often', 'Almost always'];
const options = (n = 5) => Array.from({ length: n }, (_, i) => ({ position: i + 1, text: n === 5 ? STD_OPTIONS[i] : `Option ${i + 1}` }));

const item = (versionId, o = {}) => ({
  _id: uuidv4(), assessment_version_id: versionId, item_code: 'C1-01', domain_code: 'C1', subdomain_code: 'C1.1', subdomain_name: 'Interoceptive Awareness',
  item_text: 'I notice how my body feels.', keying: 'POSITIVE', age_band: '13–17', context: 'General', layer: 'CORE', pilot_status: 'READY', display_order: 1,
  status: 'ACTIVE', item_content_hash: hex(), created_at: now(), options: options(5), ...o,
});

const attempt = (participantId, versionId, o = {}) => ({
  _id: uuidv4(), participant_id: participantId, assessment_version_id: versionId, age_years_at_attempt: 16, developmental_band_at_attempt: 'D2', status: 'CREATED',
  session_count: 0, created_at: now(), started_at: null, submitted_at: null, completed_at: null, last_activity_at: null, scoring_version: null, lock_version: 0, ...o,
});

const response = (attemptId, itemId, o = {}) => ({
  _id: uuidv4(), attempt_id: attemptId, item_id: itemId, response_value: '3', response_version: 1, is_current: true, supersedes_response_id: null,
  response_time_ms: null, presented_order: null, answered_at: now(), idempotency_key: `FX-KEY-${uuidv4()}`, ...o,
});

const responseEvent = (attemptId, o = {}) => ({
  _id: uuidv4(), attempt_id: attemptId, item_id: null, event_type: 'SESSION_START', session_number: 1, occurred_at: now(), metadata: {}, ...o,
});

const qualityFlag = (attemptId, o = {}) => ({
  _id: uuidv4(), attempt_id: attemptId, domain_code: null, flag_code: 'Q07', severity: 'LOW', detected_at: now(), disposition: 'UNREVIEWED',
  reviewed_by: null, reviewed_at: null, review_note: null, ...o,
});

/** Complete, 10 of 10 by default. */
const score = (attemptId, participantId, versionId, o = {}) => ({
  _id: uuidv4(), attempt_id: attemptId, participant_id: participantId, assessment_version_id: versionId, domain_code: 'C1', raw_score: 4.0, completeness_rate: 1,
  eligible_items: 10, valid_items: 10, completeness_status: 'COMPLETE', score_status: 'S1', scoring_version: 'domain-mean-v1', calculated_at: now(), ...o,
});

const report = (participantId, attemptId, o = {}) => ({
  _id: uuidv4(), participant_id: participantId, attempt_id: attemptId, report_version: 'report-v3.1', report_type: 'PARTICIPANT', generation_status: 'PENDING', retry_count: 0,
  generated_at: null, last_error_code: null, last_error_at: null, content_hash: null, created_at: now(), ...o,
});

const reportSection = (reportId, o = {}) => ({
  _id: uuidv4(), report_id: reportId, section_type: 'PROFILE', is_released_to_participant: false, domain_code: null, content_version: 'fx-1', locale: 'en',
  display_order: 1, content_snapshot: '{}', created_at: now(), ...o,
});

const rule = (versionId, o = {}) => ({
  _id: uuidv4(), assessment_version_id: versionId, domain_code: 'C1', developmental_band: null, evidence_state: 'S2', locale: 'en', layer: 'MEANING',
  rule_code: `FX-RULE-${uuidv4().slice(0, 8)}`, approved_text_template: 'Fixture wording.', version: 'v1', status: 'DRAFT', created_at: now(), ...o,
});

const growthPlan = (participantId, attemptId, versionId, o = {}) => ({
  _id: uuidv4(), participant_id: participantId, source_attempt_id: attemptId, assessment_version_id: versionId, growth_plan_version: 'gp-1', status: 'DRAFT',
  created_at: now(), updated_at: now(), ...o,
});

const pathwayDecision = (participantId, attemptId, o = {}) => ({
  _id: uuidv4(), participant_id: participantId, source_attempt_id: attemptId, domain_code: null, pathway_code: 'P1', trigger_code: 'FX', evidence_state: 'S2',
  decision_source: 'SYSTEM', decision_reason: 'fixture', status: 'S1', created_at: now(), review_due: null, policy_version: 'fx', pathway_engine_version: 'fx', ...o,
});

const audit = (o = {}) => ({
  _id: uuidv4(), actor_type: 'SYSTEM', actor_id: null, action_type: 'FX_ACTION', target_entity: 'fixture', target_id: null, previous_state: null, new_state: null,
  reason: null, occurred_at: now(), correlation_id: null, ...o,
});

const researchExport = (adminId, versionId, o = {}) => ({
  _id: uuidv4(), requested_by: adminId, filters: {}, anonymisation_version: 'fx-anon-1', source_assessment_version_id: versionId, created_at: now(), status: 'REQUESTED',
  file_reference: null, completed_at: null, ...o,
});

const devCredential = (o = {}) => ({
  _id: uuidv4(), provider: 'fx-dev', subject_id: `FX-SUBJ-${uuidv4().slice(0, 8)}`, secret_hash: 'fx-hash', must_change: false, status: 'active', created_at: now(), updated_at: now(), ...o,
});

module.exports = {
  hex, santulanId, bandOf, options, STD_OPTIONS,
  institution, cohort, participant, admin, consent, verifiedConsent, cohortHistory, versionDoc, item, attempt, response, responseEvent, qualityFlag,
  score, report, reportSection, rule, growthPlan, pathwayDecision, audit, researchExport, devCredential,
};
