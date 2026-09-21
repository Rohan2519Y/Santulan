/*
 * research_exports repository (privileged scopes only). A row is inserted once as REQUESTED; afterwards only status, file_reference and
 * completed_at change, by compare-and-set along REQUESTED -> GENERATING -> READY | FAILED. The store validator ties READY to a file
 * reference and FAILED to none, so a partial file can never be recorded as downloadable.
 */
const { v4: uuidv4 } = require('uuid');
const { camel } = require('../naming');

const X = (d) => camel(d, 'exportId');

async function getExport(tx, exportId) { return X(await tx.c.research_exports.findOne({ _id: exportId })); }

async function insertExport(tx, { id = uuidv4(), requestedBy, filters, anonymisationVersion, sourceAssessmentVersionId }) {
  const doc = {
    _id: id, requested_by: requestedBy, filters, anonymisation_version: anonymisationVersion, source_assessment_version_id: sourceAssessmentVersionId,
    created_at: new Date(), status: 'REQUESTED', file_reference: null, completed_at: null,
  };
  await tx.c.research_exports.insertOne(doc);
  return X(doc);
}

/** The oldest export still REQUESTED (the worker's queue), skipping ids already tried in this pass. */
async function nextRequested(tx, skip = []) {
  const [row] = await tx.c.research_exports.find({ status: 'REQUESTED', _id: { $nin: skip } }, { sort: { created_at: 1 }, limit: 1 });
  return X(row);
}

/** REQUESTED -> GENERATING; true for exactly one caller when two workers race. */
const claim = (tx, exportId) => tx.c.research_exports.transition(exportId, { status: 'REQUESTED' }, { status: 'GENERATING' });
/** GENERATING -> READY with the stored file's name (never a path). */
const markReady = (tx, exportId, fileReference) => tx.c.research_exports.transition(exportId, { status: 'GENERATING' }, { status: 'READY', file_reference: fileReference, completed_at: new Date() });
/** GENERATING -> FAILED (no file reference). */
const markFailed = (tx, exportId) => tx.c.research_exports.transition(exportId, { status: 'GENERATING' }, { status: 'FAILED', completed_at: new Date() });

async function listRecent(tx, limit = 50) {
  return (await tx.c.research_exports.find({}, { sort: { created_at: -1 }, limit })).map(X);
}

async function countByStatus(tx) {
  const rows = await tx.c.research_exports.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
  return Object.fromEntries(rows.map((r) => [r._id, r.n]));
}

module.exports = { getExport, insertExport, nextRequested, claim, markReady, markFailed, listRecent, countByStatus };
