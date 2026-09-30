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

/*
 * Recommended validation-profile extension (Student Demographic & Research Profile Capture Form v1.0, "full recommended
 * set"): education, language, gender, region and accessibility context for sampling/fairness/DIF research only - NEVER
 * referenced by C1-C7 scoring (form's own "non-negotiable scoring boundary"). First captured during registration and
 * editable afterwards - an edit is a new row, never an in-place update (Tier A, like participant_cohort_history
 * above; identity.findProfile reads back the latest by created_at). Every question on the live form is individually
 * optional, so every field but participant_id/profile_version/created_at is nullable. The cross-field
 * education_stage <-> current_class_year consistency (form Part II section 2) and the OPEN-route-only rule for
 * broad_region/urbanicity (question 11-12) are domain rules, not DB-level checks - they need context ($jsonSchema sees
 * only this one document).
 */
const participantProfiles = collection('participant_profiles', 'A', {
  participant_id: uuid(),
  profile_version: str({ nonblank: true }),

  education_stage: str({ enum: E.EDUCATION_STAGE, nullable: true }),
  current_class_year: str({ enum: E.CURRENT_CLASS_YEAR, nullable: true }),

  primary_language_mode: str({ enum: E.LANGUAGE_MODE, nullable: true }),
  primary_language_detail: str({ nullable: true, nonblank: true }), // the typed language name(s) when mode is DIFFERENT/MULTILINGUAL

  medium_of_instruction: str({ enum: E.MEDIUM_OF_INSTRUCTION, nullable: true }),
  medium_of_instruction_detail: str({ nullable: true, nonblank: true }), // when medium_of_instruction is OTHER

  gender_research: str({ enum: E.GENDER_RESEARCH, nullable: true }),
  gender_self_description: str({ nullable: true, nonblank: true }), // when gender_research is SELF_DESCRIBE

  broad_region_mode: str({ enum: E.REGION_MODE, nullable: true }),
  broad_region_detail: str({ nullable: true, nonblank: true }), // the typed state/UT or broad region name

  urbanicity: str({ enum: E.URBANICITY, nullable: true }),

  accessibility_accommodation: str({ enum: E.ACCESSIBILITY_ACCOMMODATION, nullable: true }),
  accessibility_accommodation_detail: str({ nullable: true, nonblank: true }), // when accessibility_accommodation is OTHER

  created_at: date(),
}, [
  implies(inList('$primary_language_mode', ['DIFFERENT', 'MULTILINGUAL']), notNull('$primary_language_detail')),
  implies(eq('$medium_of_instruction', 'OTHER'), notNull('$medium_of_instruction_detail')),
  implies(eq('$gender_research', 'SELF_DESCRIBE'), notNull('$gender_self_description')),
  implies(inList('$broad_region_mode', ['STATE_UT', 'BROADER']), notNull('$broad_region_detail')),
  implies(eq('$accessibility_accommodation', 'OTHER'), notNull('$accessibility_accommodation_detail')),
]);

/**
 * "Santulan Pilot Study Details" PART A (docs/Santulan 2.0/Profile, the older superseded draft) - fields the
 * currently-approved v1.0 profile form (above) explicitly lists under "Fields to EXCLUDE from the basic demographic
 * form": full_name, date_of_birth, religion and the rest of PART A section 2/3. This collection exists ONLY because
 * that exclusion was explicitly and deliberately overridden by direction, not because the approved form calls for it -
 * see participantPilotDetailsRules.js for the full override note. Tier A like participant_profiles: an edit is a new
 * row, never an in-place update; every field but participant_id/capture_version/full_name/created_at is nullable
 * (PART A's own fields are individually optional beyond name/age, and age already exists as
 * age_years_at_registration). Never referenced by C1-C7 scoring or joined into any research export.
 */
const participantPilotDetails = collection('participant_pilot_details', 'A', {
  participant_id: uuid(),
  capture_version: str({ nonblank: true }),

  full_name: str({ nonblank: true }),
  date_of_birth: date({ nullable: true }),
  class_name: str({ nullable: true, nonblank: true }), // PART A Q4 "Class" - free text, the draft gives it no controlled options
  gender: str({ nullable: true, nonblank: true }), // PART A Q5 "Gender" - free text, the draft gives it no controlled options either

  birth_order: str({ enum: E.BIRTH_ORDER, nullable: true }),
  sibling_count: int({ nullable: true, min: 0 }),
  religion: str({ enum: E.RELIGION, nullable: true }),
  family_type: str({ enum: E.FAMILY_TYPE, nullable: true }),
  residence_type: str({ enum: E.RESIDENCE_TYPE, nullable: true }),
  state: str({ nullable: true, nonblank: true }),

  school_type: str({ enum: E.SCHOOL_TYPE, nullable: true }),
  study_medium: str({ enum: E.STUDY_MEDIUM, nullable: true }),
  board: str({ enum: E.BOARD, nullable: true }),
  academic_stream: str({ enum: E.ACADEMIC_STREAM, nullable: true }), // PART A Q15, "Class 11-12 only" per the draft - a domain rule, not a DB-level check (class_name is free text)

  created_at: date(),
});

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

module.exports = [institutions, cohorts, adminUsers, participants, participantProfiles, participantPilotDetails, participantCohortHistory, consents];
