/*
 * Report worker (BUILD 07 section 18), on the store. Finds attempts that need a report step - SCORED attempts without a finished
 * report and submitted QUALITY_HOLD / INVALID attempts that still need their terminal T11 / T12 report - and generates each report
 * in its own transactions (begin, render + complete, growth plan). Several workers converge safely (one report shell per attempt,
 * compare-and-set completion). A FAILED_RETRYABLE report is NOT retried here: a retry is a controlled, audited action
 * (POST /internal/reports/:id/retry). Idempotent, and runs only when REPORT_WORKER=on. Report generation never scores, retakes or
 * touches responses.
 */
const { randomUUID } = require('crypto');
const config = require('../../config');
const { generateReport, findAttemptsNeedingReport } = require('../../modules/santulan/reporting/reportService');

const BATCH = 50;

/** @returns {Promise<{ processed: number, ready: number, terminal: number, failed: number, errors: number }>} */
async function runOnce({ limit = BATCH, renderer } = {}) {
  const tally = { processed: 0, ready: 0, terminal: 0, failed: 0, errors: 0 };
  const skip = [];
  for (let i = 0; i < limit; i += 1) {
    const correlationId = `reports-${randomUUID()}`;
    let current = null;
    try {
      const [next] = await findAttemptsNeedingReport({ skip, limit: 1 });
      if (!next) break;
      current = next;
      skip.push(current);
      const result = await generateReport(current, { correlationId, renderer });
      tally.processed += 1;
      if (result.state === 'REPORT_READY') tally.ready += 1;
      else if (result.state === 'FAILED_RETRYABLE') tally.failed += 1;
      else tally.terminal += 1;
    } catch (err) {
      tally.errors += 1;
      console.error(`report worker: attempt ${current || '?'} not processed (${err.code || err.message})`); // eslint-disable-line no-console
      if (!current) break;
    }
  }
  return tally;
}

/** Starts the periodic worker; returns the timer, or null unless REPORT_WORKER=on. */
function start({ enabled = config.reportWorker, intervalMs = 15000 } = {}) {
  if (!enabled) return null;
  const timer = setInterval(() => { runOnce().catch((err) => console.error('report worker failed', err.message)); }, intervalMs); // eslint-disable-line no-console
  timer.unref();
  return timer;
}

module.exports = { runOnce, start };
