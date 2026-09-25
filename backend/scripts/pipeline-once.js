#!/usr/bin/env node
/*
 * Runs the scoring pipeline and then the report worker once (npm run pipeline:once). Uses the least-privilege runtime credential
 * through the store, exactly like the API workers. Prints the tallies; exits non-zero when any attempt failed.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const pipeline = require('../src/jobs/workers/pipelineWorker');
const reports = require('../src/jobs/workers/reportWorker');
const store = require('../src/models/db');

async function main() {
  const scored = await pipeline.runOnce();
  const built = await reports.runOnce();
  console.log(`pipeline: ${JSON.stringify(scored)}`); // eslint-disable-line no-console
  console.log(`reports:  ${JSON.stringify(built)}`); // eslint-disable-line no-console
  if (scored.failed || built.errors) process.exitCode = 1;
}

main().catch((e) => { console.error(`pipeline-once: ${e.message}`); process.exitCode = 1; }).finally(() => store.closeClient()); // eslint-disable-line no-console
