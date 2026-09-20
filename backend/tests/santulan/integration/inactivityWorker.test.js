/*
 * T088 — inactivity worker (BUILD 05 §4, §7): pauses timed-out IN_PROGRESS attempts (PAUSE + SESSION_END, no session
 * increment), leaves active ones alone, and is disabled when no duration is configured. Opens the adolescent version for
 * its duration and restores it afterwards.
 */
const request = require('supertest');
const app = require('../../../src/app');
const db = require('../../../src/shared/db');
const f = require('../helpers/committed');
const worker = require('../../../src/jobs/workers/inactivityWorker');

const ADOL = 'santulan-adolescent-pilot-v3.1';
const post = (path, p, body = {}) => request(app).post(`/api/v1${path}`).set({ Authorization: `Bearer ${p.token}` }).send(body);

beforeAll(async () => { await f.openVersion(ADOL); });
afterAll(async () => { await f.restoreVersions(); await f.cleanupFixtures(); await db.pool.end(); });

async function inProgress() {
  const p = await f.participant(15);
  const id = (await post('/attempts', p)).body.attemptId;
  await post(`/attempts/${id}/sessions/resume`, p);
  return { p, id };
}
const idle = (id, minutes) => f.query(`UPDATE santulan.assessment_attempts SET last_activity_at = now() - make_interval(mins => $2) WHERE attempt_id = $1`, [id, minutes]);
const state = async (id) => (await f.query('SELECT status, session_count FROM santulan.assessment_attempts WHERE attempt_id = $1', [id]))[0];

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

    const ev = await f.query(`SELECT event_type, metadata FROM santulan.response_events WHERE attempt_id = $1 AND event_type IN ('PAUSE','SESSION_END')`, [stale.id]);
    expect(ev.map((e) => [e.event_type, e.metadata.reason]).sort()).toEqual([['PAUSE', 'INACTIVITY_TIMEOUT'], ['SESSION_END', 'INACTIVITY_TIMEOUT']]);

    expect(await worker.runOnce({ minutes: 30 })).toBe(0);                                   // idempotent: nothing left to pause
    const resumed = await post(`/attempts/${stale.id}/sessions/resume`, stale.p);
    expect(resumed.body).toMatchObject({ status: 'IN_PROGRESS', session: { n: 2, of: 4 } });    // a real boundary adds one session
  });

  test('a paused, submitted or created attempt is never touched', async () => {
    const p = await f.participant(16);
    const created = (await post('/attempts', p)).body.attemptId;                             // CREATED
    await idle(created, 600);
    const paused = await inProgress(); await post(`/attempts/${paused.id}/pause`, paused.p); await idle(paused.id, 600);
    await worker.runOnce({ minutes: 30 });
    expect((await state(created)).status).toBe('CREATED');
    expect((await state(paused.id)).status).toBe('PAUSED');
    expect((await f.query(`SELECT count(*)::int AS n FROM santulan.response_events WHERE attempt_id = $1 AND event_type = 'PAUSE'`, [paused.id]))[0].n).toBe(1);
  });
});
