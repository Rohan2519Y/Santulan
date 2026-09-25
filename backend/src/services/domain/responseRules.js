/*
 * Response rules (BUILD 05 sections 5-7; data-model section 7). An answer is the chosen option's POSITION (as a string). Rules,
 * all applied inside the saving transaction:
 *   - the attempt is writable (STARTED / IN_PROGRESS);
 *   - the question belongs to the attempt's question set, and is CORE + ACTIVE;
 *   - the position is inside THAT question's options (OPTION_OUT_OF_RANGE otherwise);
 *   - versions are contiguous: the first is 1 and supersedes nothing, each revision supersedes the immediate prior;
 *   - an idempotency key is a safe retry only when the WHOLE payload matches.
 * Neither a score nor a participant id nor a version is ever accepted from the client.
 */
const { HttpError } = require('../../errors');
const attemptRules = require('./attemptRules');
const { isValidPosition } = require('./optionScale');

const normalisePosition = (value) => (/^[0-9]{1,2}$/.test(String(value)) ? String(Number(value)) : String(value));

/** A retry is safe only when attempt, question, value, time and order all match (B05-AUD-001). */
function samePayload(existing, { attemptId, itemId, value, responseTimeMs, presentedOrder }) {
  return existing.attempt_id === attemptId
    && existing.item_id === itemId
    && existing.response_value === normalisePosition(value)
    && (existing.response_time_ms === null ? null : existing.response_time_ms) === (responseTimeMs === undefined ? null : responseTimeMs)
    && (existing.presented_order === null ? null : existing.presented_order) === (presentedOrder === undefined ? null : presentedOrder);
}

/** Validates an answer against the attempt and the question. Throws a controlled HttpError; returns nothing. */
function assertAnswerable(attempt, item, value) {
  if (!attemptRules.WRITABLE.has(attempt.status)) throw attemptRules.locked(attempt.status);
  if (!item) throw new HttpError(422, 'VALIDATION_ERROR', 'The item does not exist');
  if (item.assessment_version_id !== attempt.assessmentVersionId) {
    throw new HttpError(409, 'VERSION_MISMATCH', 'The item belongs to another question set than this attempt');
  }
  if (item.layer !== 'CORE' || item.status !== 'ACTIVE') throw new HttpError(422, 'VALIDATION_ERROR', 'Only active core questions can be answered');
  if (!isValidPosition(value, item.options.length)) {
    throw new HttpError(422, 'OPTION_OUT_OF_RANGE', `Choose one of the ${item.options.length} options for this question`);
  }
}

/** The next version number and what it supersedes, from the current answer (or none). */
function nextVersion(current) {
  return current ? { response_version: current.response_version + 1, supersedes_response_id: current._id } : { response_version: 1, supersedes_response_id: null };
}

module.exports = { normalisePosition, samePayload, assertAnswerable, nextVersion };
