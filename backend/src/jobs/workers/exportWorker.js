/*
 * Research export worker (BUILD 08 section 10): picks REQUESTED exports one at a time, claims each by compare-and-set
 * (REQUESTED -> GENERATING; two workers claim once), streams the workbook, moves it into protected storage and marks it READY - or
 * deletes the partial file and marks it FAILED. Idempotent; runs only when EXPORT_WORKER=on.
 */
const { randomUUID } = require('crypto');
const config = require('../../config');
const { claimAndGenerate, nextRequested } = require('../../modules/santulan/research/exportService');

const BATCH = 10;

/** @returns {Promise<{ processed: number, ready: number, failed: number, lost: number }>} */
async function runOnce({ limit = BATCH } = {}) {
  const tally = { processed: 0, ready: 0, failed: 0, lost: 0 };
  const skip = [];
  for (let i = 0; i < limit; i += 1) {
    const next = await nextRequested(skip);
    if (!next) break;
    skip.push(next.exportId);
    const result = await claimAndGenerate(next.exportId, { correlationId: `export-${randomUUID()}` });
    if (!result) { tally.lost += 1; continue; } // another worker claimed it
    tally.processed += 1;
    if (result.status === 'READY') tally.ready += 1; else tally.failed += 1;
  }
  return tally;
}

/** Starts the periodic worker; returns the timer, or null unless EXPORT_WORKER=on. */
function start({ enabled = config.exportWorker, intervalMs = 15000 } = {}) {
  if (!enabled) return null;
  const timer = setInterval(() => { runOnce().catch((err) => console.error('export worker failed', err.message)); }, intervalMs); // eslint-disable-line no-console
  timer.unref();
  return timer;
}

module.exports = { runOnce, start };
