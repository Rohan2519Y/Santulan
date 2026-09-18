const { OPERATIONAL_EVIDENCE_STATES } = require('./interpretationStems');

/**
 * FR-010: versioned, evidence-gated lookup by domain x developmental band x
 * evidence state x locale. Held constructs (SH) and non-operational states
 * (S0) never resolve to an operational rule - callers must check
 * `isOperational` before using `rule` for participant-facing content.
 */
async function resolveInterpretation(tx, { assessmentVersionId, domainCode, developmentalBand, evidenceState, locale = 'en' }) {
  const isOperational = OPERATIONAL_EVIDENCE_STATES.has(evidenceState);
  if (!isOperational) {
    return { isOperational: false, rule: null };
  }

  const { rows } = await tx.query(
    `SELECT * FROM interpretation_rules
     WHERE assessment_version_id = $1 AND domain_code = $2 AND developmental_band = $3 AND evidence_state = $4 AND locale = $5`,
    [assessmentVersionId, domainCode, developmentalBand, evidenceState, locale]
  );
  const rule = rows[0] || null;

  return { isOperational: !!rule, rule };
}

module.exports = { resolveInterpretation };
