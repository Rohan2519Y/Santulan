/*
 * Registration rules (BUILD 03; data-model section 7). Cross-document rules that MongoDB validators cannot express
 * (the cohort belongs to the institution; INSTITUTIONAL needs an ACTIVE institution and cohort) are enforced here inside
 * the registering transaction. Same-document rules (derived fields, OPEN/INSTITUTIONAL shape) are also enforced by the
 * collection validator - the derivation below must stay in step with it.
 */
const { HttpError } = require('../../errors');
const { generateSantulanId } = require('../registration/santulanId');
const identity = require('../../models/repositories/identity');

/** Derived fields of an eligible age (BUILD 01 generated columns). */
function deriveFields(age) {
  const band = age <= 15 ? 'D1' : age <= 17 ? 'D2' : age <= 20 ? 'D3' : 'D4';
  return { developmental_band: band, assessment_track: age < 18 ? 'ADOLESCENT' : 'EMERGING_ADULT', is_minor: age < 18 };
}

function assertEligibleAge(age) {
  if (!Number.isInteger(age) || age < 13 || age > 25) throw new HttpError(422, 'AGE_INELIGIBLE', 'Santulan is available for ages 13 to 25');
}

/** INSTITUTIONAL needs an ACTIVE institution and ACTIVE cohort that belongs to it; OPEN carries no institution scope. */
async function assertScope(tx, { route, institutionId, cohortId, externalStudentId }) {
  if (route === 'OPEN') {
    if (institutionId || cohortId || externalStudentId) throw new HttpError(422, 'SCOPE_INVALID', 'An open registration carries no institution scope');
    return null;
  }
  const scope = institutionId && cohortId ? await identity.findActiveScope(tx, institutionId, cohortId) : null;
  if (!scope) throw new HttpError(422, 'SCOPE_INVALID', 'The institution or cohort is not available');
  return scope;
}

/** Builds a participant document. The Santulan ID is always server-generated (never client supplied). */
function buildParticipant({ _id, route, age, language = 'en', institutionId = null, cohortId = null, externalStudentId = null, authProvider = null, authProviderSubjectId = null }) {
  const now = new Date();
  return {
    _id,
    santulan_id: generateSantulanId(),
    participation_route: route,
    institution_id: institutionId,
    cohort_id: cohortId,
    external_student_id: externalStudentId,
    age_years_at_registration: age,
    ...deriveFields(age),
    administration_language: language,
    auth_provider: authProvider,
    auth_provider_subject_id: authProviderSubjectId,
    status: 'ACTIVE',
    created_at: now,
    updated_at: now,
  };
}

module.exports = { deriveFields, assertEligibleAge, assertScope, buildParticipant };
