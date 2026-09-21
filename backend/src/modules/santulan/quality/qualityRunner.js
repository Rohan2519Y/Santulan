/*
 * Quality Engine runner. The rules live in domain/qualityRules.js; this module only loads the governed policy and keeps the
 * historical entry point (used by the pipeline worker and the internal route).
 */
const { HttpError } = require('../../../shared/errors');
const { loadPolicy } = require('./policyLoader');
const { runQuality: run } = require('../domain/qualityRules');
const { latestQualityOutcome } = require('../domain/scoringRules');

async function runQuality(tx, attemptId) {
  let policy;
  try { policy = loadPolicy(); } catch (err) { throw new HttpError(503, 'INTERNAL_ERROR', 'The quality policy is not readable; no outcome was recorded'); }
  return run(tx, attemptId, policy);
}

module.exports = { runQuality, latestOutcome: latestQualityOutcome };
