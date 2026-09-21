/* Canonical form and hashes (contracts/upload-format.md section 6). Pure. */
const crypto = require('crypto');
const canonical = require('../../../src/modules/santulan/questionsets/canonical');
const { buildTemplate } = require('../../../src/modules/santulan/questionsets/template');
const { parseQuestionWorkbook } = require('../../../src/modules/santulan/questionsets/questionSetParser');
const { validate } = require('../../../src/modules/santulan/questionsets/questionSetValidator');
const W = require('../helpers/questionWorkbook');

const questions = (rows = W.validRows()) => {
  const parsed = parseQuestionWorkbook(W.workbook(rows), { fileName: 'q.xlsx' });
  return validate({ rows: parsed.rows, columns: parsed.columns, ageGroup: 'ADOLESCENT' }).questions;
};

describe('content_hash', () => {
  test('it is the SHA-256 of the canonical JSON and is independent of row order', () => {
    const qs = questions();
    const h = canonical.contentHash(qs);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(canonical.contentHash([...qs].reverse())).toBe(h);
    const expectedJson = canonical.canonicalJson(canonical.canonicalQuestions(qs));
    expect(h).toBe(crypto.createHash('sha256').update(expectedJson, 'utf8').digest('hex'));
  });
  test('it is independent of column order, spacing and the file bytes', () => {
    const rows = W.validRows();
    const shuffled = [...W.HEADER].reverse();
    const reordered = rows.map((r) => ({ cells: Object.fromEntries(shuffled.map((h) => [h, r.cells[h]])), options: r.options }));
    const a = canonical.contentHash(questions(rows));
    const parsed = parseQuestionWorkbook(W.workbook(reordered, { header: shuffled }), { fileName: 'q.xlsx' });
    const b = canonical.contentHash(validate({ rows: parsed.rows, columns: parsed.columns, ageGroup: 'ADOLESCENT' }).questions);
    expect(b).toBe(a);
    const padded = rows.map((r) => ({ ...r, cells: { ...r.cells, item_text: `  ${r.cells.item_text}  ` } }));
    expect(canonical.contentHash(questions(padded))).toBe(a);
  });
  test('any change in a question, an option or the order changes the hash', () => {
    const base = canonical.contentHash(questions());
    const text = W.validRows(); text[0].cells.item_text += '!';
    const opt = W.validRows(); opt[0].options = ['Never', 'Rarely', 'Sometimes', 'Often', 'Always'];
    const order = W.validRows(); order[0].cells.display_order = 99;
    for (const changed of [text, opt, order]) expect(canonical.contentHash(questions(changed))).not.toBe(base);
  });
  test('source_file_hash is the SHA-256 of the file bytes', () => {
    const buf = W.workbook(W.validRows());
    expect(canonical.fileHash(buf)).toBe(crypto.createHash('sha256').update(buf).digest('hex'));
  });
});

describe('ids', () => {
  test('item and set ids are deterministic UUIDv5s: an identical re-upload yields identical ids', () => {
    const a = canonical.itemId('set-1', 'C1-01');
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(canonical.itemId('set-1', 'C1-01')).toBe(a);
    expect(canonical.itemId('set-1', 'C1-02')).not.toBe(a);
    expect(canonical.itemId('set-2', 'C1-01')).not.toBe(a);
    expect(canonical.setId('label-v1', 1)).toBe(canonical.setId('label-v1', 1));
    expect(canonical.setId('label-v1', 2)).not.toBe(canonical.setId('label-v1', 1));
  });
  test('item_content_hash covers the text and the options', () => {
    const [q] = questions();
    const h = canonical.itemContentHash(q);
    expect(canonical.itemContentHash({ ...q, item_text: q.item_text + '.' })).not.toBe(h);
    expect(canonical.itemContentHash({ ...q, options: q.options.slice(0, 3) })).not.toBe(h);
    expect(canonical.itemContentHash({ ...q })).toBe(h);
  });
});

describe('template', () => {
  test('the generated template has 3 example rows with the five standard options and validates with 0 errors', () => {
    const parsed = parseQuestionWorkbook(buildTemplate(), { fileName: 'template.xlsx' });
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(3);
    const r = validate({ rows: parsed.rows, columns: parsed.columns, ageGroup: 'ADOLESCENT' });
    expect(r.errors).toEqual([]);
    expect(r.versionLabel).toBe('example-adolescent-v1');
    expect(r.questions.every((q) => q.options.map((o) => o.text).join('|') === W.STANDARD.join('|'))).toBe(true);
  });
});
