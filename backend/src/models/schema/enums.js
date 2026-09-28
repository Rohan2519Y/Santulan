/* Enumerations of the canonical model (values as in BUILD 01 and the feature-005 SQL types; unstated ones are ASSUMED (D-11)). */
const framework = require('../../../seeders/santulan/reference/framework.json');

module.exports = {
  INSTITUTION_TYPE: ['SCHOOL', 'COLLEGE', 'UNIVERSITY'],
  INSTITUTION_STATUS: ['ACTIVE', 'INACTIVE', 'ARCHIVED'], // ASSUMED (D-11)
  COHORT_STATUS: ['ACTIVE', 'INACTIVE', 'ARCHIVED'], // ASSUMED (D-11)
  BAND: ['D1', 'D2', 'D3', 'D4'],
  ROUTE: ['OPEN', 'INSTITUTIONAL'],
  TRACK: ['ADOLESCENT', 'EMERGING_ADULT'],
  PARTICIPANT_STATUS: ['ACTIVE', 'SUSPENDED', 'WITHDRAWN'], // ASSUMED (D-11)
  CONSENT_TYPE: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT', 'ADULT_SELF_CONSENT'],
  CONSENT_RELATIONSHIP: ['PARENT', 'GUARDIAN', 'SELF', 'INSTITUTION_DELEGATED'],
  CONSENT_STATUS: ['PENDING', 'GRANTED', 'VERIFIED', 'WITHDRAWN'],
  CONTENT_STATUS: ['DRAFT', 'FROZEN', 'RETIRED'],
  PARTICIPATION_STATE: ['CLOSED', 'OPEN', 'PAUSED', 'STOPPED'],
  KEYING: ['POSITIVE', 'REVERSE'],
  ITEM_LAYER: ['CORE', 'V', 'SJT', 'O'],
  ITEM_STATUS: ['ACTIVE', 'RETIRED'],
  AGE_BAND: ['13–17', '18–25', '13–25'],
  CONTEXT: ['General', 'School', 'College/Work', 'Digital'],
  CONTROLLED_STATUS: ['DRAFT', 'APPROVED', 'RETIRED'], // ASSUMED (D-11)
  PROGRESSION: ['Foundation', 'Practice', 'Transfer'],
  ATTEMPT_STATUS: ['CREATED', 'STARTED', 'IN_PROGRESS', 'PAUSED', 'SUBMITTED', 'SCORING', 'SCORED', 'REPORT_READY', 'QUALITY_HOLD', 'INVALID', 'EXPIRED'],
  EVENT_TYPE: ['SESSION_START', 'SESSION_END', 'PAUSE', 'RESUME', 'RESPONSE_SAVED', 'SUBMIT', 'QUALITY_CHECK_COMPLETED', 'REPORT_RETRY'],
  FLAG_CODE: ['Q01', 'Q02', 'Q03', 'Q04', 'Q05', 'Q06', 'Q07', 'Q08', 'Q09'],
  SEVERITY: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], // ASSUMED (D-11)
  DISPOSITION: ['UNREVIEWED', 'DISMISSED', 'CONFIRMED', 'ESCALATED'], // ASSUMED (D-11)
  EVIDENCE: ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'SH'],
  COMPLETENESS: ['COMPLETE', 'COMPLETE_WITH_MISSING', 'INCOMPLETE', 'INSUFFICIENT'],
  REPORT_STATUS: ['PENDING', 'REPORT_READY', 'FAILED_RETRYABLE', 'UNDER_REVIEW', 'NOT_ELIGIBLE'],
  SECTION_TYPE: ['PROFILE', 'MEANING', 'PATTERN', 'STRENGTH', 'GROWTH', 'PRIORITY', 'ACTION', 'CHANGE', 'UNDER_REVIEW', 'NOT_ELIGIBLE'],
  RULE_LAYER: ['MEANING', 'PATTERN', 'STRENGTH', 'GROWTH', 'CHANGE', 'PRIORITY', 'ACTION'],
  GROWTH_PLAN_STATUS: ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED'], // ASSUMED (D-11)
  GROWTH_GOAL_STATUS: ['PLANNED', 'ACTIVE', 'COMPLETED', 'DROPPED'], // ASSUMED (D-11)
  PATHWAY_CODE: ['P1', 'P2', 'P3', 'P4', 'P5'],
  PATHWAY_SOURCE: ['SYSTEM', 'PARTICIPANT', 'HUMAN_REVIEW'], // ASSUMED (D-11)
  PATHWAY_REVIEW_OUTCOME: ['CONFIRMED', 'CHANGED', 'CLOSED', 'ESCALATED'], // ASSUMED (D-11)
  PATHWAY_STATUS: ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'],
  EXPORT_STATUS: ['REQUESTED', 'GENERATING', 'READY', 'FAILED'],
  ADMIN_ROLE: ['SUPER_ADMIN', 'INSTITUTION_ADMIN', 'RESEARCH_OPERATOR'],
  ADMIN_STATUS: ['ACTIVE', 'SUSPENDED', 'INACTIVE'], // ASSUMED (D-11)
  ACTOR_TYPE: ['ADMIN', 'SYSTEM', 'PARTICIPANT'],
  DEV_STATUS: ['active', 'disabled'],
  DOMAIN: framework.domains.map((d) => d.code),
  SUBDOMAIN: framework.subdomains.map((s) => s.code),

  // Student Demographic & Research Profile Capture Form v1.0 ("the profile form"), Part I section B/C and Part II
  // section 2/4 - the recommended validation-profile extension (never referenced by C1-C7 scoring; profile form p.9).
  EDUCATION_STAGE: ['SCHOOL', 'DIPLOMA_VOCATIONAL', 'UNDERGRADUATE', 'POSTGRADUATE', 'NOT_ENROLLED', 'OTHER'], // RP-001
  CURRENT_CLASS_YEAR: [ // RP-002, profile form Part II section 2 (which codes are valid for which education_stage is a domain rule, not a DB-level check)
    'GRADE_7_OR_BELOW', 'GRADE_8', 'GRADE_9', 'GRADE_10', 'GRADE_11', 'GRADE_12',
    'YEAR_1', 'YEAR_2', 'YEAR_3', 'YEAR_4',
    'UG_YEAR_1', 'UG_YEAR_2', 'UG_YEAR_3', 'UG_YEAR_4', 'UG_YEAR_5',
    'PG_YEAR_1', 'PG_YEAR_2',
    'NOT_APPLICABLE', 'OTHER',
  ],
  // The form's own language field has no fixed code list (profile form p.6: "use a controlled language list" without
  // enumerating one) - so the closed set here is the answer MODE (question 7's four checkboxes); the language itself,
  // when typed, is free text in *_detail (ASSUMED split - ties the mode+detail field pair to the form's own UI, not invented).
  LANGUAGE_MODE: ['SAME_AS_ASSESSMENT', 'DIFFERENT', 'MULTILINGUAL', 'PREFER_NOT_TO_SAY'], // RP-003
  MEDIUM_OF_INSTRUCTION: ['ENGLISH', 'HINDI', 'OTHER', 'MIXED', 'NOT_APPLICABLE', 'PREFER_NOT_TO_SAY'], // RP-004
  GENDER_RESEARCH: ['FEMALE', 'MALE', 'NON_BINARY_OTHER', 'SELF_DESCRIBE', 'PREFER_NOT_TO_SAY'], // RP-005, profile form section 4
  REGION_MODE: ['STATE_UT', 'BROADER', 'PREFER_NOT_TO_SAY'], // RP-006, question 11's three checkboxes (OPEN route only - domain rule, not a DB-level check)
  URBANICITY: ['URBAN', 'SEMI_URBAN', 'RURAL', 'OTHER', 'PREFER_NOT_TO_SAY'], // RP-007
  ACCESSIBILITY_ACCOMMODATION: ['NONE', 'LARGE_TEXT', 'READER', 'EXTRA_TIME', 'TRANSLATION', 'OTHER', 'PREFER_NOT_TO_SAY'], // RP-008
};
