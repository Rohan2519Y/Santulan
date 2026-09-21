/* Identity, organisation and consent collections (BUILD 01 section 6.1-6.5, 6.27; data-model section 4). */
const E = require('../enums');
const D = require('../dsl');

const { uuid, str, int, bool, date, collection, isNull, notNull, implies, eq, inList, and, or, nullOrGte } = D;

const institutions = collection('institutions', 'B', {
  institution_code: str({ nonblank: true }),
  institution_name: str({ nonblank: true }),
  institution_type: str({ enum: E.INSTITUTION_TYPE }),
  parent_institution_id: uuid({ nullable: true }),
  status: str({ enum: E.INSTITUTION_STATUS }),
  created_at: date(),
  updated_at: date(),
}, [
  or(isNull('$parent_institution_id'), { $ne: ['$parent_institution_id', '$_id'] }), // institutions_not_self_parent
]);

const cohorts = collection('cohorts', 'B', {
  institution_id: uuid(),
  cohort_code: str({ nonblank: true }),
  cohort_name: str({ nonblank: true }),
  academic_year: str({ nullable: true }),
  developmental_band: str({ enum: E.BAND, nullable: true }),
  education_stage: str({ nullable: true }),
  status: str({ enum: E.COHORT_STATUS }),
  created_at: date(),
  updated_at: date(),
});

const adminUsers = collection('admin_users', 'B', {
  role: str({ enum: E.ADMIN_ROLE }),
  auth_provider: str({ nonblank: true }),
  auth_provider_subject_id: str({ nonblank: true }),
  status: str({ enum: E.ADMIN_STATUS }),
  created_at: date(),
  updated_at: date(),
}, [
  implies(eq('$status', 'ACTIVE'), eq('$role', 'SUPER_ADMIN')), // BUILD 08 pilot-role control (G-07)
]);

const age = '$age_years_at_registration';
const participants = collection('participants', 'B', {
  santulan_id: str({ pattern: '^STN-[0-9A-HJKMNP-TV-Z]{20}$' }),
  participation_route: str({ enum: E.ROUTE }),
  institution_id: uuid({ nullable: true }),
  cohort_id: uuid({ nullable: true }),
  external_student_id: str({ nullable: true }),
  age_years_at_registration: int({ min: 13, max: 25 }),
  developmental_band: str({ enum: E.BAND }),
  assessment_track: str({ enum: E.TRACK }),
  is_minor: bool(),
  administration_language: str({ nonblank: true }),
  auth_provider: str({ nullable: true }),
  auth_provider_subject_id: str({ nullable: true }),
  status: str({ enum: E.PARTICIPANT_STATUS }),
  created_at: date(),
  updated_at: date(),
}, [
  // Derived fields stay consistent with the age on insert and update (BUILD 01 generated columns).
  eq('$developmental_band', {
    $switch: {
      branches: [
        { case: { $lte: [age, 15] }, then: 'D1' },
        { case: { $lte: [age, 17] }, then: 'D2' },
        { case: { $lte: [age, 20] }, then: 'D3' },
      ],
      default: 'D4',
    },
  }),
  eq('$assessment_track', { $cond: [{ $lt: [age, 18] }, 'ADOLESCENT', 'EMERGING_ADULT'] }),
  eq('$is_minor', { $lt: [age, 18] }),
  // OPEN carries no institution scope; INSTITUTIONAL carries both (participant_open_scope_ck / institutional_scope_ck).
  implies(eq('$participation_route', 'OPEN'), and(isNull('$institution_id'), isNull('$cohort_id'), isNull('$external_student_id'))),
  implies(eq('$participation_route', 'INSTITUTIONAL'), and(notNull('$institution_id'), notNull('$cohort_id'))),
  // participant_auth_pair_ck
  or(and(isNull('$auth_provider'), isNull('$auth_provider_subject_id')), and(notNull('$auth_provider'), notNull('$auth_provider_subject_id'))),
]);

const participantCohortHistory = collection('participant_cohort_history', 'A', {
  participant_id: uuid(),
  cohort_id: uuid(),
  institution_id: uuid(),
  assigned_at: date(),
  removed_at: date({ nullable: true }),
  assigned_by: uuid({ nullable: true }),
  reason: str({ nullable: true }),
}, [nullOrGte('$removed_at', '$assigned_at')]);

const consents = collection('consents', 'B', {
  participant_id: uuid(),
  consent_type: str({ enum: E.CONSENT_TYPE }),
  giver_relationship: str({ enum: E.CONSENT_RELATIONSHIP }),
  protocol_version: str({ nonblank: true }),
  verification_method: str({ nullable: true }),
  granted_at: date({ nullable: true }),
  verified_at: date({ nullable: true }),
  withdrawn_at: date({ nullable: true }),
  status: str({ enum: E.CONSENT_STATUS }),
  created_at: date(),
}, [
  // type/giver combinations (BUILD 04)
  implies(inList('$consent_type', ['ADULT_SELF_CONSENT', 'STUDENT_ASSENT']), eq('$giver_relationship', 'SELF')),
  implies(eq('$consent_type', 'PARENT_GUARDIAN_CONSENT'), inList('$giver_relationship', ['PARENT', 'GUARDIAN'])),
  // consent_verified_method_ck: VERIFIED needs verified_at and a non-blank method
  implies(eq('$status', 'VERIFIED'), and(
    notNull('$verified_at'),
    { $eq: [{ $type: '$verification_method' }, 'string'] },
    { $gt: [{ $strLenCP: { $trim: { input: { $ifNull: ['$verification_method', ''] } } } }, 0] },
  )),
  // consent_*_time_ck
  nullOrGte('$granted_at', '$created_at'),
  or(isNull('$verified_at'), and(notNull('$granted_at'), { $gte: ['$verified_at', '$granted_at'] })),
  nullOrGte('$withdrawn_at', '$created_at'),
]);

module.exports = [institutions, cohorts, adminUsers, participants, participantCohortHistory, consents];
