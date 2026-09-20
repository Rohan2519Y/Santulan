/*
 * Submit -> quality -> score pipeline (BUILD 06 §1, tasks T098). Picks SUBMITTED attempts one at a time
 * (FOR UPDATE SKIP LOCKED, so several workers never process the same attempt), runs the Quality Engine and, only for a CLEAR
 * outcome, the scorer - all in ONE transaction per attempt. HOLD and INVALID outcomes are left exactly as the engines set them.
 * A failure rolls that attempt's transaction back (it stays SUBMITTED and is retried on the next tick); one bad attempt never
 * blocks the others. Idempotent: a second pass finds nothing left to do. Runs only when SCORING_PIPELINE=on.
 */
const { randomUUID } = require('crypto');
const config = require('../../config');
const { withSystemTx } = require('../../modules/santulan/context/canonicalTx');
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
      const result = await withSystemTx(async (tx) => {
        const row = (await tx.query(
          `SELECT attempt_id FROM santulan.assessment_attempts WHERE status = 'SUBMITTED' AND attempt_id <> ALL($1::uuid[])
            ORDER BY submitted_at LIMIT 1 FOR UPDATE SKIP LOCKED`, [skip])).rows[0];
        if (!row) return null;
        current = row.attemptId;
        const q = await qualityInTx(tx, row.attemptId, correlationId);
        if (q.outcome === 'CLEAR') await scoreInTx(tx, row.attemptId, scoringVersion, correlationId);
        return q.outcome;
      });
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
