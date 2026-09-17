const { HELD_DOMAINS } = require('../constants');

const SPEEDING_MS_THRESHOLD = 1000;
const LONG_LATENCY_MS_THRESHOLD = 120000;
const MISSINGNESS_CLUSTER_THRESHOLD = 0.6; // completeness_rate below this = "20-<40%+ missing" per ERD bands
const MISSINGNESS_CLUSTER_DOMAIN_COUNT = 2;

/**
 * Q01-Q09 detectors (ERD 10_Quality_and_Scoring). Recorded separately from
 * raw responses (FR-014) - detection never mutates a Response row. Q04
 * (rapid random switching), Q05 (duplicate participation) and Q08
 * (context/access concern) have no reliable pilot-CORE-layer signal and are
 * intentionally left as defined-but-never-auto-triggered flag codes (manual/
 * admin review only) rather than inventing an unvalidated heuristic.
 *
 * Q09 (safeguarding trigger) is likewise never auto-detected here: the pilot
 * CORE item layer carries no item-level safeguarding-trigger marker (that
 * lives in the V/SJT/O layers per docs/*_TECH_READY.xlsx 00_ReadMe, not active
 * in this pilot) - inventing a response-value heuristic for a safeguarding
 * signal without a specified clinical basis would be worse than not flagging.
 * The QUALITY_HOLD routing this flag drives (FR-014) is fully wired for when
 * that item-level marker exists.
 */
function detectQualityFlags({ responses, scoreResults }) {
  const flags = [];

  if (responses.length >= 10) {
    const distinctValues = new Set(responses.map((r) => r.responseValue));
    if (distinctValues.size === 1) {
      flags.push({ flagCode: 'Q01', domainCode: null, severity: 'review' }); // Straightlining
    }
  }

  const timed = responses.filter((r) => typeof r.responseTimeMs === 'number');
  if (timed.length > 0) {
    const avgMs = timed.reduce((sum, r) => sum + r.responseTimeMs, 0) / timed.length;
    if (avgMs < SPEEDING_MS_THRESHOLD) {
      flags.push({ flagCode: 'Q02', domainCode: null, severity: 'review' }); // Speeding
    }
    if (timed.some((r) => r.responseTimeMs > LONG_LATENCY_MS_THRESHOLD)) {
      flags.push({ flagCode: 'Q03', domainCode: null, severity: 'info' }); // Long latency
    }
  }

  const clusteredDomains = scoreResults.filter(
    (s) => !HELD_DOMAINS.includes(s.domainCode) && Number(s.completenessRate) < MISSINGNESS_CLUSTER_THRESHOLD
  );
  if (clusteredDomains.length >= MISSINGNESS_CLUSTER_DOMAIN_COUNT) {
    flags.push({ flagCode: 'Q07', domainCode: null, severity: 'review' }); // Missingness cluster
  }

  return flags;
}

async function recordQualityFlags(tx, attemptId, flags) {
  if (flags.length === 0) return [];
  await tx.qualityFlag.createMany({
    data: flags.map((f) => ({ attemptId, domainCode: f.domainCode, flagCode: f.flagCode, severity: f.severity })),
  });
  return tx.qualityFlag.findMany({ where: { attemptId } });
}

module.exports = { detectQualityFlags, recordQualityFlags };
