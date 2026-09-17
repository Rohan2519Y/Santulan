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

  const rule = await tx.interpretationRule.findUnique({
    where: {
      assessmentVersionId_domainCode_developmentalBand_evidenceState_locale: {
        assessmentVersionId,
        domainCode,
        developmentalBand,
        evidenceState,
        locale,
      },
    },
  });

  return { isOperational: !!rule, rule };
}

module.exports = { resolveInterpretation };
