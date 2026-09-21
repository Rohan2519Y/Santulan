/*
 * quality_flags repository. Detection facts (code, domain, severity, detected_at) are inserted once and never change; only the
 * review fields (disposition, reviewer, note) are updatable, through review(). A flag is unique per (attempt, domain, code)
 * (uq_quality_flag_logical), so raising an existing flag is a no-op.
 */
const { v4: uuidv4 } = require('uuid');
const { camel } = require('../naming');

const Q = (d) => camel(d, 'flagId');

async function flagsOf(tx, attemptId) {
  return (await tx.c.quality_flags.find({ attempt_id: attemptId }, { sort: { flag_code: 1, domain_code: 1 } })).map(Q);
}

async function hasFlag(tx, attemptId, codes) {
  return (await tx.c.quality_flags.count({ attempt_id: attemptId, flag_code: { $in: codes } })) > 0;
}

/** Raises a flag once. Returns true when this call created it. */
async function raiseFlag(tx, { attemptId, domainCode = null, flagCode, severity }) {
  const existing = await tx.c.quality_flags.count({ attempt_id: attemptId, domain_code: domainCode, flag_code: flagCode });
  if (existing) return false;
  await tx.c.quality_flags.insertOne({
    _id: uuidv4(), attempt_id: attemptId, domain_code: domainCode, flag_code: flagCode, severity, detected_at: new Date(),
    disposition: 'UNREVIEWED', reviewed_by: null, reviewed_at: null, review_note: null,
  });
  return true;
}

/** Records a review decision (the only permitted update). */
async function review(tx, flagId, { disposition, reviewedBy, note = null }) {
  const r = await tx.c.quality_flags.updateOne({ _id: flagId }, { $set: { disposition, reviewed_by: reviewedBy, reviewed_at: new Date(), review_note: note } });
  return r.modified === 1;
}

module.exports = { flagsOf, hasFlag, raiseFlag, review };
