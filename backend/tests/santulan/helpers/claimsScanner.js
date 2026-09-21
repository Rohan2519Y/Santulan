/*
 * G9 / SEC-25 claims scanner (BUILD 07 §8, BUILD 09). Scans participant-facing text - report snapshots, API JSON, export files - for
 * the claims the pilot may not make before their evidence gate: diagnosis or clinical inference, Low / Average / High bands,
 * percentile or norm lines, reliable-change or "improved" claims, subdomain scores and personality typing.
 *
 * It is deliberately literal and conservative: a hit is a defect to investigate, and the rule names are stable so the evidence
 * register can cite them. It scans strings; objects are stringified with their keys, so a field named "percentile" is caught too.
 */
const RULES = {
  DIAGNOSIS_OR_CLINICAL: /\b(diagnos\w*|clinical\w*|disorder|ADHD|depress\w*|anxiety|autis\w*|dyslex\w*|psychiatr\w*|pathology|medical)\b/i,
  INTELLIGENCE_INFERENCE: /\b(intelligen\w*|IQ|cognitive ability)\b/i,
  BAND_LABEL: /\b(low|average|high)\s+(score|capability|band|level|range|result|performer)s?\b|"(?:band|level|label|category)"\s*:\s*"(?:low|average|high)"/i,
  PERCENTILE_OR_NORM: /\b(percentile|norm[- ]referenced|normative|norms?|peer average|compared (?:to|with) (?:your )?(?:peers|others|classmates))\b/i,
  RELIABLE_CHANGE_OR_IMPROVEMENT: /\b(reliable[- ]change|reliably (?:improved|changed)|improved|improvement of|improved by|increased by \d)\b/i,
  SUBDOMAIN_SCORE: /\bC[1-7]\.\d{1,2}\b/,
  PERSONALITY_TYPING: /\b(personality|MBTI|introvert\w*|extrovert\w*|temperament)\b/i,
};

/** @returns {{ rule: string, match: string }[]} every violation found in the value (string or JSON-able). */
function scanClaims(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const found = [];
  for (const [rule, re] of Object.entries(RULES)) {
    const m = String(text).match(re);
    if (m) found.push({ rule, match: m[0] });
  }
  return found;
}

/** Throws with the rule names when the value carries a prohibited claim (for use inside expect()). */
function assertNoClaims(value, label = 'value') {
  const hits = scanClaims(value);
  if (hits.length) throw new Error(`${label} carries prohibited claims: ${hits.map((h) => `${h.rule} ("${h.match}")`).join(', ')}`);
}

module.exports = { scanClaims, assertNoClaims, RULES };
