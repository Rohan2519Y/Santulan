/* Question-set upload over HTTP (US2 acceptance 1-6; B08 analogue). Scratch database, real app, runtime credential. */
const request = require('supertest');
const app = require('../../../src/app');
const { closeClient } = require('../../../src/modules/santulan/store/client');
const f = require('../helpers/committed');
const H = require('../helpers/mongoHarness');
const W = require('../helpers/questionWorkbook');
const canonical = require('../../../src/modules/santulan/questionsets/canonical');

let admin;
beforeAll(async () => { admin = await f.admin(); });
afterAll(async () => { await f.cleanupFixtures(); await closeClient(); await H.closeAll(); });

const post = (token, buf, { ageGroup = 'ADOLESCENT', name = 'q.xlsx' } = {}) => {
  const r = request(app).post('/api/v1/admin/question-sets');
  if (token) r.set('Authorization', `Bearer ${token}`);
  if (ageGroup) r.field('ageGroup', ageGroup);
  return r.attach('file', buf, name);
};
const label = () => `fx-http-${f.u().toLowerCase()}`;
const audits = async (type) => (await f.db()).collection('audit_logs').find({ action_type: type }).toArray();

describe('US2 acceptance 1: the sample file becomes a draft set', () => {
  test('SC-001 upload docs/Santulan_Sample_Questions.xlsx as ADOLESCENT -> 201, 10 questions, 50 options, DRAFT/CLOSED, one audit row', async () => {
    const db = await f.db();
    // the sample carries the label santulan-adolescent-pilot-v3.1; the scratch database seeds no set, so it is new here.
    // (a previous run's rows are removed by cleanup only for fx- labels, so rewrite the label to stay independent)
    const XLSX = require('xlsx');
    const wb = XLSX.read(W.sampleFile(), { type: 'buffer' });
    const ws = wb.Sheets['01_Items'];
    const lbl = label();
    for (let r = 2; r <= 11; r += 1) ws[`B${r}`] = { t: 's', v: lbl };
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const before = (await audits('QUESTION_SET_UPLOADED')).length;
    const res = await post(admin.token, buf, { name: 'Santulan_Sample_Questions.xlsx' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ versionLabel: lbl, revision: 1, ageGroup: 'ADOLESCENT', status: 'DRAFT', participationState: 'CLOSED', questionCount: 10, optionCount: 50, created: true });
    expect(res.body.warnings.filter((w) => w.code === 'DOMAIN_WITHOUT_QUESTIONS')).toEqual([]);
    expect(res.body.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const rows = await audits('QUESTION_SET_UPLOADED');
    expect(rows).toHaveLength(before + 1);
    const mine = rows.find((a) => a.target_id === res.body.setId);
    expect(mine.new_state.fileSha256).toBe(canonical.fileHash(buf));
    expect(await db.collection('items').countDocuments({ assessment_version_id: res.body.setId })).toBe(10);
  });

  test('a second identical upload is 200 created:false with the same set', async () => {
    const lbl = label();
    const buf = W.workbook(W.validRows({ label: lbl }));
    const first = await post(admin.token, buf);
    const again = await post(admin.token, buf);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ created: false, setId: first.body.setId });
  });

  test('the response never carries the file bytes, and the file is not kept anywhere', async () => {
    const res = await post(admin.token, W.workbook(W.validRows({ label: label() })));
    expect(JSON.stringify(res.body)).not.toMatch(/PK\u0003\u0004/);
    expect(Object.keys(res.body).sort()).toEqual(['ageGroup', 'contentHash', 'createdAt', 'created', 'frozenAt', 'optionCount', 'participationState', 'questionCount', 'revision', 'setId', 'sourceFileHash', 'status', 'supersededRevision', 'versionLabel', 'warnings'].sort());
  });
});

describe('US2 acceptance 3: a bad file saves nothing and lists every problem', () => {
  test('REVERSE keying + a repeated item_code + one option left + a formula cell -> 422 with row and column, no set, one rejection audit', async () => {
    const lbl = label();
    const rows = W.validRows({ label: lbl });
    rows[0].cells.keying = 'REVERSE';
    rows[1].cells.item_code = rows[0].cells.item_code;
    rows[2].options = ['Only one'];
    const before = (await audits('QUESTION_SET_UPLOAD_REJECTED')).length;
    const res = await post(admin.token, W.workbook(rows, { formulaAt: { cell: 'G6', f: 'SUM(1,2)' } }));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('UPLOAD_VALIDATION_FAILED');
    expect(res.body.error.totalProblems).toBeGreaterThanOrEqual(4);
    const got = res.body.error.details.map((d) => d.code);
    expect(got).toEqual(expect.arrayContaining(['KEYING_NOT_SUPPORTED', 'ITEM_CODE_DUPLICATE', 'OPTIONS_TOO_FEW', 'FORMULA_NOT_ALLOWED']));
    for (const d of res.body.error.details) expect(d).toMatchObject({ code: expect.any(String), message: expect.any(String) });
    expect(res.body.error.details.find((d) => d.code === 'KEYING_NOT_SUPPORTED')).toMatchObject({ row: 2, column: 'keying' });
    const db = await f.db();
    expect(await db.collection('assessment_versions').countDocuments({ version_label: lbl })).toBe(0);
    const rej = await audits('QUESTION_SET_UPLOAD_REJECTED');
    expect(rej).toHaveLength(before + 1);
    expect(rej[rej.length - 1].new_state.problemCount).toBe(res.body.error.totalProblems);
    expect(JSON.stringify(rej[rej.length - 1])).not.toContain('Question text');
  });

  test('the old 13-column workbook is refused as OLD_FORMAT_NOT_SUPPORTED', async () => {
    const res = await post(admin.token, W.oldFormatFile(), { name: 'Santulan_Adolescent_Items_TECH_READY.xlsx' });
    expect(res.status).toBe(422);
    expect(res.body.error.details.map((d) => d.code)).toContain('OLD_FORMAT_NOT_SUPPORTED');
  });

  test('a missing or unknown age group is AGE_GROUP_REQUIRED', async () => {
    const buf = W.workbook(W.validRows({ label: label() }));
    for (const ageGroup of [null, 'TEEN']) {
      const res = await post(admin.token, buf, { ageGroup });
      if (ageGroup === 'TEEN') expect(res.status).toBe(422);
      else expect(res.status).toBe(422);
      expect(res.body.error.details.map((d) => d.code)).toContain('AGE_GROUP_REQUIRED');
    }
  });

  test('a file over 2 MB is 413 and a wrong type is 415', async () => {
    expect((await post(admin.token, Buffer.alloc(2 * 1024 * 1024 + 10, 1))).status).toBe(413);
    expect((await post(admin.token, W.workbook(W.validRows()), { name: 'q.csv' })).status).toBe(415);
    const notZip = await post(admin.token, Buffer.from('plain text pretending to be a workbook'));
    expect(notZip.status).toBe(415);
  });

  test('unknown form fields and a missing file are 400', async () => {
    const extra = await request(app).post('/api/v1/admin/question-sets').set('Authorization', `Bearer ${admin.token}`).field('ageGroup', 'ADOLESCENT').field('scoreScale', '5').attach('file', W.workbook(W.validRows()), 'q.xlsx');
    expect(extra.status).toBe(400);
    const none = await request(app).post('/api/v1/admin/question-sets').set('Authorization', `Bearer ${admin.token}`).field('ageGroup', 'ADOLESCENT');
    expect(none.status).toBe(400);
  });
});

describe('who may upload', () => {
  test('participant, institution admin, suspended admin and unauthenticated callers are refused', async () => {
    const buf = W.workbook(W.validRows({ label: label() }));
    const p = await f.participant(16);
    expect((await post(null, buf)).status).toBe(401);
    expect((await post(p.token, buf)).status).toBe(403);
    expect((await post((await f.admin('SUSPENDED')).token, buf)).status).toBe(403);
    expect((await post((await f.admin('INACTIVE', 'INSTITUTION_ADMIN')).token, buf)).status).toBe(403);
    expect((await post(admin.token, buf)).status).toBe(201);
  });
});

describe('template, list and detail', () => {
  test('GET /admin/question-sets/template returns a workbook that validates', async () => {
    const res = await request(app).get('/api/v1/admin/question-sets/template').set('Authorization', `Bearer ${admin.token}`).buffer(true).parse((r, cb) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    const up = await post(admin.token, res.body);
    expect(up.status === 201 || up.status === 200).toBe(true);
    expect((await request(app).get('/api/v1/admin/question-sets/template')).status).toBe(401);
  });

  test('list filters by age group and status; detail shows every question with its options', async () => {
    const lbl = label();
    const rows = W.validRows({ label: lbl });
    rows[0].options = ['Yes', 'No'];
    const up = await post(admin.token, W.workbook(rows));
    const list = await request(app).get('/api/v1/admin/question-sets?ageGroup=ADOLESCENT&status=DRAFT').set('Authorization', `Bearer ${admin.token}`);
    expect(list.status).toBe(200);
    expect(list.body.sets.find((s) => s.setId === up.body.setId)).toMatchObject({ versionLabel: lbl, questionCount: 7, optionCount: 32 });
    expect((await request(app).get('/api/v1/admin/question-sets?ageGroup=OTHER').set('Authorization', `Bearer ${admin.token}`)).status).toBe(400);
    const detail = await request(app).get(`/api/v1/admin/question-sets/${up.body.setId}`).set('Authorization', `Bearer ${admin.token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.questions).toHaveLength(7);
    expect(detail.body.questions[0]).toMatchObject({ itemCode: 'C1-01', options: [{ position: 1, text: 'Yes' }, { position: 2, text: 'No' }] });
    expect((await request(app).get('/api/v1/admin/question-sets/not-a-uuid').set('Authorization', `Bearer ${admin.token}`)).status).toBe(404);
    expect((await request(app).get(`/api/v1/admin/question-sets/${up.body.setId}`)).status).toBe(401);
  });
});
