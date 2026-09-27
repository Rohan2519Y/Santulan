/*
 * Per-question response distribution: option counts and skip counts across an assessment's completed attempts (the
 * ASSUMED read-only addition, same basis as adminSubmissions.test.js's D-M19 - the contract never specified this
 * report). Through the real app and the runtime credential on the SCRATCH database.
 */
const request = require('supertest');
const XLSX = require('xlsx');
const JSZip = require('jszip');
const app = require('../../../src/app');
const f = require('../helpers/committed');
const F = require('../helpers/fixtures');
const H = require('../helpers/mongoHarness');
const { closeClient } = require('../../../src/models/db/client');

const api = () => request(app);
const get = (p, who) => api().get(`/api/v1${p}`).set(who ? { Authorization: `Bearer ${who.token}` } : {});
/** Binary download: supertest has no parser for xlsx's content-type, so buffer the raw bytes ourselves. */
const getFile = (p, who) => get(p, who).buffer(true).parse((res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
});

let admin; let S;

const submittedAttempt = async (participantId) => f.insert('assessment_attempts', F.attempt(participantId, S.setId, {
  status: 'SUBMITTED', session_count: 1, started_at: new Date(), submitted_at: new Date(), last_activity_at: new Date(),
}));

beforeAll(async () => {
  admin = await f.admin();
  S = await f.openSet({ ageGroup: 'ADOLESCENT', perDomain: 1 }); // 7 domains x 1 = 7 items
});

afterAll(async () => {
  await f.closeOpenSets(); await f.cleanupFixtures(); await closeClient(); await H.closeAll();
});

describe('per-question response distribution', () => {
  test('counts each option and skips per question, across completed attempts only - an in-progress attempt counts toward neither', async () => {
    const p1 = await f.participant(15);
    const a1 = await submittedAttempt(p1.participantId);
    await f.answerAll(a1._id, ({ order }) => { // answers question 1 and 2, skips the rest
      if (order === 1) return '2';
      if (order === 2) return '4';
      return null;
    });

    const p2 = await f.participant(16);
    const a2 = await submittedAttempt(p2.participantId);
    await f.answerAll(a2._id, ({ order }) => (order === 1 ? '4' : null)); // answers only question 1

    const p3 = await f.participant(15);
    await f.insert('assessment_attempts', F.attempt(p3.participantId, S.setId, { status: 'IN_PROGRESS', session_count: 1, started_at: new Date(), last_activity_at: new Date() }));

    const res = await get(`/admin/question-sets/${S.setId}/response-distribution`, admin);
    expect(res.status).toBe(200);
    expect(res.body.totalAttempts).toBe(2); // the IN_PROGRESS attempt is excluded

    const byOrder = Object.fromEntries(S.items.map((i) => [i.order, i.itemId]));
    const q1 = res.body.items.find((i) => i.itemId === byOrder[1]);
    const q2 = res.body.items.find((i) => i.itemId === byOrder[2]);
    const q3 = res.body.items.find((i) => i.itemId === byOrder[3]);

    expect(q1.answeredCount).toBe(2);
    expect(q1.skippedCount).toBe(0);
    expect(q1.options.find((o) => o.position === 2).count).toBe(1);
    expect(q1.options.find((o) => o.position === 4).count).toBe(1);
    expect(q1.options.find((o) => o.position === 1).count).toBe(0);

    expect(q2.answeredCount).toBe(1);
    expect(q2.skippedCount).toBe(1);
    expect(q2.options.find((o) => o.position === 4).count).toBe(1);

    expect(q3.answeredCount).toBe(0);
    expect(q3.skippedCount).toBe(2);
  });

  test('an unknown set is 404; no token is 401; a participant token is 403', async () => {
    const missing = await get('/admin/question-sets/00000000-0000-4000-8000-000000000000/response-distribution', admin);
    expect(missing.status).toBe(404);

    const noToken = await get(`/admin/question-sets/${S.setId}/response-distribution`, null);
    expect(noToken.status).toBe(401);

    const p = await f.participant(16);
    const asParticipant = await get(`/admin/question-sets/${S.setId}/response-distribution`, p);
    expect(asParticipant.status).toBe(403);
  });
});

describe('.xlsx export of the same distribution', () => {
  test('is a real workbook with the same counts as the JSON endpoint, one row per question/answer', async () => {
    const p1 = await f.participant(15);
    const a1 = await submittedAttempt(p1.participantId);
    await f.answerAll(a1._id, ({ order }) => (order === 1 ? '3' : null)); // answers question 1, skips the rest

    const json = (await get(`/admin/question-sets/${S.setId}/response-distribution`, admin)).body;
    const res = await getFile(`/admin/question-sets/${S.setId}/response-distribution/export`, admin);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="santulan-response-distribution-.*\.xlsx"/);

    const wb = XLSX.read(res.body, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    expect(rows[1][0]).toContain(S.label); // the assessment context line names the set
    expect(rows[2][0]).toContain(String(json.totalAttempts));
    const header = rows.findIndex((r) => r[0] === 'Item code');
    expect(rows[header]).toEqual(['Item code', 'Domain', 'Question', 'Status', 'Answer', 'Responses', '% of completed attempts']);
    const dataRows = rows.slice(header + 1);
    expect(dataRows).toHaveLength(json.items.length * 6); // 5 options + one "Skipped" row per question

    // cross-check every row against the JSON endpoint's own numbers for the exact same live state - never a hardcoded count
    for (const item of json.items) {
      const itemRows = dataRows.filter((r) => r[0] === item.itemCode);
      for (const o of item.options) expect(itemRows.find((r) => r[4] === o.text)[5]).toBe(o.count);
      expect(itemRows.find((r) => r[4] === 'Skipped')[5]).toBe(item.skippedCount);
    }

    // second sheet: same counts, laid out for the data-bar visual
    expect(wb.SheetNames[1]).toBe('Chart view');
    const chartRows = XLSX.utils.sheet_to_json(wb.Sheets['Chart view'], { header: 1 });
    for (const item of json.items) {
      const headIdx = chartRows.findIndex((r) => r[0] === `${item.itemCode} · ${item.domainCode}`);
      expect(headIdx).toBeGreaterThan(-1);
      const block = chartRows.slice(headIdx + 1, headIdx + 1 + item.options.length + 1);
      for (const o of item.options) expect(block.find((r) => r[1] === o.text)[3]).toBe(o.count);
      expect(block.find((r) => r[1] === 'Skipped')[3]).toBe(item.skippedCount);
    }

    // the bar is a real Excel Data Bar (conditional formatting), not a picture or a chart object
    const zip = await JSZip.loadAsync(res.body);
    const sheet2Xml = await zip.file('xl/worksheets/sheet2.xml').async('string');
    expect(sheet2Xml).toContain('<cfRule type="dataBar"');
  });

  test('an unknown set is 404; no token is 401; a participant token is 403', async () => {
    const missing = await get('/admin/question-sets/00000000-0000-4000-8000-000000000000/response-distribution/export', admin);
    expect(missing.status).toBe(404);
    const noToken = await get(`/admin/question-sets/${S.setId}/response-distribution/export`, null);
    expect(noToken.status).toBe(401);
    const p = await f.participant(17);
    const asParticipant = await get(`/admin/question-sets/${S.setId}/response-distribution/export`, p);
    expect(asParticipant.status).toBe(403);
  });
});
