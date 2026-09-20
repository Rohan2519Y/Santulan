/*
 * Response saves (BUILD 05 §5-§7). A thin, safe wrapper over santulan.save_response: the database owns versioning,
 * idempotency (payload-bound, advisory-locked), the frozen-scale / CORE / same-version checks and immutability. The
 * client cannot send a score, a participant id or a version; the participant comes from the token.
 */
const { HttpError } = require('../../../shared/errors');
const { participantTx } = require('./attemptService');

/** Constraint / reference failures from the procedure become controlled 422s (their messages are our own, PII-free). */
function mapSaveError(err) {
  if (err && err.code === '23503') return new HttpError(422, 'VALIDATION_ERROR', 'The item does not exist');
  if (err && err.code === '23514') return new HttpError(422, 'VALIDATION_ERROR', String(err.message || '').replace(/^error: /i, ''));
  return err;
}

async function saveResponse(participantId, attemptId, { itemId, value, responseTimeMs = null, presentedOrder = null, idempotencyKey }) {
  try {
    return await participantTx(participantId, async (tx) => {
      const { rows } = await tx.query('SELECT santulan.save_response($1, $2, $3, $4, $5, $6) AS response_id',
        [attemptId, itemId, value, responseTimeMs, presentedOrder, idempotencyKey]);
      return { responseId: rows[0].responseId };
    }, { write: true });
  } catch (err) {
    throw mapSaveError(err);
  }
}

module.exports = { saveResponse };
