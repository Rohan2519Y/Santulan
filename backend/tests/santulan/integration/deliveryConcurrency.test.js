/*
 * Delivery under concurrency (B05-025, 026, 037, 038, 043; G-19), on MongoDB. The requests go through the real app, whose store
 * client uses a connection pool, so these are genuine concurrent transactions against the scratch database. Convergence comes
 * from compare-and-set, the unique indexes and the transaction retry.
 */
const request = require('supertest');
const app = require('../../../src/app');
const { closeClient } = require('../../../src/modules/santulan/store/client');
const f = require('../helpers/committed');
const H = require('../helpers/mongoHarness');

const api = () => request(app);
const key = (tag = 'k') => `${tag}-${f.u()}-${f.u()}`;
const post = (path, p, body = {}) => api().post(`/api/v1${path}`).set({ Authorization: `Bearer ${p.token}` }).send(body);
const col = async (n) => (await f.db()).collection(n);

let items;
beforeAll(async () => {
  const S = await f.openSet({ ageGroup: 'ADOLESCENT', perDomain: 4 }); // 28 questions
  items = S.items.map((i) => i.itemId);
});
afterAll(async () => { await f.closeOpenSets(); await f.cleanupFixtures(); await closeClient(); await H.closeAll(); });

async function started(age = 15) {
  const p = await f.participant(age);
  const created = await post('/attempts', p);
  expect(created.status).toBe(201);
  const a = { p, id: created.body.attemptId };
  expect((await post(`/attempts/${a.id}/sessions/resume`, p)).status).toBe(200);
  return a;
}
const save = (a, itemId, value, k, extra = {}) => post(`/attempts/${a.id}/responses`, a.p, { itemId, value, idempotencyKey: k, ...extra });

describe('concurrent response saves (B05-037, 043)', () => {
  test('B05-037 two simultaneous saves with distinct keys on one item serialise into contiguous versions with exactly one CURRENT', async () => {
    const a = await started();
    const [r1, r2] = await Promise.all([save(a, items[0], '2', key('a')), save(a, items[0], '4', key('b'))]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(r1.body.responseId).not.toBe(r2.body.responseId);
    const rows = await (await col('responses')).find({ attempt_id: a.id, item_id: items[0] }).sort({ response_version: 1 }).toArray();
    expect(rows.map((r) => [r.response_version, r.is_current])).toEqual([[1, false], [2, true]]);
    expect(rows[1].supersedes_response_id).toBe(rows[0]._id);
  });

  test('B05-043 two simultaneous saves with the SAME key and payload return one response id, one version and one event', async () => {
    const a = await started();
    const k = key('same');
    const results = await Promise.all([1, 2, 3, 4].map(() => save(a, items[1], '3', k, { responseTimeMs: 900, presentedOrder: 2 })));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body.responseId)).size).toBe(1);
    expect(await (await col('responses')).countDocuments({ attempt_id: a.id, item_id: items[1] })).toBe(1);
    expect(await (await col('response_events')).countDocuments({ attempt_id: a.id, event_type: 'RESPONSE_SAVED' })).toBe(1);
  });

  test('B05-043 the same key racing with a changed payload: exactly one wins, the other is a conflict, no duplicate row', async () => {
    const a = await started();
    const k = key('race');
    const [x, y] = await Promise.all([save(a, items[2], '2', k), save(a, items[2], '5', k)]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect(await (await col('responses')).countDocuments({ attempt_id: a.id, item_id: items[2] })).toBe(1);
  });

  test('a lost acknowledgement (persist, drop the reply, retry) yields one version', async () => {
    const a = await started();
    const k = key('lost');
    await save(a, items[3], '4', k); // the client never saw this reply
    const retry = await save(a, items[3], '4', k);
    expect(retry.status).toBe(200);
    expect(await (await col('responses')).countDocuments({ attempt_id: a.id, item_id: items[3] })).toBe(1);
  });

  test('many concurrent saves to different items all persist, with no deadlock and one CURRENT each', async () => {
    const a = await started();
    const results = await Promise.all(items.slice(0, 25).map((id, i) => save(a, id, String((i % 5) + 1), key(`bulk${i}`))));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await (await col('responses')).countDocuments({ attempt_id: a.id, is_current: true })).toBe(25);
    expect((await (await col('responses')).distinct('item_id', { attempt_id: a.id })).length).toBe(25);
  });
});

describe('concurrent submits (B05-038)', () => {
  test('B05-038 simultaneous submits with the same key write one SUBMIT event, one SESSION_END and one audit row', async () => {
    const a = await started();
    await save(a, items[0], '3', key('s'));
    const k = key('submit');
    const results = await Promise.all([1, 2, 3, 4].map(() => post(`/attempts/${a.id}/submit`, a.p, { submissionKey: k })));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(new Set(results.map((r) => new Date(r.body.submittedAt).getTime())).size).toBe(1);
    const ev = await col('response_events');
    expect(await ev.countDocuments({ attempt_id: a.id, event_type: 'SUBMIT' })).toBe(1);
    expect(await ev.countDocuments({ attempt_id: a.id, event_type: 'SESSION_END' })).toBe(1);
    expect(await (await col('audit_logs')).countDocuments({ action_type: 'ATTEMPT_SUBMITTED', target_id: a.id })).toBe(1);
  });

  test('simultaneous submits with different keys: exactly one wins and the rest conflict', async () => {
    const a = await started();
    const results = await Promise.all([1, 2, 3].map((i) => post(`/attempts/${a.id}/submit`, a.p, { submissionKey: key(`diff${i}`) })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409 && r.body.error.code === 'SUBMIT_KEY_CONFLICT')).toHaveLength(2);
    expect(await (await col('response_events')).countDocuments({ attempt_id: a.id, event_type: 'SUBMIT' })).toBe(1);
  });

  test('a save racing a submit either lands before the lock or is refused after it; an accepted answer never postdates the submission', async () => {
    for (let round = 0; round < 3; round += 1) {
      const a = await started();
      const [s, sub] = await Promise.all([save(a, items[0], '3', key('race')), post(`/attempts/${a.id}/submit`, a.p, { submissionKey: key('rs') })]);
      expect(sub.status).toBe(200);
      expect([200, 422]).toContain(s.status);
      // success reported to the client <=> the answer exists; a refused save leaves nothing behind
      expect(await (await col('responses')).countDocuments({ attempt_id: a.id })).toBe(s.status === 200 ? 1 : 0);
      const attempt = await (await col('assessment_attempts')).findOne({ _id: a.id });
      expect(await (await col('responses')).countDocuments({ attempt_id: a.id, answered_at: { $gt: attempt.submitted_at } })).toBe(0);
      expect((await save(a, items[1], '3', key('after'))).status).toBe(422); // and once SUBMITTED nothing more is accepted
    }
  });
});

describe('reconnect and sessions (B05-025, 026)', () => {
  test('B05-025 simultaneous first-start requests create exactly one session; reconnect storms never add sessions', async () => {
    const p = await f.participant(16);
    const created = await post('/attempts', p);
    const id = created.body.attemptId;
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => post(`/attempts/${id}/sessions/resume`, p)));
    expect(results.every((r) => r.status === 200 && r.body.session.n === 1)).toBe(true);
    expect(await (await col('response_events')).countDocuments({ attempt_id: id, event_type: 'SESSION_START' })).toBe(1);
    expect((await (await col('assessment_attempts')).findOne({ _id: id })).session_count).toBe(1);
  });

  test('B05-026 simultaneous resumes from PAUSED add exactly one session', async () => {
    const a = await started();
    await post(`/attempts/${a.id}/pause`, a.p);
    const results = await Promise.all([1, 2, 3].map(() => post(`/attempts/${a.id}/sessions/resume`, a.p)));
    expect(results.every((r) => r.status === 200 && r.body.session.n === 2)).toBe(true);
    expect((await (await col('assessment_attempts')).findOne({ _id: a.id })).session_count).toBe(2);
  });
});
