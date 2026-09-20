/*
 * Atomic, idempotent submission (BUILD 05 §8). santulan.submit_attempt locks the attempt, closes an active session,
 * sets SUBMITTED and records one SUBMIT event carrying the key. Delivery ends here: this service never invokes the
 * quality or scoring engines (those run downstream, from the internal endpoints).
 */
const { HttpError } = require('../../../shared/errors');
const { participantTx, readResumeModel } = require('./attemptService');
const { writeAudit } = require('../audit/auditService');

async function submitAttempt(participantId, attemptId, submissionKey, correlationId) {
  try {
    return await participantTx(participantId, async (tx) => {
      await tx.query('SELECT santulan.submit_attempt($1, $2)', [attemptId, submissionKey]);
      // Audit only when THIS transaction wrote the SUBMIT event; a safe replay (same key) or a concurrent duplicate that
      // waited on the attempt lock finds the earlier transaction's event and writes nothing new.
      const created = (await tx.query(
        `SELECT 1 FROM santulan.response_events WHERE attempt_id = $1 AND event_type = 'SUBMIT' AND xmin::text::bigint = (txid_current() % 4294967296)`, [attemptId])).rowCount > 0;
      if (created) {
        await writeAudit(tx, { actorType: 'PARTICIPANT', actorId: participantId, actionType: 'ATTEMPT_SUBMITTED', targetEntity: 'assessment_attempts', targetId: attemptId, newState: { status: 'SUBMITTED' }, correlationId });
      }
      const model = await readResumeModel(tx, attemptId);
      const row = (await tx.query('SELECT submitted_at FROM santulan.assessment_attempts WHERE attempt_id = $1', [attemptId])).rows[0];
      return { ...model, submittedAt: row.submittedAt };
    }, { write: true });
  } catch (err) {
    if (err.code === 'RESPONSE_KEY_CONFLICT') throw new HttpError(409, 'SUBMIT_KEY_CONFLICT', 'This attempt was already submitted with a different submission key');
    if (err && err.code === '23514') throw new HttpError(422, 'VALIDATION_ERROR', 'A submission key is required');
    throw err;
  }
}

module.exports = { submitAttempt };
