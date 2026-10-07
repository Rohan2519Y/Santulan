/*
 * reports and report_sections. A report row moves only by compare-and-set (generation_status, retry_count, generated_at, error
 * fields, content_hash); its sections are inserted once, while the report is PENDING (or as the single T11 / T12 section of a
 * terminal report), and only is_released_to_participant may ever change afterwards (the access layer has no other update path).
 */
const { v4: uuidv4 } = require('uuid');
const { camel } = require('../db/naming');

const R = (d) => camel(d, 'reportId');
const SEC = (d) => camel(d, 'sectionId');

async function getReport(tx, reportId) { return R(await tx.c.reports.findOne({ _id: reportId })); }

async function getByAttempt(tx, attemptId) { return R(await tx.c.reports.findOne({ attempt_id: attemptId })); }

/** Inserts a report shell. `contentHash` must be set for a terminal state and null otherwise (store validator). */
async function insertReport(tx, { participantId, attemptId, reportVersion, reportType, status, generatedAt = null, contentHash = null }) {
  const doc = {
    _id: uuidv4(), participant_id: participantId, attempt_id: attemptId, report_version: reportVersion, report_type: reportType,
    generation_status: status, retry_count: 0, generated_at: generatedAt, last_error_code: null, last_error_at: null, content_hash: contentHash, created_at: new Date(),
  };
  await tx.c.reports.insertOne(doc);
  return R(doc);
}

/** Compare-and-set on generation_status; `extra` may carry `$inc`. Returns true when it applied. */
async function moveReport(tx, reportId, from, patch, extra = {}) {
  return tx.c.reports.transition(reportId, { generation_status: from }, patch, extra);
}

async function insertSections(tx, reportId, sections) {
  const now = new Date();
  const docs = sections.map((s) => ({
    _id: uuidv4(), report_id: reportId, section_type: s.sectionType, is_released_to_participant: !!s.released, domain_code: s.domainCode || null,
    content_version: s.contentVersion, locale: s.locale, display_order: s.displayOrder, content_snapshot: s.contentSnapshot, created_at: now,
  }));
  if (docs.length) await tx.c.report_sections.insertMany(docs);
  return docs.map(SEC);
}

async function sectionsOf(tx, reportId) {
  return (await tx.c.report_sections.find({ report_id: reportId }, { sort: { display_order: 1 } })).map(SEC);
}

/**
 * Sets is_released_to_participant on every section of a report that is not already at `value` (the one field the access layer lets
 * change after insert). One section at a time: the data layer has no multi-document update, and a report has a few dozen sections at most.
 * Returns how many sections changed.
 */
async function setSectionsReleased(tx, reportId, value) {
  const sections = await tx.c.report_sections.find({ report_id: reportId, is_released_to_participant: !value });
  let changed = 0;
  for (const s of sections) {
    const r = await tx.c.report_sections.updateOne({ _id: s._id }, { $set: { is_released_to_participant: value } });
    changed += r.modified;
  }
  return changed;
}

async function sectionCount(tx, reportId) { return tx.c.report_sections.count({ report_id: reportId }); }

module.exports = { getReport, getByAttempt, insertReport, moveReport, insertSections, sectionsOf, setSectionsReleased, sectionCount, fromReport: R, fromSection: SEC };
