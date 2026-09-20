/*
 * Quality Engine runner (BUILD 06 §9-§11, API "POST /internal/attempts/{id}/quality"). Runs BEFORE scoring, inside the
 * caller's SYSTEM transaction, and records exactly one QUALITY_CHECK_COMPLETED outcome per policy version:
 *
 *   Q06 version mismatch (deterministic, database)  -> INVALID   (hard scoring stop)
 *   Q09 safeguarding flag present                    -> HOLD      (human path, never a score)
 *   approved detectors that flag                     -> owned by the approved policy (none are implemented yet)
 *   otherwise                                        -> CLEAR
 *
 * Quality flags annotate or route an attempt; they never rewrite raw responses. The run is idempotent: a second call
 * with the same policy version returns the recorded outcome and writes nothing.
 */
const { HttpError } = require('../../../shared/errors');
const { loadPolicy } = require('./policyLoader');
const { DETECTORS } = require('./detectors');

async function latestOutcome(tx, attemptId) {
  const { rows } = await tx.query(
    `SELECT metadata FROM santulan.response_events WHERE attempt_id = $1 AND event_type = 'QUALITY_CHECK_COMPLETED'
      ORDER BY occurred_at DESC, event_id DESC LIMIT 1`, [attemptId]);
  return rows[0] ? rows[0].metadata : null;
}

async function record(tx, attemptId, outcome, policyVersion) {
  await tx.query(
    `INSERT INTO santulan.response_events (attempt_id, event_type, occurred_at, metadata) VALUES ($1, 'QUALITY_CHECK_COMPLETED', clock_timestamp(), $2::jsonb)`,
    [attemptId, JSON.stringify({ outcome, policyVersion })]);
}

async function runQuality(tx, attemptId) {
  const attempt = (await tx.query('SELECT attempt_id, status FROM santulan.assessment_attempts WHERE attempt_id = $1 FOR UPDATE', [attemptId])).rows[0];
  if (!attempt) throw new HttpError(404, 'NOT_FOUND', 'Attempt not found');
  if (!['SUBMITTED', 'QUALITY_HOLD'].includes(attempt.status)) {
    throw new HttpError(422, 'INVALID_STATE', `A quality check runs on a submitted attempt (attempt is ${attempt.status})`);
  }

  let policy;
  try { policy = loadPolicy(); } catch (err) { throw new HttpError(503, 'INTERNAL_ERROR', 'The quality policy is not readable; no outcome was recorded'); }

  const previous = await latestOutcome(tx, attemptId);
  if (previous && previous.policyVersion === policy.version) return { outcome: previous.outcome, policyVersion: policy.version, replay: true };

  // approved detectors: an enabled stub has no real implementation, so the run fails closed rather than clearing the attempt
  const raised = [];
  for (const [code, cfg] of Object.entries(policy.detectors)) {
    if (!cfg || cfg.enabled !== true) continue;
    const detector = DETECTORS[code];
    if (!detector || !detector.implemented) {
      throw new HttpError(503, 'INTERNAL_ERROR', `Detector ${code} is enabled in the policy but has no approved implementation; the attempt was not cleared`);
    }
    for (const f of await detector.run({ tx, attemptId, config: cfg })) {
      await tx.query(
        `INSERT INTO santulan.quality_flags (attempt_id, domain_code, flag_code, severity) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [attemptId, f.domainCode || null, code, f.severity]);
      raised.push(code);
    }
  }

  const q06 = (await tx.query('SELECT santulan.build06_detect_q06($1) AS q06', [attemptId])).rows[0].q06;
  const q09 = (await tx.query(`SELECT 1 FROM santulan.quality_flags WHERE attempt_id = $1 AND flag_code = 'Q09'`, [attemptId])).rowCount > 0;
  const outcome = q06 ? 'INVALID' : (q09 ? 'HOLD' : 'CLEAR');

  // the outcome is recorded while the attempt is still SUBMITTED (the event check requires it); the routing follows
  await record(tx, attemptId, outcome, policy.version);
  if (outcome === 'INVALID') {
    await tx.query('SELECT santulan.build06_apply_q06($1)', [attemptId]);          // Q06 flag (idempotent) + attempt INVALID
    raised.push('Q06');
  } else if (outcome === 'HOLD') {
    await tx.query(`UPDATE santulan.assessment_attempts SET status = 'QUALITY_HOLD' WHERE attempt_id = $1 AND status = 'SUBMITTED'`, [attemptId]);
  }
  return { outcome, policyVersion: policy.version, flags: raised, replay: false };
}

module.exports = { runQuality, latestOutcome };
