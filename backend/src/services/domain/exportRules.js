/*
 * Research export rules (BUILD 08 section 10; feature 006 US5). The lifecycle, the filter whitelist, the fixed sheet names, the
 * spreadsheet-injection escape and the row partitioning. No file path ever leaves the server; an export is a row plus a protected file.
 *
 *   REQUESTED -> GENERATING -> READY | FAILED   (nothing else; READY and FAILED are final)
 */
const { HttpError } = require('../../errors');

const TRANSITIONS = { REQUESTED: ['GENERATING'], GENERATING: ['READY', 'FAILED'], READY: [], FAILED: [] };
const FILTER_KEYS = ['institutionId', 'cohortId', 'participantStatus', 'dateFrom', 'dateTo', 'includeAllVersions'];
const PARTICIPANT_STATUSES = ['ACTIVE', 'SUSPENDED', 'WITHDRAWN'];
const MAX_CELL = 32000; // Excel: 32,767 characters per cell; oversized metadata is truncated with a marker
const TRUNCATION_MARKER = ' ...[truncated]';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const FIXED_SHEETS_BEFORE = ['README', 'DATA_DICTIONARY', 'PARTICIPANTS', 'ATTEMPTS'];
const FIXED_SHEETS_AFTER = ['DOMAIN_SCORES', 'QUALITY_FLAGS', 'RESPONSE_EVENTS', 'ASSESSMENT_VERSION', 'COHORT_METADATA', 'EXPORT_METADATA'];
const responseSheetName = (n) => `ITEM_RESPONSES_${String(n).padStart(2, '0')}`;

const canMove = (from, to) => (TRANSITIONS[from] || []).includes(to);

/** Spreadsheet-injection guard: a text cell that a spreadsheet would read as a formula gets a leading apostrophe. */
function escapeCell(value) {
  if (typeof value !== 'string') return value;
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return text.length > MAX_CELL ? `${text.slice(0, MAX_CELL - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}` : text;
}

/**
 * Validates a request body: { sourceAssessmentVersionId, anonymisationVersion, filters?, includeAllVersions? }.
 * Unknown filter keys are a 422 EXPORT_FILTER_UNKNOWN; returns the normalised filters (includeAllVersions folded in).
 */
function normaliseRequest(body) {
  const filters = { ...(body.filters || {}) };
  const unknown = Object.keys(filters).filter((k) => !FILTER_KEYS.includes(k));
  if (unknown.length) throw new HttpError(422, 'EXPORT_FILTER_UNKNOWN', `Unknown filter: ${unknown.join(', ')}`);
  if (body.includeAllVersions !== undefined) filters.includeAllVersions = body.includeAllVersions;
  const bad = (m) => new HttpError(422, 'VALIDATION_ERROR', m);
  for (const key of ['institutionId', 'cohortId']) if (filters[key] !== undefined && !UUID.test(filters[key])) throw bad(`${key} must be an id`);
  if (filters.participantStatus !== undefined && !PARTICIPANT_STATUSES.includes(filters.participantStatus)) throw bad('participantStatus is not recognised');
  for (const key of ['dateFrom', 'dateTo']) if (filters[key] !== undefined && (!DATE.test(filters[key]) || Number.isNaN(Date.parse(filters[key])))) throw bad(`${key} must be a date (YYYY-MM-DD)`);
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) throw bad('dateFrom is after dateTo');
  if (filters.includeAllVersions !== undefined && typeof filters.includeAllVersions !== 'boolean') throw bad('includeAllVersions must be true or false');
  filters.includeAllVersions = filters.includeAllVersions === true;
  return filters;
}

/** The dataset kind stated in the status and in EXPORT_METADATA. */
const datasetOf = (filters) => (filters && filters.includeAllVersions ? 'all-versions' : 'current-only');

module.exports = {
  TRANSITIONS, FILTER_KEYS, MAX_CELL, TRUNCATION_MARKER, FIXED_SHEETS_BEFORE, FIXED_SHEETS_AFTER,
  canMove, escapeCell, normaliseRequest, datasetOf, responseSheetName,
};
