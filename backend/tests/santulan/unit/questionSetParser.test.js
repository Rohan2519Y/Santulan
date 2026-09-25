/* Question workbook reader (contracts/upload-format.md section 1, section 3.1). Pure: no database. */
const { parseQuestionWorkbook, MAX_QUESTION_ROWS } = require('../../../src/services/questionsets/questionSetParser');
const W = require('../helpers/questionWorkbook');

const parse = (buf, name = 'q.xlsx') => parseQuestionWorkbook(buf, { fileName: name });
const codes = (r) => r.errors.map((e) => e.code);

describe('file checks', () => {
  test('a file over 2 MB is 413 UPLOAD_TOO_LARGE', () => {
    expect(() => parse(Buffer.alloc(2 * 1024 * 1024 + 1))).toThrow(expect.objectContaining({ status: 413, code: 'UPLOAD_TOO_LARGE' }));
  });
  test('a non-.xlsx name or a missing ZIP signature is 415 INVALID_FILE_TYPE', () => {
    const good = W.workbook(W.validRows());
    expect(() => parse(good, 'q.csv')).toThrow(expect.objectContaining({ status: 415, code: 'INVALID_FILE_TYPE' }));
    expect(() => parse(Buffer.from('not a zip file at all'), 'q.xlsx')).toThrow(expect.objectContaining({ status: 415 }));
  });
  test('an empty file is FILE_UNREADABLE', () => {
    expect(codes(parse(Buffer.alloc(0)))).toEqual(['FILE_UNREADABLE']);
  });
  test('a corrupt archive with the right signature is FILE_UNREADABLE', () => {
    expect(codes(parse(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('garbage-garbage-garbage')])))).toContain('FILE_UNREADABLE');
  });
});

describe('sheet and header', () => {
  test('the sheet 01_Items is used; otherwise the first sheet', () => {
    const named = parse(W.workbook(W.validRows(), { sheetName: '01_Items' }));
    expect(named.sheetName).toBe('01_Items');
    const other = parse(W.workbook(W.validRows(), { sheetName: 'Questions' }));
    expect(other.sheetName).toBe('Questions');
    expect(other.errors).toEqual([]);
  });
  test('header names are matched case-insensitively after trimming', () => {
    const header = W.HEADER.map((h, i) => (i % 2 ? ` ${h.toUpperCase()} ` : h));
    const rows = W.validRows().map((x) => ({ cells: Object.fromEntries(header.map((h, i) => [h, x.cells[W.HEADER[i]]])), options: x.options }));
    const r = parse(W.workbook(rows, { header }));
    expect(r.errors).toEqual([]);
    expect(r.columns).toEqual(expect.arrayContaining(W.HEADER));
  });
  test('a missing required column is HEADER_MISSING_COLUMN naming it', () => {
    const header = W.HEADER.filter((h) => h !== 'context');
    const r = parse(W.workbook(W.validRows(), { header }));
    expect(r.errors.filter((e) => e.code === 'HEADER_MISSING_COLUMN')).toEqual([expect.objectContaining({ column: 'context' })]);
  });
  test('a file with no option_* column at all is OLD_FORMAT_NOT_SUPPORTED', () => {
    const r = parse(W.workbook(W.validRows(), { optionColumns: 0 }));
    expect(codes(r)).toContain('OLD_FORMAT_NOT_SUPPORTED');
  });
  test('the previous TECH_READY workbook is refused', () => {
    const r = parse(W.oldFormatFile(), 'old.xlsx');
    expect(r.errors.length).toBeGreaterThan(0);
  });
  test('unknown columns are ignored with a warning', () => {
    const r = parse(W.workbook(W.validRows(), { extraColumns: ['reviewer_notes'] }));
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'UNKNOWN_COLUMN_IGNORED', column: 'reviewer_notes' })]));
  });
});

describe('rows', () => {
  const many = (n) => {
    const base = W.validRows()[0];
    return Array.from({ length: n }, (_, i) => ({ cells: { ...base.cells, item_code: `C1-${String(i % 100).padStart(2, '0')}`, display_order: i + 1 }, options: base.options }));
  };
  test('more than 500 question rows is TOO_MANY_ROWS', () => {
    expect(codes(parse(W.workbook(many(MAX_QUESTION_ROWS + 1))))).toContain('TOO_MANY_ROWS');
  });
  test('exactly 500 rows is accepted', () => {
    const r = parse(W.workbook(many(MAX_QUESTION_ROWS)));
    expect(codes(r)).not.toContain('TOO_MANY_ROWS');
    expect(r.rows).toHaveLength(MAX_QUESTION_ROWS);
  });
  test('completely empty rows are skipped with a warning', () => {
    const rows = W.validRows();
    const withBlank = [rows[0], W.HEADER.map(() => ''), ...rows.slice(1)];
    const r = parse(W.workbook(withBlank));
    expect(r.warnings.filter((w) => w.code === 'EMPTY_ROW_SKIPPED')).toHaveLength(1);
    expect(r.rows).toHaveLength(rows.length);
  });
  test('a cell that holds a formula is FORMULA_NOT_ALLOWED, but text that merely starts with = + - @ is kept', () => {
    const rows = W.validRows();
    const r = parse(W.workbook(rows, { formulaAt: { cell: 'G2', f: 'SUM(1,2)' } }));
    expect(r.errors).toEqual([expect.objectContaining({ code: 'FORMULA_NOT_ALLOWED', row: 2, column: 'item_text' })]);
    const texty = rows.map((x, i) => (i === 0 ? { ...x, cells: { ...x.cells, item_text: '=not a formula, just text' } } : x));
    const ok = parse(W.workbook(texty));
    expect(ok.errors).toEqual([]);
    expect(ok.rows[0].cells.item_text).toBe('=not a formula, just text');
  });
  test('the en dash in age bands is preserved and text is trimmed', () => {
    const rows = W.validRows().map((x, i) => (i === 0 ? { ...x, cells: { ...x.cells, item_text: '   padded   ' } } : x));
    const r = parse(W.workbook(rows));
    expect(r.rows[0].cells.age_band).toBe(`13${W.EN}17`);
    expect(r.rows[0].cells.item_text).toBe('padded');
  });
  test('the sample workbook of the docs folder reads with no file-level errors', () => {
    const r = parse(W.sampleFile(), 'Santulan_Sample_Questions.xlsx');
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(10);
  });
});
