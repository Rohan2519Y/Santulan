/* Release-switch endpoints (FR-057): GET /admin/release-flags and POST /admin/release-flags/{flag}. */
const request = require('supertest');
const app = require('../../../src/app');
const { closeClient } = require('../../../src/modules/santulan/store/client');
const f = require('../helpers/committed');
const H = require('../helpers/mongoHarness');

let admin;
beforeAll(async () => { admin = await f.admin(); });
afterAll(async () => {
  for (const flag of ['pilotS2', 'advancedEvidence', 'developmentRelease', 'pathwayRelease']) {
    await request(app).post(`/api/v1/admin/release-flags/${flag}`).set({ Authorization: `Bearer ${admin.token}` }).send({ value: false, reason: 'reset after tests' });
  }
  await f.cleanupFixtures(); await closeClient(); await H.closeAll();
});

const auth = (t = admin.token) => ({ Authorization: `Bearer ${t}` });
const get = (t) => request(app).get('/api/v1/admin/release-flags').set(auth(t));
const post = (flag, body, t) => request(app).post(`/api/v1/admin/release-flags/${flag}`).set(auth(t)).send(body);

test('B07-110 the four switches are listed with a value; a never-changed switch is false and has no history', async () => {
  const res = await get();
  expect(res.status).toBe(200);
  expect(Object.keys(res.body).sort()).toEqual(['advancedEvidence', 'developmentRelease', 'pathwayRelease', 'pilotS2']);
  for (const v of Object.values(res.body)) expect(typeof v.value).toBe('boolean');
});

test('B07-111 a change takes effect at once (no restart), is audited with the reason, and is visible in the list', async () => {
  const set = await post('pilotS2', { value: true, reason: 'Pilot week 1 approved' });
  expect(set.status).toBe(200);
  expect(set.body).toMatchObject({ flag: 'pilotS2', value: true, reason: 'Pilot week 1 approved', changedBy: admin.adminUserId });
  const list = await get();
  expect(list.body.pilotS2).toMatchObject({ value: true, reason: 'Pilot week 1 approved', changedBy: admin.adminUserId });
  expect(list.body.pilotS2.changedAt).toBeTruthy();
  const audit = await (await f.db()).collection('audit_logs').findOne({ action_type: 'RELEASE_FLAG_CHANGED', target_entity: 'release_flag:pilotS2', reason: 'Pilot week 1 approved' });
  expect(audit).toMatchObject({ actor_id: admin.adminUserId, new_state: { flag: 'pilotS2', value: true } });
  expect((await post('pilotS2', { value: false, reason: 'Pilot paused' })).body.value).toBe(false);
});

test('B07-112 a missing reason or an invalid body is 400; an unknown flag is 404', async () => {
  for (const body of [{ value: true }, { value: true, reason: '' }, { value: true, reason: 'ab' }, { reason: 'reason ok' }, { value: 'yes', reason: 'reason ok' }, { value: true, reason: 'reason ok', extra: 1 }]) {
    expect((await post('pilotS2', body)).status).toBe(400);
  }
  expect((await post('madeUpSwitch', { value: true, reason: 'reason ok' })).status).toBe(404);
});

test('B07-113 participant, suspended admin, institution admin and unauthenticated callers are refused on both endpoints', async () => {
  const p = await f.participant(16);
  const suspended = await f.admin('SUSPENDED');
  const inst = await f.admin('INACTIVE', 'INSTITUTION_ADMIN');
  for (const t of [p.token, suspended.token, inst.token]) {
    expect((await get(t)).status).toBe(403);
    expect((await post('pilotS2', { value: true, reason: 'not allowed' }, t)).status).toBe(403);
  }
  expect((await request(app).get('/api/v1/admin/release-flags')).status).toBe(401);
  expect((await request(app).post('/api/v1/admin/release-flags/pilotS2').send({ value: true, reason: 'not allowed' })).status).toBe(401);
});
