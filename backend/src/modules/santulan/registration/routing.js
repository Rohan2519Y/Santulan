/*
 * Deterministic age routing (BUILD 03 §7). One engine, two configurations: 13-17 ADOLESCENT (minor),
 * 18-25 EMERGING_ADULT; age 18 has no other route; < 13 and > 25 are ineligible.
 * Mirrors santulan.build03_resolve_registration(); the database is the final authority.
 */
const VERSIONS = {
  ADOLESCENT: 'santulan-adolescent-pilot-v3.1',
  EMERGING_ADULT: 'santulan-emergingadult-pilot-v3.1',
};

function resolveAgeRoute(age) {
  if (!Number.isInteger(age) || age < 13 || age > 25) {
    return { eligible: false, assessmentTrack: null, isMinor: null, versionLabel: null, requiredConsents: [] };
  }
  if (age <= 17) {
    return {
      eligible: true, assessmentTrack: 'ADOLESCENT', isMinor: true, versionLabel: VERSIONS.ADOLESCENT,
      requiredConsents: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'],
    };
  }
  return {
    eligible: true, assessmentTrack: 'EMERGING_ADULT', isMinor: false, versionLabel: VERSIONS.EMERGING_ADULT,
    requiredConsents: ['ADULT_SELF_CONSENT'],
  };
}

module.exports = { resolveAgeRoute, VERSIONS };
