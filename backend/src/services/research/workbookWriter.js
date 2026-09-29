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
const JSZip = require('jszip');
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

const HEADER_FONT = { bold: true };
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE1E5F2' } };
const MIN_COL_WIDTH = 10;
const MAX_COL_WIDTH = 60;
/** A column wide enough for its widest actual value (min/max clamped) - readable without the person opening the
 * file having to drag every column border themselves, the complaint that prompted this. */
const widthOf = (values) => {
  let max = 0;
  for (const v of values) { if (v !== null && v !== undefined) { const len = String(v).length; if (len > max) max = len; } }
  return Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, max + 2));
};
const styleHeaderRow = (excelRow) => excelRow.eachCell({ includeEmpty: true }, (cell) => { cell.font = HEADER_FONT; cell.fill = HEADER_FILL; });

/** ASSUMED (no contract defines this): NOT_READY when completion itself falls below the INCOMPLETE boundary that
 * already gates scoring eligibility elsewhere; otherwise REVIEW if the attempt carries any open quality flag, else
 * DATA_READY. */
function validationDataStatus(captureClass, flagCount) {
  if (captureClass === 'INCOMPLETE' || captureClass === 'INSUFFICIENT') return 'NOT_READY';
  return flagCount > 0 ? 'REVIEW' : 'DATA_READY';
}

const CHART_NS = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const barChartXml = (title, catRange, valRange, formatCode) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
  + `<c:chartSpace ${CHART_NS}><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${title}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`
  + `<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>`
  + `<c:ser><c:idx val="0"/><c:order val="0"/><c:cat><c:strRef><c:f>${catRange}</c:f></c:strRef></c:cat>`
  + `<c:val><c:numRef><c:f>${valRange}</c:f><c:numCache><c:formatCode>${formatCode}</c:formatCode></c:numCache></c:numRef></c:val></c:ser>`
  + `<c:axId val="111111111"/><c:axId val="222222222"/></c:barChart>`
  + `<c:catAx><c:axId val="111111111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="222222222"/></c:catAx>`
  + `<c:valAx><c:axId val="222222222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="111111111"/></c:valAx>`
  + `</c:plotArea><c:plotVisOnly val="1"/></c:chart></c:chartSpace>`;

/**
 * Adds native Excel bar charts to RESEARCH_DASHBOARD, sourced from the completion and data-status tables that sheet
 * already wrote. `exceljs`'s streaming WorkbookWriter (needed for the potentially-large ITEM_RESPONSES_LONG sheet)
 * has no chart-writing API at all - a chart is not rendered by any library, it is just a handful of extra OOXML parts
 * (a drawing that positions it + a chart definition referencing a cell range + the relationships linking them), so
 * this reopens the .xlsx `exceljs` already wrote, as a zip (`jszip`, already a transitive dependency of `exceljs`
 * itself for the exact same reason - .xlsx IS a zip), and splices those parts in. The completion-by-participant chart
 * is only added when there is at least one attempt to chart; the data-status chart always has its fixed 3 rows.
 */
async function attachDashboardCharts(filePath, { sheetName, completion, status }) {
  const zip = await JSZip.loadAsync(fs.readFileSync(filePath));

  const workbookXml = await zip.file('xl/workbook.xml').async('string');
  const sheetMatch = new RegExp(`<sheet [^>]*name="${sheetName}"[^>]*r:id="([^"]+)"`).exec(workbookXml);
  if (!sheetMatch) return; // defensive: leave the workbook exactly as exceljs wrote it if the sheet can't be found
  const workbookRels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const targetMatch = new RegExp(`<Relationship Id="${sheetMatch[1]}"[^>]*Target="([^"]+)"`).exec(workbookRels);
  if (!targetMatch) return;
  const sheetPath = `xl/${targetMatch[1].replace(/^\/?xl\//, '')}`; // "xl/worksheets/sheet8.xml"
  const sheetBase = sheetPath.split('/').pop();

  const ref = (r) => `'${sheetName}'!$A$${r.fromRow}:$A$${r.toRow}`;
  const charts = [];
  if (completion) charts.push({ file: 'chart1.xml', xml: barChartXml('Completion by Participant', ref(completion), `'${sheetName}'!$B$${completion.fromRow}:$B$${completion.toRow}`, '0.0%') });
  charts.push({ file: 'chart2.xml', xml: barChartXml('Validation Data Status', ref(status), `'${sheetName}'!$B$${status.fromRow}:$B$${status.toRow}`, 'General') });

  const anchor = (idx, rId) => {
    const fromCol = idx * 6;
    return `<xdr:twoCellAnchor><xdr:from><xdr:col>${fromCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>16</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>`
      + `<xdr:to><xdr:col>${fromCol + 6}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>33</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>`
      + `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${idx + 1}" name="Chart ${idx + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>`
      + `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>`
      + `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="${rId}"/></a:graphicData></a:graphic>`
      + `</xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
  };
  const drawingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
    + `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">`
    + charts.map((c, i) => anchor(i, `rId${i + 1}`)).join('')
    + `</xdr:wsDr>`;
  const drawingRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + charts.map((c, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="charts/${c.file}"/>`).join('')
    + `</Relationships>`;
  const sheetRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>`
    + `</Relationships>`;

  for (const c of charts) zip.file(`xl/drawings/charts/${c.file}`, c.xml);
  zip.file('xl/drawings/drawing1.xml', drawingXml);
  zip.file('xl/drawings/_rels/drawing1.xml.rels', drawingRelsXml);
  zip.file(`xl/worksheets/_rels/${sheetBase}.rels`, sheetRelsXml);

  const sheetXml = await zip.file(sheetPath).async('string');
  zip.file(sheetPath, sheetXml.replace('</worksheet>', '<drawing r:id="rId1"/></worksheet>'));

  const contentTypesPath = '[Content_Types].xml';
  const contentTypesXml = await zip.file(contentTypesPath).async('string');
  const overrides = [`<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`]
    .concat(charts.map((c) => `<Override PartName="/xl/drawings/charts/${c.file}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`))
    .join('');
  zip.file(contentTypesPath, contentTypesXml.replace('</Types>', `${overrides}</Types>`));

  fs.writeFileSync(filePath, await zip.generateAsync({ type: 'nodebuffer' }));
}

/**
 * Writes the workbook to `filePath`. `ctx` = { tx, scope: { attemptIds, santulanIds, sourceSet, cohortFilter }, meta, policy }.
 * Returns { sheets: [{ name, rows }], excluded } - the per-sheet data row counts as written.
 */
async function writeWorkbook(filePath, ctx) {
  const { tx, scope, meta, policy = identity.getPolicy() } = ctx;
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: filePath, useStyles: true, useSharedStrings: false });
  const written = [];
  const excluded = { withdrawn: 0 };

  // Column widths can only be set on a streaming worksheet before its first row is flushed (exceljs writes <cols>
  // right before the first row it commits), so rows are buffered here and only actually written - sized from their
  // own real content, not a guess - in close(). Every sheet but ITEM_RESPONSES_LONG is already pilot-scale, wholly
  // in memory before this point (see the file header comment), so buffering the handful of output rows too is free.
  const newSheet = (name, header) => {
    const ws = { raw: workbook.addWorksheet(name), rows: [], headerRows: new Set() };
    if (header) { ws.headerRows.add(0); ws.rows.push(header); }
    return ws;
  };
  const addRow = (ws, r) => ws.rows.push(r);
  const markHeader = (ws) => ws.headerRows.add(ws.rows.length - 1); // marks the row just pushed
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
  // ITEM_RESPONSES_LONG genuinely streams (can span multiple sheets, unbounded row count) - it can't buffer rows to
  // measure real content width the way the other sheets do, so its known, fixed column set gets sensible fixed
  // widths instead; the header is still styled and written immediately, then data rows stream straight through.
  const newStreamingSheet = (name, header, widths) => {
    const raw = workbook.addWorksheet(name);
    raw.columns = widths.map((w) => ({ width: w }));
    const headerRow = raw.addRow(header);
    styleHeaderRow(headerRow);
    headerRow.commit();
    return raw;
  };
  const closeStreamingSheet = (raw, name, n) => { raw.commit(); written.push({ name, rows: n }); };

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
      addRow(ws, row([
        prId(p.santulan_id), inst ? inst.institution_code : null, coh ? coh.cohort_code : null, p.participation_route,
        p.assessment_track, p.developmental_band, p.administration_language, consentStatusOf(p._id, p.assessment_track), p.status, p.created_at,
      ]));
      participantRows += 1;
    }
    close(ws, 'PARTICIPANTS', participantRows);
  }

  // ---- ITEM_RESPONSES_LONG_nn: stream actual current answers, then synthesise explicit missing rows ----
  const answeredByAttempt = new Map(); // attemptId -> Map(itemCode -> position)
  const IR_HEADER = [
    'research_record_id', 'participant_research_id', 'attempt_id', 'assessment_form', 'assessment_version', 'item_code',
    'domain_code', 'subdomain_code', 'response_value', 'missing_flag', 'response_version', 'is_current', 'response_timestamp', 'time_spent_ms',
  ];
  const IR_WIDTHS = [16, 20, 38, 16, 24, 12, 12, 14, 16, 13, 16, 11, 26, 14];
  let irWs; let irN = 1; let irRows = 0;
  const openIr = () => { irWs = newStreamingSheet(responseSheetName(irN), IR_HEADER, IR_WIDTHS); irRows = 0; };
  const closeIr = () => { closeStreamingSheet(irWs, responseSheetName(irN), irRows); };
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
      const completionPct = expected ? answered / expected : 0;
      attemptSummaries.push({ attemptId: a._id, researchId: prId(p.santulan_id), status: a.status, expected, answered, completionPct, captureClass, flagCount, validationDataStatus: status });
      addRow(ws, row([
        prId(p.santulan_id), a._id, track, set.version_label, a.age_years_at_attempt, a.developmental_band_at_attempt, a.status,
        expected, answered, expected ? Math.round((answered / expected) * 10000) / 10000 : 0, missing, captureClass, flagCount, status, a.submitted_at,
      ]));
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
      addRow(ws, row([f._id, prId(p.santulan_id), f.attempt_id, f.flag_code, f.domain_code, f.severity, f.disposition, f.detected_at, f.reviewed_at]));
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
      addRow(ws, row([
        prId(p.santulan_id), a._id, inst ? inst.institution_code : null, coh ? coh.cohort_code : null, a.age_years_at_attempt, a.developmental_band_at_attempt, track, set.version_label,
        ...expectedItems.map((i) => (answered.has(i.item_code) ? Number(answered.get(i.item_code)) : null)),
      ]));
      n += 1;
    }
    close(ws, sheetName, n);
  }

  // ---- ITEM_CODEBOOK: the full uploaded catalog of this source set (every layer/status, not just CORE) ----
  {
    const cols = ['assessment_form', 'assessment_version', 'item_code', 'domain_code', 'domain_name', 'subdomain_code', 'subdomain_name', 'item_text', 'keying', 'age_band', 'context', 'layer', 'status', 'display_order'];
    const ws = newSheet('ITEM_CODEBOOK', cols);
    for (const i of codebookItems) {
      addRow(ws, row([track, set.version_label, i.item_code, i.domain_code, DOMAIN_NAME[i.domain_code] || null, i.subdomain_code, i.subdomain_name, i.item_text, i.keying, i.age_band, i.context, i.layer, i.status, i.display_order]));
    }
    close(ws, 'ITEM_CODEBOOK', codebookItems.length);
  }

  // ---- RESEARCH_DASHBOARD: a small summary derived from ATTEMPT_SUMMARY above, plus the two tables the two native
  // Excel charts (attached after the workbook is written - streaming exceljs cannot add chart objects itself; see
  // attachDashboardCharts) read their data from. Row positions are tracked as they're written so the chart XML can
  // reference the exact ranges instead of a fixed range sized for the sample's synthetic 6-participant fixture. ----
  let dashboardCharts = null;
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
    let r = dashboardRows.length + 1; // last row written so far (header at row 1 + 6 metric rows)

    addRow(ws, []); r += 1; // blank separator
    addRow(ws, row(['participant_research_id', 'completion_pct'])); markHeader(ws); r += 1;
    const completionStart = r + 1;
    for (const s of attemptSummaries) { addRow(ws, row([s.researchId, s.completionPct])); r += 1; }
    const completionEnd = r;

    addRow(ws, []); r += 1; // blank separator
    addRow(ws, row(['data_status', 'count'])); markHeader(ws); r += 1;
    const statusStart = r + 1;
    for (const st of ['DATA_READY', 'REVIEW', 'NOT_READY']) { addRow(ws, row([st, byStatus(st)])); r += 1; }
    const statusEnd = r;

    dashboardCharts = {
      sheetName: 'RESEARCH_DASHBOARD',
      completion: attemptSummaries.length ? { fromRow: completionStart, toRow: completionEnd } : null,
      status: { fromRow: statusStart, toRow: statusEnd },
    };
    close(ws, 'RESEARCH_DASHBOARD', r);
  }

  await workbook.commit();
  if (dashboardCharts) await attachDashboardCharts(filePath, dashboardCharts);
  return { sheets: written, excluded, totalBytes: fs.statSync(filePath).size };
}

module.exports = { writeWorkbook, responseSheetName };
