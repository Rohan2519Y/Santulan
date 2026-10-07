const app = require('./app');
const config = require('./config');
const { assertSafeConfig } = require('./config/startupChecks');
const logger = require('./utils/logger');
const store = require('./models/db');
const { verifyOpenSets } = require('./services/questionsets/verifyFrozenSets');
const inactivityWorker = require('./jobs/workers/inactivityWorker');
const pipelineWorker = require('./jobs/workers/pipelineWorker');
const reportWorker = require('./jobs/workers/reportWorker');
const exportWorker = require('./jobs/workers/exportWorker');

async function main() {
  // Fail closed (G-14): the shipped defaults (assumed APP_ENV, placeholder JWT secret, empty internal key) must not run a deployment.
  try {
    assertSafeConfig(process.env, config).forEach((w) => logger.warn(w));
  } catch (err) {
    logger.error(err.message);
    process.exit(1);
  }

  // Fail closed (G-17): refuse to serve unless the store is the replica set, we are the runtime user and the model matches.
  try {
    const ready = await store.assertStoreReady();
    logger.info({ user: ready.user, replicaSet: ready.replicaSet, dataModelVersion: ready.dataModelVersion }, 'Data store ready');
  } catch (err) {
    logger.error({ err }, 'Refusing to start');
    process.exit(1);
  }

  // A frozen set whose questions no longer match its fingerprint is a hard stop for that set (attempts on it get 503).
  const drifted = await verifyOpenSets().catch((e) => { logger.error({ err: e }, 'Could not verify open question sets'); return []; });
  if (drifted.length) logger.error({ drifted }, 'QUARANTINED question sets (fingerprint mismatch)');

  app.listen(config.port, () => {
    logger.info({ port: config.port }, 'Santulan backend listening');
    // Disabled unless SESSION_INACTIVITY_MINUTES is set (the duration is an unfrozen decision; nothing is invented).
    if (inactivityWorker.start()) logger.info({ minutes: config.sessionInactivityMinutes }, 'Inactivity worker on');
    // Off unless SCORING_PIPELINE=on: quality-checks and scores SUBMITTED attempts (scoring version ${config.scoringVersion}).
    if (pipelineWorker.start()) logger.info({ scoringVersion: config.scoringVersion }, 'Scoring pipeline on');
    // Off unless REPORT_WORKER=on: builds reports for SCORED attempts and the T11 / T12 states of held / invalid ones.
    if (reportWorker.start()) logger.info({ reportVersion: config.reportVersion }, 'Report worker on');
    // Off unless EXPORT_WORKER=on: generates requested research exports into EXPORT_DIR.
    if (exportWorker.start()) logger.info('Research export worker on');
  });
}

main();
