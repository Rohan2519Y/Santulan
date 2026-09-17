// Shared vocabulary for stem InterpretationRule seeding and the interpretation
// engine (FR-010): evidence states gate whether operational output is produced
// at all, and developmental bands scope the plain-language template.
const EVIDENCE_STATES = ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'SH'];
const DEVELOPMENTAL_BANDS = ['D1', 'D2', 'D3', 'D4'];

// S0 = not reportable (incomplete/insufficient response data), S1/S2 = the
// normal pilot-era reportable states (ERD 10_Quality_and_Scoring: "S1/S2 are
// the normal pilot states; S3+ require the matching evidence gate"), S3-S5 =
// higher evidence maturity (not reachable in pilot v1), SH = construct-level
// hold (evidence intentionally withheld from operational interpretation).
const OPERATIONAL_EVIDENCE_STATES = new Set(['S1', 'S2', 'S3', 'S4', 'S5']);

/**
 * Plain-language, non-diagnostic stem template. No percentiles, cut scores,
 * diagnoses, or reliable-change claims (FR-010, SC-005) - descriptive only.
 */
function buildStemTemplate(domainCode, domainName, evidenceState) {
  if (evidenceState === 'SH') {
    return `Your ${domainName} results are being held for careful review and are not shown as a score in this report.`;
  }
  if (!OPERATIONAL_EVIDENCE_STATES.has(evidenceState)) {
    return `There isn't yet enough information to describe your ${domainName} responses in this report.`;
  }
  return `Your responses describe your current experience of ${domainName.toLowerCase()}. This is a snapshot, not a fixed trait or a diagnosis.`;
}

module.exports = { EVIDENCE_STATES, DEVELOPMENTAL_BANDS, OPERATIONAL_EVIDENCE_STATES, buildStemTemplate };
