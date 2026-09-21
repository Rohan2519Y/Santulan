/*
 * Submit -> quality -> score pipeline (BUILD 06 section 1), on the store. Picks SUBMITTED attempts one at a time, runs the Quality
 * Engine and, only for a CLEAR outcome, the scorer - all in ONE transaction per attempt. HOLD and INVALID outcomes are left exactly
 * as the engines set them. A failure aborts that attempt's transaction (it stays SUBMITTED and is retried on the next tick); one bad
 * attempt never blocks the others. Several workers converge safely (compare-and-set on the attempt; the unique score index is the
 * race guard). Idempotent: a second pass finds nothing left to do. Runs only when SCORING_PIPELINE=on.
 */
const { randomUUID } = require('crypto');
const config = require('../../config');
const store = require('../../modules/santulan/store');
const { qualityInTx, scoreInTx } = require('../../modules/santulan/scoring/scoreService');

const BATCH = 50;

/** @returns {Promise<{ processed: number, scored: number, held: number, invalid: number, failed: number }>} */
async function runOnce({ scoringVersion = config.scoringVersion, limit = BATCH } = {}) {
  const tally = { processed: 0, scored: 0, held: 0, invalid: 0, failed: 0 };
  const skip = [];
  for (let i = 0; i < limit; i += 1) {
    const correlationId = `pipeline-${randomUUID()}`;
    let current = null;
    try {
      const result = await store.withScope(store.systemScope(), async (tx) => {
        const [row] = await tx.c.assessment_attempts.find({ status: 'SUBMITTED', _id: { $nin: skip } }, { sort: { submitted_at: 1 }, limit: 1, projection: { _id: 1 } });
        if (!row) return null;
        current = row._id;
        const q = await qualityInTx(tx, current, correlationId);
        if (q.outcome === 'CLEAR') await scoreInTx(tx, current, scoringVersion, correlationId);
        return q.outcome;
      }, { transaction: true });
      if (result === null) break;
      tally.processed += 1;
      if (result === 'CLEAR') tally.scored += 1; else if (result === 'HOLD') tally.held += 1; else tally.invalid += 1;
    } catch (err) {
      tally.failed += 1;
      if (current) skip.push(current);
      console.error(`pipeline worker: attempt ${current || '?'} not processed (${err.code || err.message})`); // eslint-disable-line no-console
      if (!current) break;
    }
  }
  return tally;
}

/** Starts the periodic worker; returns the timer, or null unless SCORING_PIPELINE=on. */
function start({ enabled = config.scoringPipeline, intervalMs = 15000 } = {}) {
  if (!enabled) return null;
  const timer = setInterval(() => { runOnce().catch((err) => console.error('pipeline worker failed', err.message)); }, intervalMs); // eslint-disable-line no-console
  timer.unref();
  return timer;
}

module.exports = { runOnce, start };
