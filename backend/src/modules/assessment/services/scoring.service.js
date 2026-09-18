const { randomUUID } = require('crypto');
const { getEligibleItemsGroupedByDomain } = require('./eligibility.service');
const { HELD_DOMAINS } = require('../constants');

/**
 * Missingness -> reportability mapping (ERD 10_Quality_and_Scoring):
 * 0% missing = Complete (S2, the best pilot-era state); >0-<20% = Complete
 * with missing (S1, provisional but still reportable - "S1/S2 are the normal
 * pilot states"); >=20% missing = not reportable this attempt (S0). A held
 * domain (HELD_DOMAINS) is always SH regardless of completeness.
 */
function deriveScoreStatus(domainCode, completenessRate) {
  if (HELD_DOMAINS.includes(domainCode)) return 'SH';
  if (completenessRate === 1) return 'S2';
  if (completenessRate >= 0.8) return 'S1';
  return 'S0';
}

/**
 * FR-008/009: server-side only, deterministic. Per domain: mean of valid
 * 1.00-5.00 responses, valid_response_count, eligible_item_count,
 * completeness_rate, score_status. One ScoreResult per (attempt, domain).
 * Must run inside the submit transaction (`tx`).
 */
async function scoreAttempt(tx, attempt, participantProfile) {
  const sections = await getEligibleItemsGroupedByDomain(attempt.assessmentVersionId, participantProfile);
  const { rows: currentResponses } = await tx.query('SELECT * FROM responses WHERE attempt_id = $1 AND is_current = true', [attempt.id]);
  const responseByItemId = new Map(currentResponses.map((r) => [r.itemId, r]));

  const results = [];
  for (const section of sections) {
    const eligibleItemIds = section.items.map((i) => i.id);
    const validResponses = eligibleItemIds.map((id) => responseByItemId.get(id)).filter(Boolean);
    const validCount = validResponses.length;
    const eligibleCount = eligibleItemIds.length;
    const completenessRate = eligibleCount > 0 ? validCount / eligibleCount : 0;
    const rawScore = validCount > 0 ? validResponses.reduce((sum, r) => sum + r.responseValue, 0) / validCount : 1;
    const scoreStatus = deriveScoreStatus(section.domainCode, completenessRate);

    // FR-015: write-once - scoreAttempt only ever runs inside the one-time
    // submit transaction (re-submitting an already-scored attempt is rejected
    // by submit.service's state check), so a plain INSERT is correct; no
    // update path exists for a ScoreResult once written.
    // eslint-disable-next-line no-await-in-loop
    const { rows } = await tx.query(
      `INSERT INTO score_results
         (id, attempt_id, participant_profile_id, domain_code, raw_score, valid_response_count, eligible_item_count, completeness_rate, score_status, scoring_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        randomUUID(),
        attempt.id,
        participantProfile.id,
        section.domainCode,
        rawScore.toFixed(2),
        validCount,
        eligibleCount,
        completenessRate.toFixed(3),
        scoreStatus,
        attempt.scoringVersion,
      ]
    );
    results.push({ ...rows[0], domainName: section.domainName });
  }
  return results;
}

module.exports = { scoreAttempt, deriveScoreStatus };
