// Developmental bands (D1-D4) are referenced by the ERD (participants.age_band,
// interpretation_rules.developmental_band) but no numeric age split is given
// anywhere in docs/. Engineering decision (mirrors research.md's format):
// split each pilot tool's age span into two even bands. Item eligibility does
// NOT depend on this mapping (it uses raw age + item.age_band/context
// directly, see eligibility.service.js); D1-D4 only scopes ParticipantProfile
// and InterpretationRule lookups.
// D2/D3 split at 17/18 deliberately lines up with is_minor's age<18 cutoff and
// with the item pools' own tool boundary (adolescent tops out at the 13-18
// variant, emerging-adult starts at the 18-25 variant) so age-band-derived
// tool routing (toolBandFromAgeBand) and the direct age check (deriveIsMinor)
// never disagree at the boundary age.
const AGE_BAND_RANGES = [
  { band: 'D1', min: 13, max: 14 },
  { band: 'D2', min: 15, max: 17 },
  { band: 'D3', min: 18, max: 21 },
  { band: 'D4', min: 22, max: 25 },
];

function deriveAgeBand(age) {
  const match = AGE_BAND_RANGES.find((r) => age >= r.min && age <= r.max);
  return match ? match.band : null;
}

function deriveIsMinor(age) {
  return age < 18;
}

function toolBandFromAgeBand(ageBand) {
  return ageBand === 'D1' || ageBand === 'D2' ? 'ADOLESCENT' : 'EMERGING_ADULT';
}

function deriveToolBand(age) {
  return toolBandFromAgeBand(deriveAgeBand(age));
}

// Item-pool `context` string (contracts/item-pool-schema.md) -> ParticipantProfile
// `context` enum. `Digital` has no participant-side counterpart in this feature's
// scope, so Digital-context items are structurally imported but never eligible
// (see eligibility.service.js).
const ITEM_CONTEXT_TO_PARTICIPANT_CONTEXT = {
  School: 'SCHOOL',
  'College/Work': 'COLLEGE_WORK',
};

const DOMAIN_CODES = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'];

const SCORING_VERSION = 'scoring-v1.0';
const MAX_SESSIONS = 4;
const RESPONSE_SCALE = { points: 5, anchors: { 1: 'Almost never', 2: 'Rarely', 3: 'Sometimes', 4: 'Often', 5: 'Almost always' } };
const ACTIVE_ATTEMPT_STATUSES = ['CREATED', 'STARTED', 'IN_PROGRESS', 'PAUSED'];

// data-model.md FR-009/010: "held constructs (SH, e.g. C4 Self-Worth) produce
// no operational output." C4 (Identity & Self-Concept) is this pilot's one
// held domain; every attempt's C4 ScoreResult is computed but always reported
// as SH, never as an operational score/interpretation.
const HELD_DOMAINS = ['C4'];

module.exports = {
  AGE_BAND_RANGES,
  deriveAgeBand,
  deriveIsMinor,
  deriveToolBand,
  toolBandFromAgeBand,
  ITEM_CONTEXT_TO_PARTICIPANT_CONTEXT,
  DOMAIN_CODES,
  SCORING_VERSION,
  MAX_SESSIONS,
  RESPONSE_SCALE,
  ACTIVE_ATTEMPT_STATUSES,
  HELD_DOMAINS,
};
