/* Question-set lifecycle over HTTP (US4 acceptance 1-5). */
const request = require('supertest');
const app = require('../../../src/app');
const { closeClient } = require('../../../src/modules/santulan/store/client');
const f = require('../helpers/committed');
const H = require('../helpers/mongoHarness');
const W = require('../helpers/questionWorkbook');

let admin;
beforeAll(async () => { admin = await f.admin(); });
afterAll(async () => { await f.cleanupFixtures(); await closeClient(); await H.closeAll(); });
beforeEach(async () => { (await f.db()).collection('assessment_versions').updateMany({ participation_state: 'OPEN', version_label: /^fx-/ }, { $set: { participation_state: 'CLOSED' } }); });

const auth = (t = admin.token) => ({ Authorization: `Bearer ${t}` });
const label = () => `fx-lc-${f.u().toLowerCase()}`;
const upload = async (ageGroup = 'ADOLESCENT') => {
  const lbl = label();
  const res = await request(app).post('/api/v1/admin/question-sets').set(auth()).field('ageGroup', ageGroup).attach('file', W.workbook(W.validRows({ label: lbl, ageGroup })), 'q.xlsx');
  expect(res.status).toBe(201);
  return res.body;
};
const step = (id, verb, body = {}, headers = auth()) => request(app).post(`/api/v1/admin/question-sets/${id}/${verb}`).set(headers).send(body);
const audits = async (id) => (await f.db()).collection('audit_logs').find({ target_id: id, action_type: { $regex: '^QUESTION_SET_' } }).sort({ occurred_at: 1 }).toArray();

describe('US4 acceptance: draft -> frozen -> open -> closed', () => {
  test('T-B02-011 the whole lifecycle, one audit row per step, and nothing else changes', async () => {
    const set = await upload();
    const frozen = await step(set.setId, 'freeze');
    expect(frozen.status).toBe(200);
    expect(frozen.body).toMatchObject({ status: 'FROZEN', participationState: 'CLOSED' });
    const opened = await step(set.setId, 'open', { reason: 'Pilot cohort 1' });
    expect(opened.body).toMatchObject({ status: 'FROZEN', participationState: 'OPEN' });
    const closed = await step(set.setId, 'close', { reason: 'Pilot cohort 1 complete' });
    expect(closed.body).toMatchObject({ participationState: 'CLOSED' });
    expect((await audits(set.setId)).map((a) => a.action_type)).toEqual(['QUESTION_SET_UPLOADED', 'QUESTION_SET_FROZEN', 'QUESTION_SET_OPENED', 'QUESTION_SET_CLOSED']);
  });

  test('B08-004 open and close need a reason of 3 to 300 characters; freeze takes an empty body; unknown keys are 400', async () => {
    const set = await upload();
    await step(set.setId, 'freeze');
    for (const body of [{}, { reason: '' }, { reason: 'ab' }, { reason: 'x'.repeat(301) }, { reason: 'ok reason', extra: 1 }]) {
      expect((await step(set.setId, 'open', body)).status).toBe(400);
      expect((await step(set.setId, 'close', body)).status).toBe(400);
    }
    expect((await step(set.setId, 'freeze', { reason: 'not accepted' })).status).toBe(400);
    expect((await (await f.db()).collection('assessment_versions').findOne({ _id: set.setId })).participation_state).toBe('CLOSED');
  });

  test('a second frozen set for the same age group cannot be opened (409 OPEN_SET_EXISTS); closing frees the group', async () => {
    const a = await upload(); const b = await upload();
    await step(a.setId, 'freeze'); await step(b.setId, 'freeze');
    expect((await step(a.setId, 'open', { reason: 'first' })).status).toBe(200);
    const clash = await step(b.setId, 'open', { reason: 'second' });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('OPEN_SET_EXISTS');
    expect((await step(a.setId, 'close', { reason: 'switch over' })).status).toBe(200);
    expect((await step(b.setId, 'open', { reason: 'second' })).status).toBe(200);
  });

  test('freeze of an incomplete set is 409 SET_INCOMPLETE naming the domains; open of a draft is 409 SET_NOT_FROZEN', async () => {
    const lbl = label();
    const rows = W.validRows({ label: lbl }).filter((x) => x.cells.domain_code !== 'C6');
    const up = await request(app).post('/api/v1/admin/question-sets').set(auth()).field('ageGroup', 'ADOLESCENT').attach('file', W.workbook(rows), 'q.xlsx');
    expect(up.status).toBe(201);
    const fr = await step(up.body.setId, 'freeze');
    expect(fr.status).toBe(409);
    expect(fr.body.error.code).toBe('SET_INCOMPLETE');
    expect(fr.body.error.message).toContain('C6');
    const op = await step(up.body.setId, 'open', { reason: 'too early' });
    expect(op.status).toBe(409);
    expect(op.body.error.code).toBe('SET_NOT_FROZEN');
  });

  test('a frozen set cannot be uploaded over (409 SET_NOT_DRAFT)', async () => {
    const lbl = label();
    const buf = W.workbook(W.validRows({ label: lbl }));
    const up = await request(app).post('/api/v1/admin/question-sets').set(auth()).field('ageGroup', 'ADOLESCENT').attach('file', buf, 'q.xlsx');
    await step(up.body.setId, 'freeze');
    const again = await request(app).post('/api/v1/admin/question-sets').set(auth()).field('ageGroup', 'ADOLESCENT').attach('file', buf, 'q.xlsx');
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('SET_NOT_DRAFT');
  });

  test('non-admins are refused on every step', async () => {
    const set = await upload();
    const p = await f.participant(16);
    const suspended = await f.admin('SUSPENDED');
    for (const verb of ['freeze', 'open', 'close']) {
      const body = verb === 'freeze' ? {} : { reason: 'nope nope' };
      expect((await step(set.setId, verb, body, {})).status).toBe(401);
      expect((await step(set.setId, verb, body, auth(p.token))).status).toBe(403);
      expect((await step(set.setId, verb, body, auth(suspended.token))).status).toBe(403);
    }
    expect((await step('not-a-uuid', 'freeze')).status).toBe(404);
    expect((await step('00000000-0000-4000-8000-000000000000', 'freeze')).status).toBe(404);
  });
});
