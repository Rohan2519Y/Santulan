/* score_results repository (Tier A: insert only). Seven rows per attempt and scoring version, inserted in one transaction. */
const { v4: uuidv4 } = require('uuid');
const { camel } = require('../naming');

const S = (d) => camel(d, 'scoreId');

async function listForAttempt(tx, attemptId) {
  return (await tx.c.score_results.find({ attempt_id: attemptId }, { sort: { domain_code: 1 } })).map(S);
}

async function versionsOf(tx, attemptId) {
  const rows = await tx.c.score_results.find({ attempt_id: attemptId }, { projection: { scoring_version: 1 } });
  return [...new Set(rows.map((r) => r.scoring_version))];
}

/** rows: [{ domainCode, rawScore, completenessRate, eligibleItems, validItems, completenessStatus, scoreStatus }] */
async function insertSeven(tx, { attemptId, participantId, assessmentVersionId, scoringVersion, rows }) {
  const now = new Date();
  const docs = rows.map((r) => ({
    _id: uuidv4(), attempt_id: attemptId, participant_id: participantId, assessment_version_id: assessmentVersionId, domain_code: r.domainCode,
    raw_score: r.rawScore, completeness_rate: r.completenessRate, eligible_items: r.eligibleItems, valid_items: r.validItems,
    completeness_status: r.completenessStatus, score_status: r.scoreStatus, scoring_version: scoringVersion, calculated_at: now,
  }));
  await tx.c.score_results.insertMany(docs);
  return docs.map(S);
}

module.exports = { listForAttempt, versionsOf, insertSeven };
