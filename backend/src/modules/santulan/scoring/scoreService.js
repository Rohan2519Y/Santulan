/*
 * Scoring service (BUILD 06 §14-§15). The only writer of score rows is santulan.score_attempt (server-only, quality-first,
 * one transaction). This service supplies the governed evidence states and shapes the responses; it never accepts a score
 * from a client and never creates a report, growth plan or pathway decision.
 */
const { HttpError } = require('../../../shared/errors');
const { withSystemTx, withCanonicalTx } = require('../context/canonicalTx');
const { writeAudit } = require('../audit/auditService');
const { statesFor, EvidenceConfigError } = require('./evidenceConfig');
const { runQuality } = require('../quality/qualityRunner');

/** Scores inside a caller-owned SYSTEM transaction (used by the pipeline worker and the internal route). */
async function scoreInTx(tx, attemptId, scoringVersion, correlationId) {
  const attempt = (await tx.query('SELECT assessment_version_id FROM santulan.assessment_attempts WHERE attempt_id = $1', [attemptId])).rows[0];
  if (!attempt) throw new HttpError(404, 'NOT_FOUND', 'Attempt not found');
  let evidence;
  try { evidence = statesFor(attempt.assessmentVersionId); } catch (err) {
    if (err instanceof EvidenceConfigError) throw new HttpError(503, 'INTERNAL_ERROR', 'The evidence configuration is invalid; nothing was scored');
    throw err;
  }
  const { rows } = await tx.query('SELECT santulan.score_attempt($1, $2, $3::jsonb) AS outcome', [attemptId, scoringVersion, JSON.stringify(evidence)]);
  const outcome = rows[0].outcome;
  if (outcome !== 'ALREADY_SCORED') {
    await writeAudit(tx, {
      actorType: 'SYSTEM', actionType: outcome === 'SCORED' ? 'ATTEMPT_SCORED' : 'ATTEMPT_INVALIDATED_Q06', targetEntity: 'assessment_attempts', targetId: attemptId,
      newState: { outcome, scoringVersion }, correlationId,
    });
  }
  return { attemptId, outcome, scoringVersion };
}

const scoreAttempt = (attemptId, scoringVersion, correlationId) => withSystemTx((tx) => scoreInTx(tx, attemptId, scoringVersion, correlationId));

/** Runs the Quality Engine inside a caller-owned SYSTEM transaction and audits a first-time outcome. */
async function qualityInTx(tx, attemptId, correlationId) {
  const result = await runQuality(tx, attemptId);
  if (!result.replay) {
    await writeAudit(tx, { actorType: 'SYSTEM', actionType: 'QUALITY_CHECK_COMPLETED', targetEntity: 'assessment_attempts', targetId: attemptId, newState: { outcome: result.outcome, policyVersion: result.policyVersion }, correlationId });
  }
  return { attemptId, outcome: result.outcome, policyVersion: result.policyVersion };
}

/** Runs the Quality Engine for one attempt (its own transaction). */
const runQualityCheck = (attemptId, correlationId) => withSystemTx((tx) => qualityInTx(tx, attemptId, correlationId));

/** Internal reviewer view of quality flags (Q09 details never reach participant surfaces). */
async function listQualityFlags(attemptId) {
  return withSystemTx(async (tx) => {
    const exists = (await tx.query('SELECT 1 FROM santulan.assessment_attempts WHERE attempt_id = $1', [attemptId])).rowCount;
    if (!exists) throw new HttpError(404, 'NOT_FOUND', 'Attempt not found');
    const { rows } = await tx.query('SELECT flag_code, domain_code, severity, detected_at, disposition FROM santulan.quality_flags WHERE attempt_id = $1 ORDER BY flag_code, domain_code NULLS FIRST', [attemptId]);
    return { attemptId, flags: rows.map((r) => ({ code: r.flagCode, domainCode: r.domainCode, severity: r.severity, detectedAt: r.detectedAt, disposition: r.disposition })) };
  });
}

/** The participant's own domain results - exactly what RLS lets through (S2+ only); never raw responses, flags or research data. */
async function getScores(participantId, attemptId) {
  return withCanonicalTx({ actorScope: 'PARTICIPANT', participantId }, async (tx) => {
    const attempt = (await tx.query('SELECT status FROM santulan.assessment_attempts WHERE attempt_id = $1', [attemptId])).rows[0];
    if (!attempt) throw new HttpError(404, 'NOT_FOUND', 'Attempt not found');
    const { rows } = await tx.query('SELECT domain_code, raw_score, completeness_rate, score_status FROM santulan.score_results WHERE attempt_id = $1 ORDER BY domain_code', [attemptId]);
    return {
      attemptId,
      scores: rows.map((r) => ({ domainCode: r.domainCode, score: r.rawScore === null ? null : Number(r.rawScore), completeness: Number(r.completenessRate), evidenceState: r.scoreStatus })),
    };
  });
}

module.exports = { scoreAttempt, scoreInTx, qualityInTx, runQualityCheck, listQualityFlags, getScores };
