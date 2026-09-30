/* Question set validation (contracts/upload-format.md sections 2, 3.2, 3.3; SC-002, SC-003). Pure: no database. */
const { parseQuestionWorkbook } = require('../../../src/services/questionsets/questionSetParser');
const { validate } = require('../../../src/services/questionsets/questionSetValidator');
const W = require('../helpers/questionWorkbook');

const run = (rows, ageGroup = 'ADOLESCENT', opts) => {
  const parsed = parseQuestionWorkbook(W.workbook(rows, opts), { fileName: 'q.xlsx' });
  const checked = validate({ rows: parsed.rows, columns: parsed.columns, ageGroup });
  return { ...checked, parseErrors: parsed.errors, parseWarnings: parsed.warnings };
};
const codes = (r) => r.errors.map((e) => e.code);
/** Replace cells of the first valid row and validate. */
const withCells = (cells, options, ageGroup) => {
  const rows = W.validRows();
  rows[0] = { cells: { ...rows[0].cells, ...cells }, options: options || rows[0].options };
  return run(rows, ageGroup);
};

describe('a valid file', () => {
  test('SC-002 validates with no errors and yields normalised questions', () => {
    const r = run(W.validRows());
    expect(r.errors).toEqual([]);
    expect(r.questions).toHaveLength(7);
    expect(r.questions[0]).toMatchObject({ keying: 'POSITIVE', layer: 'CORE', status: 'ACTIVE', pilot_status: 'READY' });
    expect(r.questions[0].options).toEqual(W.STANDARD.map((text, i) => ({ position: i + 1, text })));
    expect(r.versionLabel).toBe('fx-upload-set-v1');
  });
  test('the sample workbook validates against ADOLESCENT with no errors and no domain warning', () => {
    const parsed = parseQuestionWorkbook(W.sampleFile(), { fileName: 'Santulan_Sample_Questions.xlsx' });
    const r = validate({ rows: parsed.rows, columns: parsed.columns, ageGroup: 'ADOLESCENT' });
    expect(r.errors).toEqual([]);
    expect(r.questions).toHaveLength(10);
    expect(r.warnings.filter((w) => w.code === 'DOMAIN_WITHOUT_QUESTIONS')).toEqual([]);
  });
  test('an emerging-adult file with 18-25 and College/Work questions validates', () => {
    expect(run(W.validRows({ ageGroup: 'EMERGING_ADULT' }), 'EMERGING_ADULT').errors).toEqual([]);
  });
  test('a variable number of options per question (2, 3, 9, 20) is accepted and order is kept', () => {
    const rows = W.validRows();
    const opts = (n) => Array.from({ length: n }, (_, i) => `Choice ${i + 1}`);
    [2, 3, 9, 20].forEach((n, i) => { rows[i] = { ...rows[i], options: opts(n) }; });
    const r = run(rows);
    expect(r.errors).toEqual([]);
    expect(r.questions.slice(0, 4).map((q) => q.options.length)).toEqual([2, 3, 9, 20]);
    expect(r.questions[3].options[19]).toEqual({ position: 20, text: 'Choice 20' });
  });
  test('a blank middle option cell is skipped and the rest keep their order', () => {
    const rows = W.validRows();
    rows[0] = { ...rows[0], options: ['Never', '', 'Often', 'Always'] };
    const r = run(rows);
    expect(r.errors).toEqual([]);
    expect(r.questions[0].options).toEqual([{ position: 1, text: 'Never' }, { position: 2, text: 'Often' }, { position: 3, text: 'Always' }]);
  });
});

describe('each problem code fires (row and column reported)', () => {
  test('REQUIRED_VALUE_MISSING and CELL_TYPE_INVALID', () => {
    expect(withCells({ item_text: '' }).errors).toContainEqual(expect.objectContaining({ code: 'REQUIRED_VALUE_MISSING', column: 'item_text', row: 2 }));
    expect(codes(withCells({ item_text: 42 }))).toContain('CELL_TYPE_INVALID');
    expect(codes(withCells({ display_order: 'first' }))).toContain('CELL_TYPE_INVALID');
  });
  test('ITEM_CODE_INVALID and ITEM_CODE_DUPLICATE', () => {
    for (const bad of ['C8-01', 'C1-1', 'X1-01', 'c1-01', 'C1-001']) expect(codes(withCells({ item_code: bad }))).toContain('ITEM_CODE_INVALID');
    const rows = W.validRows();
    rows[1] = { ...rows[1], cells: { ...rows[1].cells, item_code: rows[0].cells.item_code, domain_code: 'C1', domain_name: rows[0].cells.domain_name, subdomain_code: 'C1.1', subdomain_name: rows[0].cells.subdomain_name } };
    expect(run(rows).errors).toContainEqual(expect.objectContaining({ code: 'ITEM_CODE_DUPLICATE', row: 3 }));
  });
  test('the item code prefix must equal the domain code', () => {
    expect(codes(withCells({ item_code: 'C2-05' }))).toContain('ITEM_CODE_INVALID');
  });
  test('VERSION_LABEL_INVALID and VERSION_LABEL_INCONSISTENT', () => {
    for (const bad of ['Has Space', 'UPPER', 'ab', '-lead', 'x'.repeat(65)]) expect(codes(withCells({ assessment_version: bad }))).toContain('VERSION_LABEL_INVALID');
    const rows = W.validRows();
    rows[2] = { ...rows[2], cells: { ...rows[2].cells, assessment_version: 'another-label-v1' } };
    expect(run(rows).errors).toContainEqual(expect.objectContaining({ code: 'VERSION_LABEL_INCONSISTENT', row: 4 }));
  });
  test('DOMAIN_CODE_UNKNOWN, DOMAIN_NAME_MISMATCH', () => {
    expect(codes(withCells({ domain_code: 'C9', item_code: 'C9-01' }))).toContain('DOMAIN_CODE_UNKNOWN');
    expect(codes(withCells({ domain_name: 'Body and Self Regulation' }))).toContain('DOMAIN_NAME_MISMATCH');
  });
  test('SUBDOMAIN_CODE_UNKNOWN (C7.1, C4.6), SUBDOMAIN_NAME_MISMATCH, SUBDOMAIN_DOMAIN_MISMATCH', () => {
    expect(codes(withCells({ subdomain_code: 'C7.1' }))).toContain('SUBDOMAIN_CODE_UNKNOWN');
    expect(codes(withCells({ subdomain_code: 'C4.6' }))).toContain('SUBDOMAIN_CODE_UNKNOWN');
    expect(codes(withCells({ subdomain_name: 'Wrong Name' }))).toContain('SUBDOMAIN_NAME_MISMATCH');
    expect(codes(withCells({ subdomain_code: 'C2.1', subdomain_name: 'Emotion Awareness' }))).toContain('SUBDOMAIN_DOMAIN_MISMATCH');
  });
  test('ITEM_TEXT_TOO_LONG above 500 characters', () => {
    expect(codes(withCells({ item_text: 'x'.repeat(501) }))).toContain('ITEM_TEXT_TOO_LONG');
    expect(codes(withCells({ item_text: 'x'.repeat(500) }))).not.toContain('ITEM_TEXT_TOO_LONG');
  });
  test('KEYING_NOT_SUPPORTED for REVERSE and anything but Positive', () => {
    for (const k of ['REVERSE', 'Reverse', 'Negative', 'x']) expect(codes(withCells({ keying: k }))).toContain('KEYING_NOT_SUPPORTED');
    expect(codes(withCells({ keying: 'positive' }))).not.toContain('KEYING_NOT_SUPPORTED');
  });
  test('AGE_BAND_INVALID and AGE_BAND_DOES_NOT_FIT_GROUP', () => {
    expect(codes(withCells({ age_band: '13-17' }))).toContain('AGE_BAND_INVALID'); // hyphen, not the en dash
    expect(codes(withCells({ age_band: `18${W.EN}25` }))).toContain('AGE_BAND_DOES_NOT_FIT_GROUP');
    expect(codes(withCells({ age_band: `13${W.EN}17` }, undefined, 'EMERGING_ADULT'))).toContain('AGE_BAND_DOES_NOT_FIT_GROUP');
  });
  test('CONTEXT_INVALID and CONTEXT_DOES_NOT_FIT_GROUP', () => {
    expect(codes(withCells({ context: 'Home' }))).toContain('CONTEXT_INVALID');
    expect(codes(withCells({ context: 'College/Work' }))).toContain('CONTEXT_DOES_NOT_FIT_GROUP');
    expect(codes(withCells({ context: 'School' }, undefined, 'EMERGING_ADULT'))).toContain('CONTEXT_DOES_NOT_FIT_GROUP');
  });
  test('LAYER_NOT_SUPPORTED (V, SJT, O)', () => {
    for (const l of ['V', 'SJT', 'O']) expect(codes(withCells({ layer: l }))).toContain('LAYER_NOT_SUPPORTED');
  });
  test('a status other than READY is not a file-level error - the row is accepted but the item starts hidden (RETIRED), not shown (ACTIVE)', () => {
    for (const s of ['DRAFT', 'PILOT', 'RETIRED', 'review']) {
      const r = withCells({ status: s });
      expect(r.errors).toEqual([]);
      expect(r.questions[0]).toMatchObject({ status: 'RETIRED', pilot_status: s.toUpperCase() });
    }
  });
  test('DISPLAY_ORDER_INVALID and DISPLAY_ORDER_DUPLICATE (gaps are allowed)', () => {
    for (const o of [0, -1, 1.5]) expect(codes(withCells({ display_order: o }))).toContain('DISPLAY_ORDER_INVALID');
    const rows = W.validRows();
    rows[1] = { ...rows[1], cells: { ...rows[1].cells, display_order: rows[0].cells.display_order } };
    expect(run(rows).errors).toContainEqual(expect.objectContaining({ code: 'DISPLAY_ORDER_DUPLICATE', row: 3 }));
    const gaps = W.validRows();
    gaps.forEach((g, i) => { g.cells.display_order = (i + 1) * 10; });
    expect(run(gaps).errors).toEqual([]);
  });
  test('OPTIONS_TOO_FEW, OPTIONS_TOO_MANY, OPTION_TEXT_TOO_LONG, OPTION_DUPLICATE', () => {
    expect(codes(withCells({}, ['Only one']))).toContain('OPTIONS_TOO_FEW');
    expect(codes(withCells({}, []))).toContain('OPTIONS_TOO_FEW');
    expect(codes(withCells({}, Array.from({ length: 21 }, (_, i) => `Option ${i + 1}`)))).toContain('OPTIONS_TOO_MANY');
    expect(codes(withCells({}, ['x'.repeat(201), 'ok']))).toContain('OPTION_TEXT_TOO_LONG');
    expect(codes(withCells({}, ['x'.repeat(200), 'ok']))).not.toContain('OPTION_TEXT_TOO_LONG');
    expect(codes(withCells({}, ['Often', ' often ', 'Never']))).toContain('OPTION_DUPLICATE'); // case-insensitive and trimmed
  });
  test('AGE_GROUP_REQUIRED when the age group is missing', () => {
    expect(codes(run(W.validRows(), null))).toContain('AGE_GROUP_REQUIRED');
    expect(codes(run(W.validRows(), 'TEEN'))).toContain('AGE_GROUP_REQUIRED');
  });
});

describe('everything is reported in one pass', () => {
  test('SC-003 five deliberate mistakes in five rows give five (or more) problems and no question is accepted from a bad row', () => {
    const rows = W.validRows({ perDomain: 1 });
    rows[0].cells.keying = 'REVERSE';
    rows[1].cells.item_code = rows[0].cells.item_code;
    rows[2].options = ['Only one'];
    rows[3].cells.age_band = `18${W.EN}25`;
    rows[4].cells.subdomain_code = 'C7.1';
    const r = run(rows);
    expect(new Set(codes(r))).toEqual(new Set(['KEYING_NOT_SUPPORTED', 'ITEM_CODE_DUPLICATE', 'OPTIONS_TOO_FEW', 'AGE_BAND_DOES_NOT_FIT_GROUP', 'SUBDOMAIN_CODE_UNKNOWN', 'ITEM_CODE_INVALID', 'SUBDOMAIN_DOMAIN_MISMATCH', 'SUBDOMAIN_NAME_MISMATCH'].filter((c) => codes(r).includes(c))));
    expect(r.errors.length).toBeGreaterThanOrEqual(5);
    expect(r.errors.map((e) => e.row)).toEqual(expect.arrayContaining([2, 3, 4, 5, 6]));
    expect(r.errors.every((e) => e.code && e.message)).toBe(true);
  });
  test('warnings: a domain without any question', () => {
    const rows = W.validRows().filter((x) => x.cells.domain_code !== 'C3');
    const r = run(rows);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toContainEqual(expect.objectContaining({ code: 'DOMAIN_WITHOUT_QUESTIONS' }));
  });
});
