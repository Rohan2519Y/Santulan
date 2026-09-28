/*
 * Validation-profile rules (Student Demographic & Research Profile Capture Form v1.0). Cross-field rules that the
 * collection validator cannot express (it sees only this one document) live here: which current_class_year codes are
 * valid for which education_stage (form Part II section 2), and that broad_region/urbanicity are collected for OPEN
 * participation only (form question 11-12). The *_detail-required-when-its-mode-demands-text pairs ARE same-document
 * rules, so those stay in the collection validator ($expr) - no need to duplicate them here.
 */
const { HttpError } = require('../../errors');

const PROFILE_VERSION = 'STUDENT_PROFILE_v1.0';

const CLASS_YEAR_BY_STAGE = {
  SCHOOL: ['GRADE_7_OR_BELOW', 'GRADE_8', 'GRADE_9', 'GRADE_10', 'GRADE_11', 'GRADE_12'],
  DIPLOMA_VOCATIONAL: ['YEAR_1', 'YEAR_2', 'YEAR_3', 'YEAR_4', 'OTHER'],
  UNDERGRADUATE: ['UG_YEAR_1', 'UG_YEAR_2', 'UG_YEAR_3', 'UG_YEAR_4', 'UG_YEAR_5', 'OTHER'],
  POSTGRADUATE: ['PG_YEAR_1', 'PG_YEAR_2', 'OTHER'],
  NOT_ENROLLED: ['NOT_APPLICABLE'],
  OTHER: ['OTHER'],
};

/** Only checked when both are given - each question on the live form is independently optional. */
function assertClassYearForStage(educationStage, currentClassYear) {
  if (educationStage == null || currentClassYear == null) return;
  const allowed = CLASS_YEAR_BY_STAGE[educationStage] || [];
  if (!allowed.includes(currentClassYear)) {
    throw new HttpError(422, 'CLASS_YEAR_INVALID_FOR_STAGE', `"${currentClassYear}" is not a valid class/year for education stage "${educationStage}"`);
  }
}

/** Question 11 (broad region) and 12 (urbanicity): "For OPEN participation only" - an institutional participant's
 * institution/cohort already carries that context. */
function assertRegionFieldsAllowed(participationRoute, body) {
  if (participationRoute === 'OPEN') return;
  if (body.broadRegionMode != null || body.urbanicity != null) {
    throw new HttpError(422, 'FIELD_NOT_APPLICABLE', 'Broad region and urbanicity are collected for open participation only');
  }
}

/** A profile is submitted once (Tier A, never edited); refuse a second attempt with a clear reason rather than the
 * store's generic duplicate-key conflict. */
function assertNotAlreadySubmitted(existing) {
  if (existing) throw new HttpError(409, 'PROFILE_ALREADY_SUBMITTED', 'A validation profile was already submitted for this participant');
}

/** Builds the document from the validated request body. Every optional field defaults to null (the collection
 * validator requires every field to be present, even when unanswered). */
function buildProfile({ _id, participantId, body }) {
  return {
    _id,
    participant_id: participantId,
    profile_version: PROFILE_VERSION,
    education_stage: body.educationStage ?? null,
    current_class_year: body.currentClassYear ?? null,
    primary_language_mode: body.primaryLanguageMode ?? null,
    primary_language_detail: body.primaryLanguageDetail ?? null,
    medium_of_instruction: body.mediumOfInstruction ?? null,
    medium_of_instruction_detail: body.mediumOfInstructionDetail ?? null,
    gender_research: body.genderResearch ?? null,
    gender_self_description: body.genderSelfDescription ?? null,
    broad_region_mode: body.broadRegionMode ?? null,
    broad_region_detail: body.broadRegionDetail ?? null,
    urbanicity: body.urbanicity ?? null,
    accessibility_accommodation: body.accessibilityAccommodation ?? null,
    accessibility_accommodation_detail: body.accessibilityAccommodationDetail ?? null,
    created_at: new Date(),
  };
}

module.exports = { PROFILE_VERSION, CLASS_YEAR_BY_STAGE, assertClassYearForStage, assertRegionFieldsAllowed, assertNotAlreadySubmitted, buildProfile };
