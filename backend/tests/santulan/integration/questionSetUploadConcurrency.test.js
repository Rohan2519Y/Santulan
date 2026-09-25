/* Concurrent question-set uploads (G-19, G-18). */
const service = require('../../../src/services/questionsets/questionSetService');
const { closeClient } = require('../../../src/models/db/client');
const f = require('../helpers/committed');
const H = require('../helpers/mongoHarness');
const W = require('../helpers/questionWorkbook');

let admin;
beforeAll(async () => { admin = await f.admin(); });
afterAll(async () => { await f.cleanupFixtures(); await closeClient(); await H.closeAll(); });

const label = () => `fx-conc-${f.u().toLowerCase()}`;
const up = (buf) => service.upload({ buffer: buf, fileName: 'q.xlsx', ageGroup: 'ADOLESCENT', actor: { adminUserId: admin.adminUserId } });

describe('G-19 two admins upload the same new label at the same moment', () => {
  test('G-19 identical content: exactly one draft exists, the loser is told it already exists (200 created:false)', async () => {
    const lbl = label();
    const buf = W.workbook(W.validRows({ label: lbl }));
    const results = await Promise.all([up(buf), up(buf), up(buf)]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 200 && r.body.created === false)).toHaveLength(2);
    expect(await (await f.db()).collection('assessment_versions').countDocuments({ version_label: lbl })).toBe(1);
    expect(await (await f.db()).collection('items').countDocuments({ assessment_version_id: results[0].body.setId })).toBe(7);
  });

  test('G-19 different content: one live draft remains, older revisions are RETIRED, nothing is lost', async () => {
    const lbl = label();
    const a = W.validRows({ label: lbl }); a[0].cells.item_text += ' A';
    const b = W.validRows({ label: lbl }); b[0].cells.item_text += ' B';
    const settled = await Promise.allSettled([up(W.workbook(a)), up(W.workbook(b))]);
    expect(settled.filter((s) => s.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    const revs = await (await f.db()).collection('assessment_versions').find({ version_label: lbl }).toArray();
    expect(revs.filter((r) => r.status === 'DRAFT')).toHaveLength(1);
    expect(revs.filter((r) => r.status === 'RETIRED').length).toBe(revs.length - 1);
  });
});

describe('G-18 a failure after the set insert leaves neither set nor questions', () => {
  test('G-18 a failing audit insert aborts the whole upload', async () => {
    const lbl = label();
    await expect(service.upload({ buffer: W.workbook(W.validRows({ label: lbl })), fileName: 'q.xlsx', ageGroup: 'ADOLESCENT', actor: { adminUserId: 'bad-actor-id' } })).rejects.toMatchObject({ status: 503, code: 'AUDIT_UNAVAILABLE' });
    expect(await (await f.db()).collection('assessment_versions').countDocuments({ version_label: lbl })).toBe(0);
  });
});

describe('a 500-question file completes inside one transaction', () => {
  test('500 questions with 5 options each are stored together', async () => {
    const lbl = label();
    const base = W.validRows({ label: lbl });
    const rows = Array.from({ length: 500 }, (_, i) => {
      const src = base[i % 7];
      const dom = src.cells.domain_code;
      return { cells: { ...src.cells, item_code: `${dom}-${String(Math.floor(i / 7) % 100).padStart(2, '0')}`, display_order: i + 1, item_text: `Long set question ${i + 1}` }, options: src.options };
    });
    // codes repeat after 100 per domain: keep them unique by using 71 per domain at most (500 / 7)
    const seen = new Set();
    rows.forEach((r, i) => { let k = i; while (seen.has(r.cells.item_code)) { k += 1; r.cells.item_code = `${r.cells.domain_code}-${String(k % 100).padStart(2, '0')}`; } seen.add(r.cells.item_code); });
    const started = Date.now();
    const r = await up(W.workbook(rows));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ questionCount: 500, optionCount: 2500 });
    const ms = Date.now() - started;
    expect(ms).toBeLessThan(30000);
    // informational evidence (SC-002: a set is reviewable within a minute); never a PASS/FAIL matrix entry
    const fs = require('fs');
    const path = require('path');
    const reg = path.join(__dirname, '..', 'evidence', 'register.json');
    let cur = {};
    try { cur = JSON.parse(fs.readFileSync(reg, 'utf8')); } catch (e) { /* first run */ }
    cur['INFO-SC-002-upload-500'] = { id: 'INFO-SC-002-upload-500', status: 'INFORMATIONAL', note: '500 questions x 5 options, upload + validate + transactional write (one process, local replica set)', durationMs: ms, runAt: new Date().toISOString() };
    fs.writeFileSync(reg, `${JSON.stringify(cur, null, 2)}
`);
  });
});
