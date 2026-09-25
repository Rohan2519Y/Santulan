/*
 * Streaming research workbook writer (BUILD 08 section 10; feature 006 US5). Writes a real .xlsx with exceljs' streaming
 * WorkbookWriter: rows go to disk as they are read from the research views (server-side cursors), so memory stays flat however many
 * rows there are. The sheet layout is fixed:
 *
 *   README, DATA_DICTIONARY, PARTICIPANTS, ATTEMPTS, ITEM_RESPONSES_01..N, DOMAIN_SCORES, QUALITY_FLAGS, RESPONSE_EVENTS,
 *   ASSESSMENT_VERSION, COHORT_METADATA, EXPORT_METADATA
 *
 * ITEM_RESPONSES_nn sheets are opened dynamically: a sheet holds at most 1,048,575 data rows (Excel's 1,048,576 including the header).
 * Text cells that a spreadsheet would read as formulas are escaped; oversized metadata is truncated with a marker. Direct-identity columns
 * are stripped by researchIdentity, whatever the view emits.
 */
const fs = require('fs');
const ExcelJS = require('exceljs');
const { MAX_ROWS } = require('./partition');
const { escapeCell, responseSheetName } = require('../domain/exportRules');
const identity = require('./researchIdentity');

const FILTER_COLUMNS = ['institution_id', 'cohort_id', 'participant_status'];

/** Column lists per sheet: the header row and the DATA_DICTIONARY come from the same table, so they cannot disagree. */
const SHEETS = {
  PARTICIPANTS: { view: 'v_research_participants', columns: {
    santulan_id: 'Opaque participant identifier (the only identity in this file)', participation_route: 'OPEN or INSTITUTIONAL', assessment_track: 'ADOLESCENT or EMERGING_ADULT',
    developmental_band: 'D1 to D4 from age at registration', institution_id: 'Institution (blank for OPEN participants)', institution_code: 'Institution code', cohort_id: 'Cohort',
    cohort_code: 'Cohort code', education_stage: 'Cohort education stage', participant_status: 'ACTIVE or SUSPENDED (WITHDRAWN participants are excluded)', created_at: 'Registration time (UTC)',
  } },
  ATTEMPTS: { view: 'v_research_attempts', columns: {
    attempt_id: 'Attempt identifier', santulan_id: 'Participant', version_label: 'Question set label', status: 'Attempt status', session_count: 'Sessions used (of 4)',
    created_at: 'Created (UTC)', started_at: 'First session started (UTC)', submitted_at: 'Submitted (UTC)', completed_at: 'Completed (UTC)',
    institution_id: 'Institution', cohort_id: 'Cohort', participant_status: 'Participant status',
  } },
  ITEM_RESPONSES: { view: 'v_research_item_responses', columns: {
    response_id: 'Answer row identifier', attempt_id: 'Attempt', santulan_id: 'Participant', item_code: 'Question code', response_value: 'Chosen option position (1 = first option)',
    option_count: 'Number of options the question had', response_version: 'Version of this answer (1 = first)', is_current: 'True for the answer that counts', response_time_ms: 'Time taken (ms)',
    presented_order: 'Position the question was shown in', answered_at: 'Answered (UTC)', institution_id: 'Institution', cohort_id: 'Cohort', participant_status: 'Participant status',
  } },
  DOMAIN_SCORES: { view: 'v_research_domain_scores', columns: {
    attempt_id: 'Attempt', santulan_id: 'Participant', domain_code: 'Domain C1 to C7', raw_score: 'Domain mean, 1.00 to 5.00 (blank when INSUFFICIENT)', eligible_items: 'Questions eligible for the domain',
    valid_items: 'Questions with a valid current answer', completeness_rate: 'valid_items / eligible_items', completeness_status: 'COMPLETE, COMPLETE_WITH_MISSING, INCOMPLETE or INSUFFICIENT',
    score_status: 'Evidence state of the result', scoring_version: 'Scoring version', calculated_at: 'Calculated (UTC)', institution_id: 'Institution', cohort_id: 'Cohort', participant_status: 'Participant status',
  } },
  QUALITY_FLAGS: { view: 'v_research_quality_flags', columns: {
    attempt_id: 'Attempt', santulan_id: 'Participant', domain_code: 'Domain (blank for attempt-level flags)', flag_code: 'Quality flag code (safeguarding flags never appear)', severity: 'Severity',
    detected_at: 'Detected (UTC)', disposition: 'Review disposition', reviewed_at: 'Reviewed (UTC)', institution_id: 'Institution', cohort_id: 'Cohort', participant_status: 'Participant status',
  } },
  RESPONSE_EVENTS: { view: 'v_research_response_events', columns: {
    event_id: 'Event identifier', attempt_id: 'Attempt', santulan_id: 'Participant', event_type: 'Event type', session_number: 'Session number', occurred_at: 'Occurred (UTC)',
    metadata: 'Event metadata (JSON text)', institution_id: 'Institution', cohort_id: 'Cohort', participant_status: 'Participant status',
  } },
  ASSESSMENT_VERSION: { view: 'v_research_assessment_versions', columns: {
    assessment_version_id: 'Question set identifier', version_label: 'Label', revision: 'Revision', configuration: 'Age group', content_hash: 'SHA-256 of the canonical question content', status: 'Set status', frozen_at: 'Frozen (UTC)',
  } },
  COHORT_METADATA: { view: 'v_research_cohorts', columns: {
    institution_id: 'Institution', institution_code: 'Institution code', institution_type: 'SCHOOL, COLLEGE or UNIVERSITY', cohort_id: 'Cohort', cohort_code: 'Cohort code',
    academic_year: 'Academic year', education_stage: 'Education stage', developmental_band: 'Band', status: 'Cohort status',
  } },
};

const cellValue = (value) => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return escapeCell(JSON.stringify(value));
  return escapeCell(value);
};

/** One output row from a view document: policy first (may drop the row), then the fixed column order. */
const rowFor = (columns, doc, policy) => {
  const projected = identity.project(doc, policy);
  return projected ? columns.map((c) => cellValue(projected[c])) : null;
};

function addRows(sheet, rows) { for (const row of rows) sheet.addRow(row).commit(); }

/**
 * Writes the workbook to `filePath`. `ctx` = { tx, scope: { attemptIds, santulanIds, sourceSet, cohortFilter }, meta, policy, onProgress }.
 * Returns { sheets: [{ name, rows }], excluded } - the per-sheet data row counts as written.
 */
async function writeWorkbook(filePath, ctx) {
  const { tx, scope, meta, policy = identity.getPolicy(), includeAllVersions = false } = ctx;
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: filePath, useStyles: false, useSharedStrings: false });
  const written = [];
  const excluded = { withdrawn: 0 };

  const newSheet = (name, header) => { const ws = workbook.addWorksheet(name); ws.addRow(header).commit(); return ws; };
  const close = (ws, name, rows) => { ws.commit(); written.push({ name, rows }); };
  const columnsOf = (key) => Object.keys(SHEETS[key].columns);

  // README and DATA_DICTIONARY come first and never depend on the data
  const readme = newSheet('README', ['Santulan research export']);
  addRows(readme, meta.readme.map((line) => [escapeCell(line)]));
  close(readme, 'README', meta.readme.length);
  const dictionary = newSheet('DATA_DICTIONARY', ['sheet', 'column', 'description']);
  let dictionaryRows = 0;
  for (const [sheetKey, def] of Object.entries(SHEETS)) {
    for (const [column, text] of Object.entries(def.columns)) { dictionary.addRow([sheetKey === 'ITEM_RESPONSES' ? 'ITEM_RESPONSES_nn' : sheetKey, column, text]).commit(); dictionaryRows += 1; }
  }
  close(dictionary, 'DATA_DICTIONARY', dictionaryRows);

  const streamSimple = async (sheetName, key, filter, { countWithdrawn = false } = {}) => {
    const cols = columnsOf(key);
    const ws = newSheet(sheetName, cols);
    let rows = 0;
    const cursor = tx.v[SHEETS[key].view].cursor(filter);
    try {
      for await (const doc of cursor) {
        if (rows >= MAX_ROWS) break; // smaller tables never reach this; a guard so a sheet can never exceed Excel's limit
        const out = rowFor(cols, doc, policy);
        if (!out) { if (countWithdrawn && doc.participant_status === 'WITHDRAWN') excluded.withdrawn += 1; continue; }
        ws.addRow(out).commit();
        rows += 1;
      }
    } finally { await cursor.close(); }
    close(ws, sheetName, rows);
    return rows;
  };

  await streamSimple('PARTICIPANTS', 'PARTICIPANTS', { santulan_id: { $in: scope.santulanIds } }, { countWithdrawn: true });
  await streamSimple('ATTEMPTS', 'ATTEMPTS', { attempt_id: { $in: scope.attemptIds } });

  // ITEM_RESPONSES_nn: a new sheet is opened whenever the current one holds MAX_ROWS data rows
  {
    const cols = columnsOf('ITEM_RESPONSES');
    let n = 1;
    let ws = newSheet(responseSheetName(n), cols);
    let rows = 0;
    const filter = { attempt_id: { $in: scope.attemptIds }, ...(includeAllVersions ? {} : { is_current: true }) };
    const cursor = tx.v[SHEETS.ITEM_RESPONSES.view].cursor(filter);
    try {
      for await (const doc of cursor) {
        const out = rowFor(cols, doc, policy);
        if (!out) continue;
        if (rows === MAX_ROWS) { close(ws, responseSheetName(n), rows); n += 1; ws = newSheet(responseSheetName(n), cols); rows = 0; }
        ws.addRow(out).commit();
        rows += 1;
        if (ctx.onProgress && (rows % 50000 === 0)) ctx.onProgress({ sheet: responseSheetName(n), rows });
      }
    } finally { await cursor.close(); }
    close(ws, responseSheetName(n), rows);
  }

  await streamSimple('DOMAIN_SCORES', 'DOMAIN_SCORES', { attempt_id: { $in: scope.attemptIds } });
  await streamSimple('QUALITY_FLAGS', 'QUALITY_FLAGS', { attempt_id: { $in: scope.attemptIds } });
  await streamSimple('RESPONSE_EVENTS', 'RESPONSE_EVENTS', { attempt_id: { $in: scope.attemptIds } });
  await streamSimple('ASSESSMENT_VERSION', 'ASSESSMENT_VERSION', { assessment_version_id: scope.sourceSet._id });
  await streamSimple('COHORT_METADATA', 'COHORT_METADATA', scope.cohortFilter);

  // EXPORT_METADATA is last so it can state what was actually written
  const metaRows = meta.metadata(written.map((w) => ({ ...w })), excluded);
  const metadataSheet = newSheet('EXPORT_METADATA', ['key', 'value']);
  addRows(metadataSheet, metaRows.map(([k, v]) => [escapeCell(String(k)), escapeCell(String(v))]));
  close(metadataSheet, 'EXPORT_METADATA', metaRows.length);

  await workbook.commit();
  return { sheets: written, excluded, totalBytes: fs.statSync(filePath).size };
}

module.exports = { writeWorkbook, SHEETS, FILTER_COLUMNS };
