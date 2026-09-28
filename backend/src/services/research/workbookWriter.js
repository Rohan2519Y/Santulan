/*
 * Research master workbook, rebuilt to match "Santulan Pilot - Sample Validation Data After Assessment Submission
 * v1.0" (docs/Santulan 2.0/Profile). Nine sheets: README, PARTICIPANTS, ITEM_RESPONSES_LONG_nn, QUALITY_REVIEW,
 * ATTEMPT_SUMMARY, VALIDATION_WIDE_<track>, ITEM_CODEBOOK, RESEARCH_DASHBOARD - matching that sample's own sheet set
 * exactly (no DATA_DICTIONARY/EXPORT_METADATA sheets this time; the essential export facts move into README's text).
 *
 * buildScope's contract is unchanged: one export always covers exactly one source question set (one
 * assessment_version_id), which is one age track. Only the ONE matching VALIDATION_WIDE_<track> sheet is ever written -
 * the other track's sheet would always be empty for a single-source-set export, so it is omitted rather than written
 * empty ("exact same" sheet, not a padded-out superset).
 *
 * Pilot-scale sizing: everything except ITEM_RESPONSES_LONG is loaded into memory (participants, attempts, quality
 * flags and the source set's own item catalog are all bounded by one cohort and one ~175-item catalog, nowhere near
 * Excel's row limit). Only ITEM_RESPONSES_LONG streams from the source view and can span multiple _nn sheets, exactly
 * like the previous ITEM_RESPONSES_nn sheets did.
 *
 * ITEM_RESPONSES_LONG is always current-answer-only + explicit missing rows (the sample's own stated design: "One row
 * per expected participant x item... explicit missing rows"). That does not compose with `includeAllVersions`'
 * "every saved version" request, so this sheet ignores that flag - it is a request-level flag kept for API
 * compatibility, not because this sheet still varies by it.
 *
 * completion/readiness classification reuses scoringRules.completenessStatus (the SAME 60%/80%/100% boundaries
 * already used for domain-level completeness), applied across a whole attempt's items instead of one domain's.
 * validation_data_status (DATA_READY/REVIEW/NOT_READY) is an ASSUMED new classification - no contract defines it -
 * built on that same completeness classification plus whether the attempt carries any open quality flag.
 */
const fs = require('fs');
const ExcelJS = require('exceljs');
const { MAX_ROWS } = require('./partition');
const { escapeCell } = require('../domain/exportRules');
const identity = require('./researchIdentity');
const { completenessStatus } = require('../domain/scoringRules');
const framework = require('../../../seeders/santulan/reference/framework.json');

const DOMAIN_NAME = Object.fromEntries(framework.domains.map((d) => [d.code, d.name]));
const REQUIRED_CONSENTS = { ADOLESCENT: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'], EMERGING_ADULT: ['ADULT_SELF_CONSENT'] };
const COMPLETED_ATTEMPT_STATUSES = new Set(['SUBMITTED', 'SCORING', 'SCORED', 'REPORT_READY', 'QUALITY_HOLD']);

const cellValue = (value) => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return escapeCell(JSON.stringify(value));
  return escapeCell(value);
};
const row = (values) => values.map(cellValue);
const responseSheetName = (n) => `ITEM_RESPONSES_LONG_${String(n).padStart(2, '0')}`;

/** ASSUMED (no contract defines this): NOT_READY when completion itself falls below the INCOMPLETE boundary that
 * already gates scoring eligibility elsewhere; otherwise REVIEW if the attempt carries any open quality flag, else
 * DATA_READY. */
function validationDataStatus(captureClass, flagCount) {
  if (captureClass === 'INCOMPLETE' || captureClass === 'INSUFFICIENT') return 'NOT_READY';
  return flagCount > 0 ? 'REVIEW' : 'DATA_READY';
}

/**
 * Writes the workbook to `filePath`. `ctx` = { tx, scope: { attemptIds, santulanIds, sourceSet, cohortFilter }, meta, policy }.
 * Returns { sheets: [{ name, rows }], excluded } - the per-sheet data row counts as written.
 */
async function writeWorkbook(filePath, ctx) {
  const { tx, scope, meta, policy = identity.getPolicy() } = ctx;
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: filePath, useStyles: false, useSharedStrings: false });
  const written = [];
  const excluded = { withdrawn: 0 };

  const newSheet = (name, header) => { const ws = workbook.addWorksheet(name); if (header) ws.addRow(header).commit(); return ws; };
  const close = (ws, name, n) => { ws.commit(); written.push({ name, rows: n }); };
  const addRows = (sheet, rows) => { for (const r of rows) sheet.addRow(r).commit(); };

  const set = scope.sourceSet;
  const track = set.configuration; // ADOLESCENT | EMERGING_ADULT - the export's one track (one source set = one track)

  // ---- load once: everything except item responses is pilot-scale (bounded by one cohort, one ~175-item catalog) ----
  const attempts = await tx.c.assessment_attempts.find({ _id: { $in: scope.attemptIds } });
  const participantIds = [...new Set(attempts.map((a) => a.participant_id))];
  const participants = await tx.c.participants.find({ _id: { $in: participantIds } });
  const institutions = await tx.c.institutions.find({ _id: { $in: [...new Set(participants.map((p) => p.institution_id).filter(Boolean))] } });
  const cohorts = await tx.c.cohorts.find({ _id: { $in: [...new Set(participants.map((p) => p.cohort_id).filter(Boolean))] } });
  const consents = await tx.c.consents.find({ participant_id: { $in: participantIds } });
  const qualityFlags = await tx.c.quality_flags.find({ attempt_id: { $in: scope.attemptIds }, flag_code: { $ne: 'Q09' } });
  const codebookItems = await tx.c.items.find({ assessment_version_id: set._id }, { sort: { display_order: 1 } });
  const expectedItems = codebookItems.filter((i) => i.layer === 'CORE'); // what a participant of this set is actually asked

  const institutionById = new Map(institutions.map((i) => [i._id, i]));
  const cohortById = new Map(cohorts.map((c) => [c._id, c]));
  const participantById = new Map(participants.map((p) => [p._id, p]));
  const attemptById = new Map(attempts.map((a) => [a._id, a]));
  const consentsByParticipant = new Map();
  for (const c of consents) { if (!consentsByParticipant.has(c.participant_id)) consentsByParticipant.set(c.participant_id, []); consentsByParticipant.get(c.participant_id).push(c); }
  const flagsByAttempt = new Map();
  for (const f of qualityFlags) { if (!flagsByAttempt.has(f.attempt_id)) flagsByAttempt.set(f.attempt_id, []); flagsByAttempt.get(f.attempt_id).push(f); }

  const prId = (santulanId) => identity.participantResearchId(santulanId);
  const consentStatusOf = (participantId, participantTrack) => {
    const required = REQUIRED_CONSENTS[participantTrack] || [];
    const own = consentsByParticipant.get(participantId) || [];
    return required.every((t) => own.some((c) => c.consent_type === t && c.status === 'VERIFIED')) ? 'VERIFIED' : 'PENDING';
  };

  // ---- README ----
  {
    const ws = newSheet('README', ['Santulan research export']);
    const dataset = scope.sourceSet;
    addRows(ws, meta.readme.concat([
      `Export id: ${meta.exportId}`, `Generated: ${new Date().toISOString()}`, `Anonymisation version: ${meta.anonymisationVersion}`,
      `Source question set: ${dataset.version_label} r${dataset.revision} (${track})`, `Filters applied: ${meta.filtersApplied}`,
    ]).map((line) => [escapeCell(line)]));
    close(ws, 'README', meta.readme.length + 5);
  }

  // ---- PARTICIPANTS ----
  let participantRows = 0;
  {
    const cols = ['participant_research_id', 'institution_code', 'cohort_code', 'participation_route', 'assessment_track', 'developmental_band', 'administration_language', 'consent_status', 'participant_status', 'created_at'];
    const ws = newSheet('PARTICIPANTS', cols);
    for (const p of participants) {
      if (p.status === 'WITHDRAWN') { excluded.withdrawn += 1; continue; }
      const inst = institutionById.get(p.institution_id);
      const coh = cohortById.get(p.cohort_id);
      ws.addRow(row([
        prId(p.santulan_id), inst ? inst.institution_code : null, coh ? coh.cohort_code : null, p.participation_route,
        p.assessment_track, p.developmental_band, p.administration_language, consentStatusOf(p._id, p.assessment_track), p.status, p.created_at,
      ])).commit();
      participantRows += 1;
    }
    close(ws, 'PARTICIPANTS', participantRows);
  }

  // ---- ITEM_RESPONSES_LONG_nn: stream actual current answers, then synthesise explicit missing rows ----
  const answeredByAttempt = new Map(); // attemptId -> Map(itemCode -> position)
  let irWs; let irN = 1; let irRows = 0;
  const openIr = () => { irWs = newSheet(responseSheetName(irN), [
    'research_record_id', 'participant_research_id', 'attempt_id', 'assessment_form', 'assessment_version', 'item_code',
    'domain_code', 'subdomain_code', 'response_value', 'missing_flag', 'response_version', 'is_current', 'response_timestamp', 'time_spent_ms',
  ]); irRows = 0; };
  const closeIr = () => { close(irWs, responseSheetName(irN), irRows); };
  const writeIrRow = (r) => {
    if (irRows === MAX_ROWS) { closeIr(); irN += 1; openIr(); }
    irWs.addRow(r).commit();
    irRows += 1;
  };
  openIr();
  {
    const cursor = tx.v.v_research_item_responses.cursor({ attempt_id: { $in: scope.attemptIds }, is_current: true });
    try {
      for await (const doc of cursor) {
        const projected = identity.project(doc, policy);
        if (!projected) continue; // withdrawn - already counted via PARTICIPANTS
        if (!answeredByAttempt.has(projected.attempt_id)) answeredByAttempt.set(projected.attempt_id, new Map());
        answeredByAttempt.get(projected.attempt_id).set(projected.item_code, projected.response_value);
        writeIrRow(row([
          projected.response_id, projected.participant_research_id, projected.attempt_id, track, set.version_label,
          projected.item_code, projected.domain_code, projected.subdomain_code, projected.response_value, 'NO',
          projected.response_version, projected.is_current, projected.answered_at, projected.response_time_ms,
        ]));
      }
    } finally { await cursor.close(); }
  }
  // explicit missing rows: every expected item this attempt's participant never answered
  const missingByAttempt = new Map(); // attemptId -> count
  for (const a of attempts) {
    const p = participantById.get(a.participant_id);
    if (!p || p.status === 'WITHDRAWN') continue;
    const answered = answeredByAttempt.get(a._id) || new Map();
    let missing = 0;
    for (const item of expectedItems) {
      if (answered.has(item.item_code)) continue;
      missing += 1;
      writeIrRow(row([null, prId(p.santulan_id), a._id, track, set.version_label, item.item_code, item.domain_code, item.subdomain_code, null, 'YES', null, null, null, null]));
    }
    missingByAttempt.set(a._id, missing);
  }
  closeIr();

  // ---- ATTEMPT_SUMMARY (also feeds RESEARCH_DASHBOARD below) ----
  const attemptSummaries = [];
  {
    const cols = ['participant_research_id', 'attempt_id', 'assessment_form', 'assessment_version', 'age_years_at_attempt', 'developmental_band',
      'attempt_status', 'total_items_expected', 'total_items_answered', 'completion_pct', 'missing_item_count', 'capture_class', 'quality_flag_count', 'validation_data_status', 'submitted_at'];
    const ws = newSheet('ATTEMPT_SUMMARY', cols);
    let n = 0;
    for (const a of attempts) {
      const p = participantById.get(a.participant_id);
      if (!p || p.status === 'WITHDRAWN') continue;
      const expected = expectedItems.length;
      const missing = missingByAttempt.get(a._id) || 0;
      const answered = expected - missing;
      const captureClass = expected > 0 ? completenessStatus(answered, expected) : 'INSUFFICIENT';
      const flagCount = (flagsByAttempt.get(a._id) || []).length;
      const status = validationDataStatus(captureClass, flagCount);
      attemptSummaries.push({ attemptId: a._id, status: a.status, expected, answered, captureClass, flagCount, validationDataStatus: status });
      ws.addRow(row([
        prId(p.santulan_id), a._id, track, set.version_label, a.age_years_at_attempt, a.developmental_band_at_attempt, a.status,
        expected, answered, expected ? Math.round((answered / expected) * 10000) / 10000 : 0, missing, captureClass, flagCount, status, a.submitted_at,
      ])).commit();
      n += 1;
    }
    close(ws, 'ATTEMPT_SUMMARY', n);
  }

  // ---- QUALITY_REVIEW ----
  {
    const cols = ['flag_id', 'participant_research_id', 'attempt_id', 'flag_code', 'domain_code', 'severity', 'disposition', 'detected_at', 'reviewed_at'];
    const ws = newSheet('QUALITY_REVIEW', cols);
    let n = 0;
    for (const f of qualityFlags) {
      const a = attemptById.get(f.attempt_id);
      const p = a ? participantById.get(a.participant_id) : null;
      if (!p || p.status === 'WITHDRAWN') continue;
      ws.addRow(row([f._id, prId(p.santulan_id), f.attempt_id, f.flag_code, f.domain_code, f.severity, f.disposition, f.detected_at, f.reviewed_at])).commit();
      n += 1;
    }
    close(ws, 'QUALITY_REVIEW', n);
  }

  // ---- VALIDATION_WIDE_<track>: one row per attempt, one column per expected item; blank cell = missing ----
  {
    const sheetName = `VALIDATION_WIDE_${track === 'ADOLESCENT' ? 'ADO' : 'EA'}`;
    const cols = ['participant_research_id', 'attempt_id', 'institution_code', 'cohort_code', 'age_years', 'developmental_band', 'assessment_form', 'assessment_version', ...expectedItems.map((i) => i.item_code)];
    const ws = newSheet(sheetName, cols);
    let n = 0;
    for (const a of attempts) {
      const p = participantById.get(a.participant_id);
      if (!p || p.status === 'WITHDRAWN') continue;
      const inst = institutionById.get(p.institution_id);
      const coh = cohortById.get(p.cohort_id);
      const answered = answeredByAttempt.get(a._id) || new Map();
      ws.addRow(row([
        prId(p.santulan_id), a._id, inst ? inst.institution_code : null, coh ? coh.cohort_code : null, a.age_years_at_attempt, a.developmental_band_at_attempt, track, set.version_label,
        ...expectedItems.map((i) => (answered.has(i.item_code) ? Number(answered.get(i.item_code)) : null)),
      ])).commit();
      n += 1;
    }
    close(ws, sheetName, n);
  }

  // ---- ITEM_CODEBOOK: the full uploaded catalog of this source set (every layer/status, not just CORE) ----
  {
    const cols = ['assessment_form', 'assessment_version', 'item_code', 'domain_code', 'domain_name', 'subdomain_code', 'subdomain_name', 'item_text', 'keying', 'age_band', 'context', 'layer', 'status', 'display_order'];
    const ws = newSheet('ITEM_CODEBOOK', cols);
    for (const i of codebookItems) {
      ws.addRow(row([track, set.version_label, i.item_code, i.domain_code, DOMAIN_NAME[i.domain_code] || null, i.subdomain_code, i.subdomain_name, i.item_text, i.keying, i.age_band, i.context, i.layer, i.status, i.display_order])).commit();
    }
    close(ws, 'ITEM_CODEBOOK', codebookItems.length);
  }

  // ---- RESEARCH_DASHBOARD: a small summary derived from ATTEMPT_SUMMARY above ----
  {
    const ws = newSheet('RESEARCH_DASHBOARD', ['metric', 'value']);
    const submitted = attemptSummaries.filter((s) => COMPLETED_ATTEMPT_STATUSES.has(s.status)).length;
    const byStatus = (s) => attemptSummaries.filter((x) => x.validationDataStatus === s).length;
    const expectedRows = attemptSummaries.reduce((sum, s) => sum + s.expected, 0);
    const missingRows = attemptSummaries.reduce((sum, s) => sum + (s.expected - s.answered), 0);
    const dashboardRows = [
      ['Submitted participants', submitted], ['Data ready', byStatus('DATA_READY')], ['Review', byStatus('REVIEW')], ['Not ready', byStatus('NOT_READY')],
      ['Expected item rows', expectedRows], ['Missing item rows', missingRows],
    ];
    addRows(ws, dashboardRows.map(([k, v]) => row([k, v])));
    close(ws, 'RESEARCH_DASHBOARD', dashboardRows.length);
  }

  await workbook.commit();
  return { sheets: written, excluded, totalBytes: fs.statSync(filePath).size };
}

module.exports = { writeWorkbook, responseSheetName };
