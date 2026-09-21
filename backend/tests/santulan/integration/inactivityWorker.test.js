/*
 * Inactivity worker (BUILD 05 sections 4, 7), on MongoDB: pauses timed-out IN_PROGRESS attempts (PAUSE + SESSION_END, no session
 * increment), leaves active ones alone, and is disabled when no duration is configured.
 */
const request = require('supertest');
const app = require('../../../src/app');
const { closeClient } = require('../../../src/modules/santulan/store/client');
const f = require('../helpers/committed');
const H = require('../helpers/mongoHarness');
const worker = require('../../../src/jobs/workers/inactivityWorker');

const post = (path, p, body = {}) => request(app).post(`/api/v1${path}`).set({ Authorization: `Bearer ${p.token}` }).send(body);
const col = async (n) => (await f.db()).collection(n);

beforeAll(async () => { await f.openSet({ ageGroup: 'ADOLESCENT', perDomain: 1 }); });
afterAll(async () => { await f.closeOpenSets(); await f.cleanupFixtures(); await closeClient(); await H.closeAll(); });

async function inProgress() {
  const p = await f.participant(15);
  const id = (await post('/attempts', p)).body.attemptId;
  await post(`/attempts/${id}/sessions/resume`, p);
  return { p, id };
}
const idle = async (id, minutes) => (await col('assessment_attempts')).updateOne({ _id: id }, { $set: { last_activity_at: new Date(Date.now() - minutes * 60000) } });
const state = async (id) => { const a = await (await col('assessment_attempts')).findOne({ _id: id }); return { status: a.status, session_count: a.session_count }; };

describe('inactivity worker', () => {
  test('is disabled unless a duration is configured (nothing is invented)', async () => {
    expect(worker.start({ minutes: null })).toBeNull();
    expect(worker.start({ minutes: 0 })).toBeNull();
    expect(worker.start({ minutes: Number.NaN })).toBeNull();
    const a = await inProgress();
    await idle(a.id, 600);
    expect(await worker.runOnce({ minutes: null })).toBe(0);
    expect((await state(a.id)).status).toBe('IN_PROGRESS');
  });

  test('pauses only timed-out attempts; the session count is unchanged; resuming afterwards is a true new session', async () => {
    const stale = await inProgress(); const fresh = await inProgress();
    await idle(stale.id, 45);
    await idle(fresh.id, 5);

    const paused = await worker.runOnce({ minutes: 30 });
    expect(paused).toBeGreaterThanOrEqual(1);
    expect(await state(stale.id)).toEqual({ status: 'PAUSED', session_count: 1 });
    expect(await state(fresh.id)).toEqual({ status: 'IN_PROGRESS', session_count: 1 });

    const ev = await (await col('response_events')).find({ attempt_id: stale.id, event_type: { $in: ['PAUSE', 'SESSION_END'] } }).toArray();
    expect(ev.map((e) => [e.event_type, e.metadata.reason]).sort()).toEqual([['PAUSE', 'INACTIVITY_TIMEOUT'], ['SESSION_END', 'INACTIVITY_TIMEOUT']]);

    expect(await worker.runOnce({ minutes: 30 })).toBe(0); // idempotent: nothing left to pause
    const resumed = await post(`/attempts/${stale.id}/sessions/resume`, stale.p);
    expect(resumed.body).toMatchObject({ status: 'IN_PROGRESS', session: { n: 2, of: 4 } }); // a real boundary adds one session
  });

  test('a paused, submitted or created attempt is never touched', async () => {
    const p = await f.participant(16);
    const created = (await post('/attempts', p)).body.attemptId; // CREATED
    await idle(created, 600);
    const paused = await inProgress(); await post(`/attempts/${paused.id}/pause`, paused.p); await idle(paused.id, 600);
    await worker.runOnce({ minutes: 30 });
    expect((await state(created)).status).toBe('CREATED');
    expect((await state(paused.id)).status).toBe('PAUSED');
    expect(await (await col('response_events')).countDocuments({ attempt_id: paused.id, event_type: 'PAUSE' })).toBe(1);
  });

  test('two workers running at the same moment pause each attempt exactly once', async () => {
    const a = await inProgress();
    await idle(a.id, 90);
    const [x, y] = await Promise.all([worker.runOnce({ minutes: 30 }), worker.runOnce({ minutes: 30 })]);
    expect(x + y).toBeGreaterThanOrEqual(1);
    expect(await (await col('response_events')).countDocuments({ attempt_id: a.id, event_type: 'PAUSE' })).toBe(1);
    expect((await state(a.id)).status).toBe('PAUSED');
  });
});
