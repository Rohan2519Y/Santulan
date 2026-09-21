/*
 * Scoring service (BUILD 06 sections 14-15), on the store. The only writer of score rows is domain/scoringRules.scoreAttempt
 * (server-only, quality-first, one transaction). This service supplies the governed evidence configuration and the audited release
 * switches and shapes the responses; it never accepts a score from a client and never creates a report, growth plan or pathway
 * decision. The participant score endpoint of feature 005 is withdrawn: the chart is read from the released report (PROFILE).
 */
const { HttpError } = require('../../../shared/errors');
const store = require('../store');
const { writeAudit } = require('../audit/auditService');
const { statesFor, EvidenceConfigError } = require('./evidenceConfig');
const { loadPolicy } = require('../quality/policyLoader');
const scoringRules = require('../domain/scoringRules');
const qualityRules = require('../domain/qualityRules');
const releaseFlags = require('../domain/releaseFlags');
const qualityRepo = require('../store/repositories/quality');
const delivery = require('../store/repositories/delivery');

const inSystemTx = (fn) => store.withScope(store.systemScope(), fn, { transaction: true });

/** Scores inside a caller-owned SYSTEM transaction (used by the pipeline worker and the internal route). */
async function scoreInTx(tx, attemptId, scoringVersion, correlationId) {
  const attempt = await delivery.getAttempt(tx, attemptId);
  if (!attempt) throw new HttpError(404, 'NOT_FOUND', 'Attempt not found');
  let evidence;
  try { evidence = statesFor(attempt.assessmentVersionId); } catch (err) {
    if (err instanceof EvidenceConfigError) throw new HttpError(503, 'INTERNAL_ERROR', 'The evidence configuration is invalid; nothing was scored');
    throw err;
  }
  const switches = await releaseFlags.getSwitches(tx);
  const { outcome } = await scoringRules.scoreAttempt(tx, attemptId, scoringVersion, { evidence, switches });
  if (outcome !== 'ALREADY_SCORED') {
    await writeAudit(tx, {
      actorType: 'SYSTEM', actionType: outcome === 'SCORED' ? 'ATTEMPT_SCORED' : 'ATTEMPT_INVALIDATED_Q06', targetEntity: 'assessment_attempts', targetId: attemptId,
      newState: { outcome, scoringVersion }, correlationId,
    });
  }
  return { attemptId, outcome, scoringVersion };
}

const scoreAttempt = (attemptId, scoringVersion, correlationId) => inSystemTx((tx) => scoreInTx(tx, attemptId, scoringVersion, correlationId));

/** Runs the Quality Engine inside a caller-owned SYSTEM transaction and audits a first-time outcome. */
async function qualityInTx(tx, attemptId, correlationId) {
  let policy;
  try { policy = loadPolicy(); } catch (err) { throw new HttpError(503, 'INTERNAL_ERROR', 'The quality policy is not readable; no outcome was recorded'); }
  const result = await qualityRules.runQuality(tx, attemptId, policy);
  if (!result.replay) {
    await writeAudit(tx, { actorType: 'SYSTEM', actionType: 'QUALITY_CHECK_COMPLETED', targetEntity: 'assessment_attempts', targetId: attemptId, newState: { outcome: result.outcome, policyVersion: result.policyVersion }, correlationId });
  }
  return { attemptId, outcome: result.outcome, policyVersion: result.policyVersion };
}

/** Runs the Quality Engine for one attempt (its own transaction). */
const runQualityCheck = (attemptId, correlationId) => inSystemTx((tx) => qualityInTx(tx, attemptId, correlationId));

/** Internal reviewer view of quality flags (Q09 details never reach participant surfaces). */
async function listQualityFlags(attemptId) {
  return store.withScope(store.systemScope(), async (tx) => {
    if (!(await delivery.getAttempt(tx, attemptId))) throw new HttpError(404, 'NOT_FOUND', 'Attempt not found');
    const flags = await qualityRepo.flagsOf(tx, attemptId);
    return { attemptId, flags: flags.map((r) => ({ code: r.flagCode, domainCode: r.domainCode, severity: r.severity, detectedAt: r.detectedAt, disposition: r.disposition })) };
  });
}

module.exports = { scoreAttempt, scoreInTx, qualityInTx, runQualityCheck, listQualityFlags };
