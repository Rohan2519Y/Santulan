const app = require('./app');
const config = require('./config');
const inactivityWorker = require('./jobs/workers/inactivityWorker');
const pipelineWorker = require('./jobs/workers/pipelineWorker');

app.listen(config.port, () => {
  console.log(`Santulan backend listening on port ${config.port}`); // eslint-disable-line no-console
  // Disabled unless SESSION_INACTIVITY_MINUTES is set (the duration is an unfrozen decision; nothing is invented).
  if (inactivityWorker.start()) console.log(`Inactivity worker on: ${config.sessionInactivityMinutes} minute timeout`); // eslint-disable-line no-console
  // Off unless SCORING_PIPELINE=on: quality-checks and scores SUBMITTED attempts (scoring version ${config.scoringVersion}).
  if (pipelineWorker.start()) console.log(`Scoring pipeline on (scoring version ${config.scoringVersion})`); // eslint-disable-line no-console
});
