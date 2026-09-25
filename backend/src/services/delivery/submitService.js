/*
 * Atomic, idempotent submission (BUILD 05 section 8), on the store. One transaction: read the attempt -> replay/conflict check on
 * the SUBMIT event -> close an active session -> SUBMITTED (compare-and-set) -> SUBMIT event carrying the key -> audit.
 * Delivery ends here: this service never invokes the quality or scoring engines (those run downstream, from the internal endpoints).
 */
const { HttpError } = require('../../errors');
const delivery = require('../../models/repositories/delivery');
const attemptRules = require('../domain/attemptRules');
const { participantTx, readResumeModel } = require('./attemptService');
const { writeAudit } = require('../audit/auditService');

async function submitOnce(participantId, attemptId, submissionKey, correlationId) {
  return participantTx(participantId, async (tx) => {
    const a = await delivery.getAttempt(tx, attemptId);
    if (!a) throw new HttpError(404, 'NOT_FOUND', 'Attempt not found');

    const existing = await delivery.findSubmitEvent(tx, attemptId);
    if (existing) {
      if (existing.metadata.idempotency_key !== submissionKey) throw new HttpError(409, 'SUBMIT_KEY_CONFLICT', 'This attempt was already submitted with a different submission key');
      const again = await readResumeModel(tx, attemptId); // safe retry: nothing new is written
      return { ...again, submittedAt: a.submittedAt };
    }

    const plan = attemptRules.planSubmit(a, submissionKey);
    if (!(await delivery.moveAttempt(tx, attemptId, plan.from, plan.patch))) throw attemptRules.invalidState('The attempt changed while submitting; try again');
    for (const e of plan.events) await delivery.appendEvent(tx, a, e);
    await writeAudit(tx, { actorType: 'PARTICIPANT', actorId: participantId, actionType: 'ATTEMPT_SUBMITTED', targetEntity: 'assessment_attempts', targetId: attemptId, newState: { status: 'SUBMITTED' }, correlationId });
    const model = await readResumeModel(tx, attemptId);
    return { ...model, submittedAt: plan.patch.submitted_at };
  }, { write: true });
}

async function submitAttempt(participantId, attemptId, submissionKey, correlationId) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await submitOnce(participantId, attemptId, submissionKey, correlationId);
    } catch (err) {
      // a concurrent duplicate submit lost the race on uq_submit_idempotency: re-read and replay (or report a real conflict)
      if (err.code === 'SUBMIT_KEY_CONFLICT' && err.cause && attempt < 3) continue;
      throw err;
    }
  }
  throw new HttpError(409, 'SUBMIT_KEY_CONFLICT', 'The attempt could not be submitted; try again');
}

module.exports = { submitAttempt };
