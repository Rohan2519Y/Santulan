/*
 * Burst load (B05-039, 040), on MongoDB. SKIPPED unless RUN_LOAD=1 (it creates ~80 attempts on the scratch database):
 *   RUN_LOAD=1 npm run test:santulan -- tests/santulan/integration/deliveryLoad.test.js
 * 40 participants burst-save, then two classes (80 participants) burst-submit: no lost or duplicate writes, no deadlocks.
 * Timing is INFORMATIONAL (recorded in tests/santulan/evidence/register.json); it is not a pass/fail threshold.
 */
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../../../src/app');
const { closeClient } = require('../../../src/modules/santulan/store/client');
const f = require('../helpers/committed');
const H = require('../helpers/mongoHarness');

const RUN = process.env.RUN_LOAD === '1';
const maybe = RUN ? describe : describe.skip;
const post = (p2, p, body = {}) => request(app).post(`/api/v1${p2}`).set({ Authorization: `Bearer ${p.token}` }).send(body);
const key = (tag) => `${tag}-${f.u()}-${f.u()}`;

let items;
beforeAll(async () => {
  if (!RUN) return;
  const S = await f.openSet({ ageGroup: 'ADOLESCENT', perDomain: 2 });
  items = S.items.slice(0, 10).map((i) => i.itemId);
});
afterAll(async () => {
  if (RUN) { await f.closeOpenSets(); await f.cleanupFixtures(); }
  await closeClient();
  await H.closeAll();
});

async function attempts(n) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const p = await f.participant(15);
    const created = await post('/attempts', p);
    expect(created.status).toBe(201);
    expect((await post(`/attempts/${created.body.attemptId}/sessions/resume`, p)).status).toBe(200);
    out.push({ p, id: created.body.attemptId });
  }
  return out;
}

function record(entry) {
  const file = path.join(__dirname, '..', 'evidence', 'register.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let current = {};
  try { current = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { current = {}; }
  current['INFO-B05-039-delivery-load'] = { id: 'INFO-B05-039-delivery-load', status: 'INFORMATIONAL', ...entry, recordedAt: new Date().toISOString(), database: 'scratch (local replica set)' };
  fs.writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
}

maybe('burst load', () => {
  jest.setTimeout(900000);

  test('B05-039/040 40 participants burst-save and 80 participants burst-submit with no lost or duplicate writes', async () => {
    const group = await attempts(80);
    const col = async (n) => (await f.db()).collection(n);

    let t = Date.now();
    const saves = await Promise.all(group.slice(0, 40).flatMap((a) => items.map((id, i) => post(`/attempts/${a.id}/responses`, a.p, { itemId: id, value: String((i % 5) + 1), idempotencyKey: key(`load${i}`) }))));
    const saveMs = Date.now() - t;
    expect(saves.every((r) => r.status === 200)).toBe(true);
    const grouped = await (await col('responses')).aggregate([
      { $match: { attempt_id: { $in: group.slice(0, 40).map((a) => a.id) } } },
      { $group: { _id: '$attempt_id', n: { $sum: 1 }, current: { $sum: { $cond: ['$is_current', 1, 0] } } } },
    ]).toArray();
    expect(grouped).toHaveLength(40);
    expect(grouped.every((r) => r.n === items.length && r.current === items.length)).toBe(true);

    t = Date.now();
    const submits = await Promise.all(group.map((a) => post(`/attempts/${a.id}/submit`, a.p, { submissionKey: key('loadsubmit') })));
    const submitMs = Date.now() - t;
    expect(submits.every((r) => r.status === 200)).toBe(true);
    expect(await (await col('response_events')).countDocuments({ attempt_id: { $in: group.map((a) => a.id) }, event_type: 'SUBMIT' })).toBe(80);

    record({ participantsSaving: 40, savesPerParticipant: items.length, saveRequests: saves.length, saveTotalMs: saveMs, participantsSubmitting: 80, submitTotalMs: submitMs, informational: true });
  });
});

test('load test is opt-in (RUN_LOAD=1)', () => { expect(typeof RUN).toBe('boolean'); });
