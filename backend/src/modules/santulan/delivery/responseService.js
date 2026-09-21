/*
 * Response saves (BUILD 05 sections 5-7), on the store. One transaction per save: idempotency check -> attempt and question
 * checks -> retire the previous current answer -> insert the next version -> RESPONSE_SAVED event -> mark activity.
 * `value` is the chosen option's POSITION. The client cannot send a score, a participant id or a version.
 */
const { HttpError } = require('../../../shared/errors');
const delivery = require('../store/repositories/delivery');
const responsesRepo = require('../store/repositories/responses');
const rules = require('../domain/responseRules');
const { participantTx } = require('./attemptService');

const MAX_ATTEMPTS = 4;

async function saveOnce(participantId, attemptId, input) {
  const { itemId, value, responseTimeMs, presentedOrder, idempotencyKey } = input;
  if (!idempotencyKey || !String(idempotencyKey).trim()) throw new HttpError(422, 'VALIDATION_ERROR', 'An idempotency key is required');
  return participantTx(participantId, async (tx) => {
    const attempt = await delivery.getAttempt(tx, attemptId);
    if (!attempt) throw new HttpError(404, 'NOT_FOUND', 'Attempt not found');

    // a key is a safe retry only when the whole payload matches
    const existing = await responsesRepo.findByKey(tx, attemptId, idempotencyKey);
    if (existing) {
      if (rules.samePayload(existing, { attemptId, itemId, value, responseTimeMs, presentedOrder })) return { responseId: existing._id };
      throw new HttpError(409, 'RESPONSE_KEY_CONFLICT', 'That idempotency key was already used with a different answer');
    }

    const item = await tx.c.items.findOne({ _id: itemId });
    rules.assertAnswerable(attempt, item, value);

    const current = await responsesRepo.currentFor(tx, attemptId, itemId);
    const next = rules.nextVersion(current);
    if (current && !(await responsesRepo.retireCurrent(tx, attemptId, current))) throw new HttpError(409, 'RESPONSE_KEY_CONFLICT', 'The answer changed while saving; try again');
    const saved = await responsesRepo.insertVersion(tx, {
      attemptId, itemId, value: rules.normalisePosition(value), version: next.response_version, supersedes: next.supersedes_response_id, responseTimeMs, presentedOrder, idempotencyKey,
    });
    await delivery.appendEvent(tx, attempt, {
      event_type: 'RESPONSE_SAVED', item_id: itemId, session_number: attempt.sessionCount || null, metadata: { response_id: saved._id, response_version: next.response_version },
    });
    await delivery.touchAttempt(tx, attemptId);
    return { responseId: saved._id };
  }, { write: true });
}

async function saveResponse(participantId, attemptId, input) {
  // A lost race on the same key or version resolves on the next pass: the winner's row is then visible and is either a safe
  // replay (same payload) or a genuine conflict.
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await saveOnce(participantId, attemptId, input);
    } catch (err) {
      if (err.code === 'RESPONSE_KEY_CONFLICT' && attempt < MAX_ATTEMPTS && err.cause && /uq_(responses_idempotency|response_version|current_response)/.test(err.cause.message || '')) continue;
      throw err;
    }
  }
  throw new HttpError(409, 'RESPONSE_KEY_CONFLICT', 'The answer could not be saved; try again');
}

module.exports = { saveResponse };
