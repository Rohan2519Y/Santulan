/*
 * Deterministic age routing (BUILD 03 section 7). One engine, two configurations: 13-17 ADOLESCENT (minor),
 * 18-25 EMERGING_ADULT; age 18 has no other route; < 13 and > 25 are ineligible.
 * The question set a participant is given is NOT decided here: at attempt creation the server picks the single open set of the
 * participant's age group (feature 006). This module only decides the track and the consents required.
 */
function resolveAgeRoute(age) {
  if (!Number.isInteger(age) || age < 13 || age > 25) {
    return { eligible: false, assessmentTrack: null, isMinor: null, requiredConsents: [] };
  }
  if (age <= 17) {
    return {
      eligible: true, assessmentTrack: 'ADOLESCENT', isMinor: true,
      requiredConsents: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'],
    };
  }
  return {
    eligible: true, assessmentTrack: 'EMERGING_ADULT', isMinor: false,
    requiredConsents: ['ADULT_SELF_CONSENT'],
  };
}

module.exports = { resolveAgeRoute };
