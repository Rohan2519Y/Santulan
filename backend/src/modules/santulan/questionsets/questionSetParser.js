/*
 * Spreadsheet reader for question sets (contracts/upload-format.md section 1). Reads an .xlsx buffer into plain rows and
 * reports FILE-level problems; it never stores anything and never executes anything (macros and links are ignored, a cell that
 * holds a formula is refused). Row-level validation is questionSetValidator's job.
 *
 * Returns { errors, warnings, sheetName, columns, rows } where rows = [{ row, cells: { <column>: value } }] (row = sheet row
 * number, header = row 1). Throws HttpError only for the two HTTP-level refusals: 413 UPLOAD_TOO_LARGE and 415 INVALID_FILE_TYPE.
 */
const XLSX = require('xlsx');
const { HttpError } = require('../../../shared/errors');

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_QUESTION_ROWS = 500;
const SHEET = '01_Items';
const REQUIRED_COLUMNS = [
  'item_code', 'assessment_version', 'domain_code', 'domain_name', 'subdomain_code', 'subdomain_name', 'item_text', 'keying', 'age_band',
  'context', 'layer', 'status', 'display_order',
];
const OPTION_COLUMN = /^option_(\d+)$/;
const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

const err = (code, message, extra = {}) => ({ row: null, column: null, code, message, ...extra });

/** Cell value normalised for the validator: trimmed string, number, boolean, or null when blank. */
function cellValue(cell) {
  if (!cell || cell.v === undefined || cell.v === null) return null;
  if (typeof cell.v === 'string') {
    const t = cell.v.trim();
    return t === '' ? null : t;
  }
  return cell.v; // number | boolean | Date | error - the validator decides whether the type is acceptable
}

function parseQuestionWorkbook(buffer, { fileName = '' } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return { errors: [err('FILE_UNREADABLE', 'The file is empty or could not be read')], warnings: [], columns: [], rows: [], sheetName: null };
  if (buffer.length > MAX_BYTES) throw new HttpError(413, 'UPLOAD_TOO_LARGE', 'The file is larger than 2 MB');
  if (!/\.xlsx$/i.test(fileName) || !buffer.subarray(0, 4).equals(ZIP_SIGNATURE)) throw new HttpError(415, 'INVALID_FILE_TYPE', 'Upload an .xlsx workbook');

  let wb;
  try {
    // sheetRows caps what is read: header + 500 questions + 2 extra rows to detect "too many"; cellFormula keeps formulas visible.
    wb = XLSX.read(buffer, { type: 'buffer', cellFormula: true, cellDates: false, bookVBA: false, sheetRows: MAX_QUESTION_ROWS + 3 });
  } catch (e) {
    return { errors: [err('FILE_UNREADABLE', 'The file could not be read as an Excel workbook')], warnings: [], columns: [], rows: [], sheetName: null };
  }
  const sheetName = wb.SheetNames.includes(SHEET) ? SHEET : wb.SheetNames[0];
  const ws = sheetName ? wb.Sheets[sheetName] : null;
  if (!ws || !ws['!ref']) return { errors: [err('SHEET_NOT_FOUND', `The workbook has no sheet named ${SHEET} and no readable first sheet`)], warnings: [], columns: [], rows: [], sheetName };

  const errors = [];
  const warnings = [];
  const range = XLSX.utils.decode_range(ws['!ref']);

  // header (row 1): names matched case-insensitively after trimming
  const columns = []; // [{ index, name }]
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const v = cellValue(ws[XLSX.utils.encode_cell({ r: range.s.r, c })]);
    if (v !== null) columns.push({ index: c, name: String(v).trim().toLowerCase() });
  }
  const names = new Set(columns.map((c) => c.name));
  const optionCols = columns.filter((c) => OPTION_COLUMN.test(c.name));
  if (!optionCols.length) {
    errors.push(err('OLD_FORMAT_NOT_SUPPORTED', 'This file has no option_1, option_2 ... columns. The previous workbook format without answer options is no longer accepted; download the template from the question sets page.'));
  }
  for (const req of REQUIRED_COLUMNS) {
    if (!names.has(req)) errors.push(err('HEADER_MISSING_COLUMN', `The column "${req}" is missing`, { column: req }));
  }
  for (const col of columns) {
    if (!REQUIRED_COLUMNS.includes(col.name) && !OPTION_COLUMN.test(col.name)) warnings.push({ row: 1, column: col.name, code: 'UNKNOWN_COLUMN_IGNORED', message: `The column "${col.name}" is not part of the format and was ignored` });
  }

  const rows = [];
  let questionRows = 0;
  for (let r = range.s.r + 1; r <= range.e.r; r += 1) {
    const sheetRow = r + 1;
    const cells = {};
    let any = false;
    for (const col of columns) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: col.index })];
      if (cell && cell.f !== undefined) {
        errors.push({ row: sheetRow, column: col.name, code: 'FORMULA_NOT_ALLOWED', message: 'Formulas are not allowed; enter the value as plain text' });
        any = true;
        continue;
      }
      const v = cellValue(cell);
      if (v !== null) any = true;
      cells[col.name] = v;
    }
    if (!any) {
      warnings.push({ row: sheetRow, column: null, code: 'EMPTY_ROW_SKIPPED', message: 'An empty row was skipped' });
      continue;
    }
    questionRows += 1;
    if (questionRows > MAX_QUESTION_ROWS) continue; // counted, not kept
    rows.push({ row: sheetRow, cells });
  }
  if (questionRows > MAX_QUESTION_ROWS) errors.push(err('TOO_MANY_ROWS', `The file has more than ${MAX_QUESTION_ROWS} question rows`));
  if (questionRows === 0 && !errors.some((e) => e.code === 'HEADER_MISSING_COLUMN' || e.code === 'OLD_FORMAT_NOT_SUPPORTED')) errors.push(err('NO_ROWS', 'The file has no question rows'));

  return { errors, warnings, sheetName, columns: columns.map((c) => c.name), rows };
}

module.exports = { parseQuestionWorkbook, REQUIRED_COLUMNS, OPTION_COLUMN, MAX_BYTES, MAX_QUESTION_ROWS, SHEET };
