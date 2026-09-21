/*
 * Multi-document transactions (constitution V): snapshot read concern, majority write concern, primary reads, retried on
 * TransientTransactionError / UnknownTransactionCommitResult within a bounded budget, then STORE_UNAVAILABLE.
 * transition() is the compare-and-set helper every state machine uses: a stale source state matches nothing.
 */
const { getClient } = require('./client');
const { mapStoreError, isTransient } = require('./errors');

const TX_OPTIONS = {
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority' },
  readPreference: 'primary',
  maxCommitTimeMS: 10000,
};
const MAX_ATTEMPTS = 5;

/** Runs fn(session) in a transaction. The whole callback is retried on transient errors, so it must be repeatable. */
async function withTransaction(fn) {
  const client = await getClient();
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const session = client.startSession();
    try {
      let result;
      await session.withTransaction(async () => { result = await fn(session); }, TX_OPTIONS);
      return result;
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || attempt === MAX_ATTEMPTS) break;
    } finally {
      await session.endSession();
    }
  }
  throw mapStoreError(lastErr);
}

/**
 * Compare-and-set: applies `patch` ($set) to the document only if it currently matches `from` (e.g. { status: 'PAUSED' }).
 * Returns true when exactly one document changed, false on a stale source state.
 */
async function transition(collection, id, from, patch, session, extra = {}) {
  const res = await collection.updateOne({ _id: id, ...from }, { $set: patch, ...extra }, session ? { session } : undefined);
  return res.modifiedCount === 1;
}

module.exports = { withTransaction, transition, TX_OPTIONS };
