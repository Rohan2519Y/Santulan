const app = require('./app');
const config = require('./config');
const store = require('./models/db');
const { verifyOpenSets } = require('./services/questionsets/verifyFrozenSets');
const inactivityWorker = require('./jobs/workers/inactivityWorker');
const pipelineWorker = require('./jobs/workers/pipelineWorker');
const reportWorker = require('./jobs/workers/reportWorker');
const exportWorker = require('./jobs/workers/exportWorker');

async function main() {
  // Fail closed (G-17): refuse to serve unless the store is the replica set, we are the runtime user and the model matches.
  try {
    const ready = await store.assertStoreReady();
    console.log(`Data store ready: ${ready.user} on replica set ${ready.replicaSet}, data model ${ready.dataModelVersion}`); // eslint-disable-line no-console
  } catch (err) {
    console.error(`Refusing to start: ${err.message}`); // eslint-disable-line no-console
    process.exit(1);
  }

  // A frozen set whose questions no longer match its fingerprint is a hard stop for that set (attempts on it get 503).
  const drifted = await verifyOpenSets().catch((e) => { console.error(`Could not verify open question sets: ${e.message}`); return []; }); // eslint-disable-line no-console
  if (drifted.length) console.error(`QUARANTINED question sets (fingerprint mismatch): ${drifted.join(', ')}`); // eslint-disable-line no-console

  app.listen(config.port, () => {
    console.log(`Santulan backend listening on port ${config.port}`); // eslint-disable-line no-console
    // Disabled unless SESSION_INACTIVITY_MINUTES is set (the duration is an unfrozen decision; nothing is invented).
    if (inactivityWorker.start()) console.log(`Inactivity worker on: ${config.sessionInactivityMinutes} minute timeout`); // eslint-disable-line no-console
    // Off unless SCORING_PIPELINE=on: quality-checks and scores SUBMITTED attempts (scoring version ${config.scoringVersion}).
    if (pipelineWorker.start()) console.log(`Scoring pipeline on (scoring version ${config.scoringVersion})`); // eslint-disable-line no-console
    // Off unless REPORT_WORKER=on: builds reports for SCORED attempts and the T11 / T12 states of held / invalid ones.
    if (reportWorker.start()) console.log(`Report worker on (report version ${config.reportVersion})`); // eslint-disable-line no-console
    // Off unless EXPORT_WORKER=on: generates requested research exports into EXPORT_DIR.
    if (exportWorker.start()) console.log('Research export worker on'); // eslint-disable-line no-console
  });
}

main();
