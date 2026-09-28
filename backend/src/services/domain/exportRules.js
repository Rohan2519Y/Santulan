/*
 * Research export rules (BUILD 08 section 10; feature 006 US5). The lifecycle, the filter whitelist, the fixed sheet names, the
 * spreadsheet-injection escape and the row partitioning. No file path ever leaves the server; an export is a row plus a protected file.
 *
 *   REQUESTED -> GENERATING -> READY | FAILED   (nothing else; READY and FAILED are final)
 */
const { HttpError } = require('../../errors');

const TRANSITIONS = { REQUESTED: ['GENERATING'], GENERATING: ['READY', 'FAILED'], READY: [], FAILED: [] };
// includeAllVersions was withdrawn with the rebuilt workbook: ITEM_RESPONSES_LONG is always current-answer-only plus
// explicit missing rows (the sample's own design), which does not compose with "every saved version".
const FILTER_KEYS = ['institutionId', 'cohortId', 'participantStatus', 'dateFrom', 'dateTo'];
const PARTICIPANT_STATUSES = ['ACTIVE', 'SUSPENDED', 'WITHDRAWN'];
const MAX_CELL = 32000; // Excel: 32,767 characters per cell; oversized metadata is truncated with a marker
const TRUNCATION_MARKER = ' ...[truncated]';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Matches "Santulan Pilot - Sample Validation Data After Assessment Submission v1.0" exactly: nine sheets, no
// DATA_DICTIONARY/EXPORT_METADATA. Only the ONE track's wide sheet is ever written (see workbookWriter.js), so both
// are listed as OPTIONAL_AFTER rather than always-present.
const FIXED_SHEETS_BEFORE = ['README', 'PARTICIPANTS'];
const OPTIONAL_WIDE_SHEETS = ['VALIDATION_WIDE_ADO', 'VALIDATION_WIDE_EA'];
const FIXED_SHEETS_AFTER = ['QUALITY_REVIEW', 'ATTEMPT_SUMMARY', 'ITEM_CODEBOOK', 'RESEARCH_DASHBOARD'];
const responseSheetName = (n) => `ITEM_RESPONSES_LONG_${String(n).padStart(2, '0')}`;

const canMove = (from, to) => (TRANSITIONS[from] || []).includes(to);

/** Spreadsheet-injection guard: a text cell that a spreadsheet would read as a formula gets a leading apostrophe. */
function escapeCell(value) {
  if (typeof value !== 'string') return value;
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return text.length > MAX_CELL ? `${text.slice(0, MAX_CELL - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}` : text;
}

/**
 * Validates a request body: { sourceAssessmentVersionId, anonymisationVersion, filters? }.
 * Unknown filter keys are a 422 EXPORT_FILTER_UNKNOWN; returns the normalised filters.
 */
function normaliseRequest(body) {
  const filters = { ...(body.filters || {}) };
  const unknown = Object.keys(filters).filter((k) => !FILTER_KEYS.includes(k));
  if (unknown.length) throw new HttpError(422, 'EXPORT_FILTER_UNKNOWN', `Unknown filter: ${unknown.join(', ')}`);
  const bad = (m) => new HttpError(422, 'VALIDATION_ERROR', m);
  for (const key of ['institutionId', 'cohortId']) if (filters[key] !== undefined && !UUID.test(filters[key])) throw bad(`${key} must be an id`);
  if (filters.participantStatus !== undefined && !PARTICIPANT_STATUSES.includes(filters.participantStatus)) throw bad('participantStatus is not recognised');
  for (const key of ['dateFrom', 'dateTo']) if (filters[key] !== undefined && (!DATE.test(filters[key]) || Number.isNaN(Date.parse(filters[key])))) throw bad(`${key} must be a date (YYYY-MM-DD)`);
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) throw bad('dateFrom is after dateTo');
  return filters;
}

module.exports = {
  TRANSITIONS, FILTER_KEYS, MAX_CELL, TRUNCATION_MARKER, FIXED_SHEETS_BEFORE, FIXED_SHEETS_AFTER, OPTIONAL_WIDE_SHEETS,
  canMove, escapeCell, normaliseRequest, responseSheetName,
};
