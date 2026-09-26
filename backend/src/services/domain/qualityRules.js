/*
 * Quality rules (BUILD 06 sections 9-11; contracts/scoring-and-report.md section 4). Runs BEFORE scoring, inside the caller's
 * SYSTEM transaction, and records exactly one QUALITY_CHECK_COMPLETED outcome per policy version:
 *
 *   Q06 version mismatch (deterministic)   -> INVALID   (hard scoring stop)
 *   Q09 safeguarding flag present          -> HOLD      (human path, never a score)
 *   approved detectors that flag           -> owned by the approved policy (none are implemented yet)
 *   otherwise                              -> CLEAR
 *
 * Q01-Q04 and Q08 are inert stubs: a policy that ENABLES one fails the run closed instead of clearing the attempt. Q05 stays
 * inactive (a second attempt is never labelled a duplicate). Q07 is raised by the scorer per incomplete domain. Flags never
 * rewrite responses, and Q09 is never derived from any score.
 */
const { HttpError } = require('../../errors');
const delivery = require('../../models/repositories/delivery');
const quality = require('../../models/repositories/quality');
const { DETECTORS } = require('../quality/detectors');
const { detectQ06, latestQualityOutcome } = require('./scoringRules');

async function runQuality(tx, attemptId, policy) {
  const attempt = await delivery.getAttempt(tx, attemptId);
  if (!attempt) throw new HttpError(404, 'NOT_FOUND', 'Attempt not found');
  if (!['SUBMITTED', 'QUALITY_HOLD'].includes(attempt.status)) {
    throw new HttpError(422, 'INVALID_STATE', `A quality check runs on a submitted attempt (attempt is ${attempt.status})`);
  }

  const previous = await latestQualityOutcome(tx, attemptId);
  if (previous && previous.policyVersion === policy.version) return { outcome: previous.outcome, policyVersion: policy.version, replay: true };

  // approved detectors: an enabled stub has no real implementation, so the run fails closed rather than clearing the attempt
  const raised = [];
  for (const [code, cfg] of Object.entries(policy.detectors || {})) {
    if (!cfg || cfg.enabled !== true) continue;
    const detector = DETECTORS[code];
    if (!detector || !detector.implemented) {
      throw new HttpError(503, 'INTERNAL_ERROR', `Detector ${code} is enabled in the policy but has no approved implementation; the attempt was not cleared`);
    }
    for (const f of await detector.run({ tx, attemptId, config: cfg })) {
      await quality.raiseFlag(tx, { attemptId, domainCode: f.domainCode || null, flagCode: code, severity: f.severity });
      raised.push(code);
    }
  }

  const current = await tx.c.responses.find({ attempt_id: attemptId, is_current: true });
  const q06 = await detectQ06(tx, attempt, current);
  const q09 = await quality.hasFlag(tx, attemptId, ['Q09']);
  const outcome = q06 ? 'INVALID' : (q09 ? 'HOLD' : 'CLEAR');

  await delivery.appendEvent(tx, attempt, { event_type: 'QUALITY_CHECK_COMPLETED', session_number: null, metadata: { outcome, policyVersion: policy.version } });
  if (outcome === 'INVALID') {
    await quality.raiseFlag(tx, { attemptId, domainCode: null, flagCode: 'Q06', severity: 'HIGH' });
    await delivery.moveAttempt(tx, attemptId, attempt.status, { status: 'INVALID' });
    raised.push('Q06');
  } else if (outcome === 'HOLD' && attempt.status === 'SUBMITTED') {
    // guarded by attempt.status: an attempt already in QUALITY_HOLD stays there on a re-run (e.g. a replayed check after
    // a new Q09 flag), so this never double-transitions or clobbers a state a human reviewer may have since moved on from
    await delivery.moveAttempt(tx, attemptId, 'SUBMITTED', { status: 'QUALITY_HOLD' });
  }
  return { outcome, policyVersion: policy.version, flags: raised, replay: false };
}

/**
 * Q09 (approved trigger source only): records a CRITICAL flag once and routes the attempt to QUALITY_HOLD. Returns
 * { created } so the caller fires the P5 hook and audit exactly once. Never derived from a score.
 */
async function raiseQ09(tx, attemptId) {
  const attempt = await delivery.getAttempt(tx, attemptId);
  if (!attempt) return { found: false, created: false };
  const created = await quality.raiseFlag(tx, { attemptId, domainCode: null, flagCode: 'Q09', severity: 'CRITICAL' });
  if (created && ['SUBMITTED', 'SCORING', 'SCORED'].includes(attempt.status)) await delivery.moveAttempt(tx, attemptId, attempt.status, { status: 'QUALITY_HOLD' });
  const after = await delivery.getAttempt(tx, attemptId);
  return { found: true, created, attemptStatus: after.status };
}

module.exports = { runQuality, raiseQ09 };
