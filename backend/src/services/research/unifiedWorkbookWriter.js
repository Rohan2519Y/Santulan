/*
 * Unified report+research workbook (santulan-report-research-format-v1), the format the Santulan pilot kit's own report
 * generator reads (docs/Santulan 2.0/santulan_pilot_kit/TECH_TEAM_GUIDE.md). This is a SEPARATE export from the research
 * export in workbookWriter.js: that one is deliberately de-identified (no IDENTITY, no DOMAIN_RESULTS) for research
 * distribution; this one carries real names and real scores because it feeds the report-generation pipeline, not research.
 *
 * Sheets: README, DATA_DICTIONARY, PARTICIPANTS, IDENTITY, ATTEMPTS, DOMAIN_RESULTS, REPORT_SETTINGS,
 * ITEM_RESPONSES_LONG_nn, ITEM_CODEBOOK, CONFIG - the exact set the kit's generator and verifier expect.
 *
 * C4.2 exclusion (rule A12, the kit's own item-file convention): the two items of subdomain C4.2 are held out of the C4
 * domain mean. Our live scoring engine (score_results) does NOT hold these out - it scores all CORE items, so its
 * raw_score for C4 would not match the kit's reference scorer. This writer therefore recomputes every domain_mean
 * straight from current item responses (not from score_results), excluding C4.2 items by subdomain_code (not by a fixed
 * item-code list - the two held item codes differ between the adolescent and emerging-adult forms). This is scoped to
 * this export only; the platform's real score_results, reports, growth plans and pathway decisions are untouched.
 */
const fs = require('fs');
const ExcelJS = require('exceljs');
const { escapeCell } = require('../domain/exportRules');
const framework = require('../../../seeders/santulan/reference/framework.json');

const DOMAIN_NAME = Object.fromEntries(framework.domains.map((d) => [d.code, d.name]));

const cellValue = (value) => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return escapeCell(JSON.stringify(value));
  return escapeCell(value);
};
const row = (values) => values.map(cellValue);
const responseSheetName = (n) => `ITEM_RESPONSES_LONG_${String(n).padStart(2, '0')}`;

const HEADER_FONT = { bold: true };
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE1E5F2' } };
const MIN_COL_WIDTH = 10;
const MAX_COL_WIDTH = 60;
const widthOf = (values) => {
  let max = 0;
  for (const v of values) { if (v !== null && v !== undefined) { const len = String(v).length; if (len > max) max = len; } }
  return Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, max + 2));
};
const styleHeaderRow = (excelRow) => excelRow.eachCell({ includeEmpty: true }, (cell) => { cell.font = HEADER_FONT; cell.fill = HEADER_FILL; });

const REQUIRED_CONSENTS = { ADOLESCENT: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'], EMERGING_ADULT: ['ADULT_SELF_CONSENT'] };

// CONFIG thresholds (kit's own defaults; see TECH_TEAM_GUIDE.md / the kit's CONFIG sheet). Kept here, not invented: these
// are the exact values the kit's dry-run workbook ships with.
const CFG_PROVISIONAL_UPPER = 0.2; // CFG-01: missing share below this -> MS02
const CFG_NO_SCORE = 0.4; // CFG-02: missing share at/above this -> MS04
const MIN_ITEMS_PER_DOMAIN = 5;

function missingState(itemsExpected, missingShare) {
  if (itemsExpected < MIN_ITEMS_PER_DOMAIN) return 'MS04';
  if (missingShare === 0) return 'MS01';
  if (missingShare < CFG_PROVISIONAL_UPPER) return 'MS02';
  if (missingShare < CFG_NO_SCORE) return 'MS03';
  return 'MS04';
}
const reportableOf = (state) => (state === 'MS01' || state === 'MS02' ? 'YES' : 'NO');

/** The kit's 3-value attempt_status vocabulary (SUBMITTED / IN_PROGRESS / VOID), mapped from our own ATTEMPT_STATUS enum. */
function kitAttemptStatus(ourStatus) {
  if (['SUBMITTED', 'SCORING', 'SCORED', 'REPORT_READY', 'QUALITY_HOLD'].includes(ourStatus)) return 'SUBMITTED';
  if (['INVALID', 'EXPIRED'].includes(ourStatus)) return 'VOID';
  return 'IN_PROGRESS';
}
/** report_state: NORMAL unless the attempt is on hold or invalid (TECH_TEAM_GUIDE.md: decides what the student gets). */
function reportStateOf(ourStatus) {
  if (ourStatus === 'QUALITY_HOLD') return 'QUALITY_HOLD';
  if (ourStatus === 'INVALID') return 'INVALID';
  return 'NORMAL';
}

const round2 = (x) => Math.round((x + 1e-9) * 100) / 100;

/**
 * Writes the unified workbook to `filePath` for exactly the given attempts (synthetic/test attempts only - the caller
 * decides scope; this writer has no "all participants" mode). `ctx` = { tx, attemptIds, meta }.
 * Returns { sheets: [{ name, rows }] }.
 */
async function writeUnifiedWorkbook(filePath, ctx) {
  const { tx, attemptIds, extraParticipantIds = [], meta } = ctx;
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: filePath, useStyles: true, useSharedStrings: false });
  const written = [];

  const newSheet = (name, header) => {
    const ws = { raw: workbook.addWorksheet(name), rows: [], headerRows: new Set() };
    if (header) { ws.headerRows.add(0); ws.rows.push(header); }
    return ws;
  };
  const addRow = (ws, r) => ws.rows.push(r);
  const addRows = (ws, rows) => { for (const r of rows) addRow(ws, r); };
  const close = (ws, name, n) => {
    const width = ws.rows.length ? Math.max(...ws.rows.map((r) => r.length)) : 0;
    ws.raw.columns = Array.from({ length: width }, (_, i) => ({ width: widthOf(ws.rows.map((r) => r[i])) }));
    ws.rows.forEach((r, i) => {
      const excelRow = ws.raw.addRow(r);
      if (ws.headerRows.has(i)) styleHeaderRow(excelRow);
      excelRow.commit();
    });
    ws.raw.commit();
    written.push({ name, rows: n });
  };
  const newStreamingSheet = (name, header, widths) => {
    const raw = workbook.addWorksheet(name);
    raw.columns = widths.map((w) => ({ width: w }));
    const headerRow = raw.addRow(header);
    styleHeaderRow(headerRow);
    headerRow.commit();
    return raw;
  };
  const closeStreamingSheet = (raw, name, n) => { raw.commit(); written.push({ name, rows: n }); };

  // ---- load everything (pilot/synthetic scale only - this writer is never given a full-population attempt list) ----
  const attempts = await tx.c.assessment_attempts.find({ _id: { $in: attemptIds } });
  // PARTICIPANTS/IDENTITY also cover participants with no attempt at all (e.g. consent still pending) - the kit's own
  // generator needs to see them to refuse with a reason, not just silently omit them.
  const participantIds = [...new Set([...attempts.map((a) => a.participant_id), ...extraParticipantIds])];
  const participants = await tx.c.participants.find({ _id: { $in: participantIds } });
  const institutions = await tx.c.institutions.find({ _id: { $in: [...new Set(participants.map((p) => p.institution_id).filter(Boolean))] } });
  const cohorts = await tx.c.cohorts.find({ _id: { $in: [...new Set(participants.map((p) => p.cohort_id).filter(Boolean))] } });
  const consents = await tx.c.consents.find({ participant_id: { $in: participantIds } });
  const pilotDetails = await tx.c.participant_pilot_details.find({ participant_id: { $in: participantIds } });
  const setIds = [...new Set(attempts.map((a) => a.assessment_version_id))];
  const sets = await tx.c.assessment_versions.find({ _id: { $in: setIds } });
  const setById = new Map(sets.map((s) => [s._id, s]));
  const allItems = await tx.c.items.find({ assessment_version_id: { $in: setIds } }, { sort: { display_order: 1 } });
  const itemsBySet = new Map();
  for (const i of allItems) { if (!itemsBySet.has(i.assessment_version_id)) itemsBySet.set(i.assessment_version_id, []); itemsBySet.get(i.assessment_version_id).push(i); }
  const responses = await tx.c.responses.find({ attempt_id: { $in: attemptIds }, is_current: true });

  const institutionById = new Map(institutions.map((i) => [i._id, i]));
  const cohortById = new Map(cohorts.map((c) => [c._id, c]));
  const participantById = new Map(participants.map((p) => [p._id, p]));
  const pilotDetailsByParticipant = new Map(pilotDetails.map((d) => [d.participant_id, d]));
  const consentsByParticipant = new Map();
  for (const c of consents) { if (!consentsByParticipant.has(c.participant_id)) consentsByParticipant.set(c.participant_id, []); consentsByParticipant.get(c.participant_id).push(c); }
  const responsesByAttempt = new Map();
  for (const r of responses) { if (!responsesByAttempt.has(r.attempt_id)) responsesByAttempt.set(r.attempt_id, []); responsesByAttempt.get(r.attempt_id).push(r); }

  const consentStatusOf = (participantId, track) => {
    const required = REQUIRED_CONSENTS[track] || [];
    const own = consentsByParticipant.get(participantId) || [];
    return required.every((t) => own.some((c) => c.consent_type === t && c.status === 'VERIFIED')) ? 'VERIFIED' : 'PENDING';
  };

  // ---- README ----
  {
    const ws = newSheet('README', ['Santulan report + research workbook']);
    addRows(ws, meta.readme.concat([`Generated: ${new Date().toISOString()}`]).map((line) => [escapeCell(line)]));
    close(ws, 'README', meta.readme.length + 1);
  }

  // ---- DATA_DICTIONARY (static: mirrors the kit's own TECH_TEAM_GUIDE.md field contract) ----
  {
    const cols = ['sheet', 'column', 'type', 'needed for', 'allowed values / rule'];
    const ws = newSheet('DATA_DICTIONARY', cols);
    const rows = [
      ['PARTICIPANTS', 'consent_status', 'text', 'REPORT', 'VERIFIED to produce a report. Anything else: the generator refuses.'],
      ['PARTICIPANTS', 'participant_status', 'text', 'RESEARCH', 'ACTIVE, DEMO (sample rows only), WITHDRAWN.'],
      ['IDENTITY', 'display_name', 'text', 'REPORT', 'Shown on the cover.'],
      ['IDENTITY', 'first_name', 'text', 'REPORT', 'Used in "Hi <first name>!".'],
      ['IDENTITY', 'class_or_year', 'text', 'REPORT', 'For example "Grade 11". Optional.'],
      ['ATTEMPTS', 'attempt_status', 'text', 'REPORT', 'SUBMITTED, IN_PROGRESS, VOID. Only SUBMITTED attempts are reported.'],
      ['ATTEMPTS', 'report_state', 'text', 'REPORT', 'NORMAL, QUALITY_HOLD, INVALID.'],
      ['ATTEMPTS', 'scoring_version', 'text', 'REPORT', 'Version of the scoring rules that produced DOMAIN_RESULTS.'],
      ['DOMAIN_RESULTS', 'domain_mean', 'number 1.00-5.00', 'REPORT', 'Blank when items_answered = 0.'],
      ['DOMAIN_RESULTS', 'c42_items_excluded', 'integer', 'RESEARCH', 'Only on the C4 row: Self-Worth (C4.2) items held out (rule A12). Zero elsewhere.'],
      ['DOMAIN_RESULTS', 'missing_state', 'text', 'AUTO', 'MS01 none missing; MS02 below CFG-01; MS03 CFG-01..CFG-02; MS04 CFG-02+ or fewer than MIN_ITEMS_PER_DOMAIN items.'],
      ['DOMAIN_RESULTS', 'reportable', 'text', 'AUTO', 'YES only for MS01/MS02.'],
      ['REPORT_SETTINGS', 'release_priority / action / ifthen / review', 'YES or NO', 'REPORT', 'Release gates. All NO during the pilot.'],
      ['REPORT_SETTINGS', 'reviewer_status', 'text', 'REPORT', 'PENDING or APPROVED.'],
      ['CONFIG', '(all)', 'reference', 'AUTO', 'Copy of the thresholds the formulas above use.'],
    ];
    addRows(ws, rows.map(row));
    close(ws, 'DATA_DICTIONARY', rows.length);
  }

  // ---- PARTICIPANTS ----
  {
    const cols = ['participant_research_id', 'institution_code', 'cohort_code', 'participation_route', 'assessment_track', 'developmental_band', 'administration_language', 'consent_status', 'participant_status', 'created_at'];
    const ws = newSheet('PARTICIPANTS', cols);
    for (const p of participants) {
      const inst = institutionById.get(p.institution_id);
      const coh = cohortById.get(p.cohort_id);
      addRow(ws, row([
        p.santulan_id, inst ? inst.institution_code : null, coh ? coh.cohort_code : null, p.participation_route,
        p.assessment_track, p.developmental_band, p.administration_language, consentStatusOf(p._id, p.assessment_track), p.status, p.created_at,
      ]));
    }
    close(ws, 'PARTICIPANTS', participants.length);
  }

  // ---- IDENTITY (RESTRICTED: names, never in the de-identified research export) ----
  {
    const cols = ['participant_research_id', 'display_name', 'first_name', 'class_or_year', 'institution_name'];
    const ws = newSheet('IDENTITY', cols);
    for (const p of participants) {
      const d = pilotDetailsByParticipant.get(p._id);
      const inst = institutionById.get(p.institution_id);
      const fullName = d ? d.full_name : null;
      const firstName = fullName ? fullName.trim().split(/\s+/)[0] : null;
      addRow(ws, row([p.santulan_id, fullName, firstName, d ? d.class_name : null, inst ? inst.institution_name : null]));
    }
    close(ws, 'IDENTITY', participants.length);
  }

  // ---- compute per-attempt: answered items (all, and C4.2-excluded per domain) ----
  const answeredByAttempt = new Map(); // attemptId -> Map(itemId -> position)
  for (const a of attempts) {
    const itemById = new Map((itemsBySet.get(a.assessment_version_id) || []).map((i) => [i._id, i]));
    const answered = new Map();
    for (const r of responsesByAttempt.get(a._id) || []) {
      const it = itemById.get(r.item_id);
      if (it) answered.set(r.item_id, { position: Number(r.response_value), item: it });
    }
    answeredByAttempt.set(a._id, answered);
  }

  // ---- ATTEMPTS + DOMAIN_RESULTS (recomputed from raw responses, C4.2 held out by subdomain_code, not item code) ----
  const attemptRows = [];
  const domainRows = [];
  for (const a of attempts) {
    const p = participantById.get(a.participant_id);
    if (!p) continue;
    const set = setById.get(a.assessment_version_id);
    const track = set.configuration;
    const items = itemsBySet.get(a.assessment_version_id) || [];
    const coreItems = items.filter((i) => i.layer === 'CORE' && i.status === 'ACTIVE');
    const answered = answeredByAttempt.get(a._id) || new Map();

    const byDomain = new Map();
    for (const it of coreItems) { if (!byDomain.has(it.domain_code)) byDomain.set(it.domain_code, []); byDomain.get(it.domain_code).push(it); }

    let totalExpected = 0; let totalAnswered = 0; let scoredAt = null;
    for (const [domainCode, domainItems] of byDomain) {
      const held = domainItems.filter((i) => i.subdomain_code === 'C4.2');
      const scored_ = domainItems.filter((i) => i.subdomain_code !== 'C4.2');
      const answeredScored = scored_.filter((i) => answered.has(i._id));
      const itemsExpected = scored_.length;
      const itemsAnswered = answeredScored.length;
      const mean = itemsAnswered > 0 ? round2(answeredScored.reduce((s, i) => s + answered.get(i._id).position, 0) / itemsAnswered) : null;
      const missingShare = itemsExpected > 0 ? round2(1 - itemsAnswered / itemsExpected) : null;
      const state = itemsExpected > 0 ? missingState(itemsExpected, missingShare) : 'MS04';
      totalExpected += domainItems.length;
      totalAnswered += domainItems.filter((i) => answered.has(i._id)).length;
      const at = a.submitted_at || a.completed_at || a.created_at;
      if (!scoredAt || at > scoredAt) scoredAt = at;
      domainRows.push(row([
        a._id, p.santulan_id, domainCode, DOMAIN_NAME[domainCode] || null, mean, itemsExpected, itemsAnswered, held.length,
        missingShare, state, reportableOf(state), a.scoring_version || 'domain-mean-v1', at,
      ]));
    }

    attemptRows.push(row([
      p.santulan_id, a._id, track, set.version_label, a.age_years_at_attempt, a.developmental_band_at_attempt,
      kitAttemptStatus(a.status), a.submitted_at, totalExpected, totalAnswered,
      totalExpected ? round2(totalAnswered / totalExpected) : 0, totalExpected - totalAnswered, null, null, null,
      reportStateOf(a.status), null, a.scoring_version || 'domain-mean-v1', scoredAt,
    ]));
  }

  {
    const cols = ['participant_research_id', 'attempt_id', 'assessment_form', 'assessment_version', 'age_years_at_attempt', 'developmental_band',
      'attempt_status', 'submitted_at', 'total_items_expected', 'total_items_answered', 'completion_pct', 'missing_item_count',
      'capture_class', 'quality_flag_count', 'validation_data_status', 'report_state', 'report_state_reason_internal', 'scoring_version', 'scored_at'];
    const ws = newSheet('ATTEMPTS', cols);
    addRows(ws, attemptRows);
    close(ws, 'ATTEMPTS', attemptRows.length);
  }
  {
    const cols = ['attempt_id', 'participant_research_id', 'domain_code', 'domain_name', 'domain_mean', 'items_expected', 'items_answered',
      'c42_items_excluded', 'missing_share', 'missing_state', 'reportable', 'scoring_version', 'scored_at'];
    const ws = newSheet('DOMAIN_RESULTS', cols);
    addRows(ws, domainRows);
    close(ws, 'DOMAIN_RESULTS', domainRows.length);
  }

  // ---- REPORT_SETTINGS: all gates NO during the pilot (TECH_TEAM_GUIDE.md default); nothing yet chosen by any
  // participant since this export runs before report generation / growth-plan selection. ----
  {
    const cols = ['attempt_id', 'release_priority', 'release_action', 'release_ifthen', 'release_review', 'goals', 'plan_domains', 'report_language', 'reviewer_status', 'reviewed_by', 'reviewed_at'];
    const ws = newSheet('REPORT_SETTINGS', cols);
    for (const a of attempts) addRow(ws, row([a._id, 'NO', 'NO', 'NO', 'NO', null, null, 'en', 'PENDING', null, null]));
    close(ws, 'REPORT_SETTINGS', attempts.length);
  }

  // ---- ITEM_RESPONSES_LONG_nn (same columns as the existing research export) ----
  const IR_HEADER = ['research_record_id', 'participant_research_id', 'attempt_id', 'assessment_form', 'assessment_version', 'item_code',
    'domain_code', 'subdomain_code', 'response_value', 'missing_flag', 'response_version', 'is_current', 'response_timestamp', 'time_spent_ms'];
  const IR_WIDTHS = [16, 20, 38, 16, 24, 12, 12, 14, 16, 13, 16, 11, 26, 14];
  let irWs; let irRows = 0;
  irWs = newStreamingSheet(responseSheetName(1), IR_HEADER, IR_WIDTHS);
  for (const a of attempts) {
    const p = participantById.get(a.participant_id);
    if (!p) continue;
    const set = setById.get(a.assessment_version_id);
    const items = itemsBySet.get(a.assessment_version_id) || [];
    const coreItems = items.filter((i) => i.layer === 'CORE' && i.status === 'ACTIVE');
    const answered = answeredByAttempt.get(a._id) || new Map();
    for (const r of responsesByAttempt.get(a._id) || []) {
      const it = coreItems.find((i) => i._id === r.item_id);
      if (!it) continue;
      irWs.addRow(row([
        r._id, p.santulan_id, a._id, set.configuration, set.version_label, it.item_code, it.domain_code, it.subdomain_code,
        r.response_value, 'NO', r.response_version, r.is_current, r.answered_at, r.response_time_ms,
      ])).commit();
      irRows += 1;
    }
    for (const it of coreItems) {
      if (answered.has(it._id)) continue;
      irWs.addRow(row([null, p.santulan_id, a._id, set.configuration, set.version_label, it.item_code, it.domain_code, it.subdomain_code, null, 'YES', null, null, null, null])).commit();
      irRows += 1;
    }
  }
  closeStreamingSheet(irWs, responseSheetName(1), irRows);

  // ---- ITEM_CODEBOOK (same columns as the existing research export) ----
  {
    const cols = ['assessment_form', 'assessment_version', 'item_code', 'domain_code', 'domain_name', 'subdomain_code', 'subdomain_name', 'item_text', 'keying', 'age_band', 'context', 'layer', 'status', 'display_order'];
    const ws = newSheet('ITEM_CODEBOOK', cols);
    let n = 0;
    for (const setId of setIds) {
      const set = setById.get(setId);
      for (const i of itemsBySet.get(setId) || []) {
        addRow(ws, row([set.configuration, set.version_label, i.item_code, i.domain_code, DOMAIN_NAME[i.domain_code] || null, i.subdomain_code, i.subdomain_name, i.item_text, i.keying, i.age_band, i.context, i.layer, i.status, i.display_order]));
        n += 1;
      }
    }
    close(ws, 'ITEM_CODEBOOK', n);
  }

  // ---- CONFIG (the exact thresholds this writer's own formulas above use) ----
  {
    const ws = newSheet('CONFIG', ['Parameter', 'Value', 'Source']);
    const rows = [
      ['CFG-01 provisional upper bound (missing share below this)', CFG_PROVISIONAL_UPPER, 'santulan report engine'],
      ['CFG-02 no-score threshold (missing share at or above this)', CFG_NO_SCORE, 'santulan report engine'],
      ['MIN_ITEMS_PER_DOMAIN', MIN_ITEMS_PER_DOMAIN, 'santulan report engine'],
    ];
    addRows(ws, rows.map(row));
    close(ws, 'CONFIG', rows.length);
  }

  await workbook.commit();
  return { sheets: written, totalBytes: fs.statSync(filePath).size };
}

module.exports = { writeUnifiedWorkbook, responseSheetName, missingState, reportableOf, kitAttemptStatus, reportStateOf, round2, REQUIRED_CONSENTS, DOMAIN_NAME };
