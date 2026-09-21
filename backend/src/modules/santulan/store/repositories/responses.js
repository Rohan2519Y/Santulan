/*
 * responses repository. A saved answer is never edited: a revision INSERTS a new version and retires only the prior
 * `is_current` flag. retireCurrent is therefore the ONLY update this repository (and the application) makes to `responses`
 * (D-M02; the repository scan test enforces it). Everything else is find / insert.
 */
const { v4: uuidv4 } = require('uuid');

/**
 * The answer saved under this key for THIS attempt, if any. The key is unique across the collection (uq_responses_idempotency), so
 * the same key used for a different attempt is refused by the store on insert (RESPONSE_KEY_CONFLICT).
 */
async function findByKey(tx, attemptId, idempotencyKey) {
  return tx.c.responses.findOne({ attempt_id: attemptId, idempotency_key: idempotencyKey });
}

async function currentFor(tx, attemptId, itemId) {
  return tx.c.responses.findOne({ attempt_id: attemptId, item_id: itemId, is_current: true });
}

async function currentByAttempt(tx, attemptId) {
  return tx.c.responses.find({ attempt_id: attemptId, is_current: true });
}

async function countCurrent(tx, attemptId) {
  return tx.c.responses.count({ attempt_id: attemptId, is_current: true });
}

/** Inserts the next version as the CURRENT answer. */
async function insertVersion(tx, { attemptId, itemId, value, version, supersedes, responseTimeMs, presentedOrder, idempotencyKey }) {
  const doc = {
    _id: uuidv4(), attempt_id: attemptId, item_id: itemId, response_value: value, response_version: version, is_current: true,
    supersedes_response_id: supersedes, response_time_ms: responseTimeMs === undefined ? null : responseTimeMs,
    presented_order: presentedOrder === undefined ? null : presentedOrder, answered_at: new Date(), idempotency_key: idempotencyKey,
  };
  await tx.c.responses.insertOne(doc);
  return doc;
}

/** The single permitted update: clears is_current on the superseded version (compare-and-set on is_current). */
async function retireCurrent(tx, attemptId, response) {
  const r = await tx.c.responses.updateOne({ _id: response._id, attempt_id: attemptId, is_current: true }, { $set: { is_current: false } });
  return r.modified === 1;
}

module.exports = { findByKey, currentFor, currentByAttempt, countCurrent, insertVersion, retireCurrent };
