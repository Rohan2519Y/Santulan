/*
 * T081 — delivery under concurrency (B05-025, 026, 037, 038, 043). The requests go through the real app, whose pool
 * uses separate connections, so these are genuine concurrent transactions against the scratch database.
 * Like the contract suite, it opens the adolescent version for its duration and restores DRAFT/CLOSED afterwards.
 */
const request = require('supertest');
const app = require('../../../src/app');
const db = require('../../../src/shared/db');
const f = require('../helpers/committed');

const ADOL = 'santulan-adolescent-pilot-v3.1';
const api = () => request(app);
const key = (tag = 'k') => `${tag}-${f.u()}-${f.u()}`;
const post = (path, p, body = {}) => api().post(`/api/v1${path}`).set({ Authorization: `Bearer ${p.token}` }).send(body);

let items;
beforeAll(async () => {
  await f.openVersion(ADOL);
  items = (await f.query(`SELECT i.item_id FROM santulan.items i JOIN santulan.assessment_versions v USING (assessment_version_id) WHERE v.version_label = $1 ORDER BY i.display_order LIMIT 30`, [ADOL])).map((r) => r.item_id);
});
afterAll(async () => { await f.restoreVersions(); await f.cleanupFixtures(); await db.pool.end(); });

async function started(age = 15) {
  const p = await f.participant(age);
  const created = await post('/attempts', p);
  expect(created.status).toBe(201);
  const a = { p, id: created.body.attemptId };
  expect((await post(`/attempts/${a.id}/sessions/resume`, p)).status).toBe(200);
  return a;
}
const save = (a, itemId, value, k, extra = {}) => post(`/attempts/${a.id}/responses`, a.p, { itemId, value, idempotencyKey: k, ...extra });
const count = async (sql, params) => (await f.query(sql, params))[0].n;

describe('concurrent response saves (B05-037, 043)', () => {
  test('two simultaneous saves with distinct keys on one item serialise into contiguous versions with exactly one CURRENT', async () => {
    const a = await started();
    const [r1, r2] = await Promise.all([save(a, items[0], '2', key('a')), save(a, items[0], '4', key('b'))]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(r1.body.responseId).not.toBe(r2.body.responseId);
    const rows = await f.query('SELECT response_version, is_current FROM santulan.responses WHERE attempt_id = $1 AND item_id = $2 ORDER BY response_version', [a.id, items[0]]);
    expect(rows).toEqual([{ response_version: 1, is_current: false }, { response_version: 2, is_current: true }]);
    const chain = await f.query('SELECT response_version, supersedes_response_id, response_id FROM santulan.responses WHERE attempt_id = $1 AND item_id = $2 ORDER BY response_version', [a.id, items[0]]);
    expect(chain[1].supersedes_response_id).toBe(chain[0].response_id);
  });

  test('two simultaneous saves with the SAME key and payload return one response id, one version and one event', async () => {
    const a = await started();
    const k = key('same');
    const results = await Promise.all([1, 2, 3, 4].map(() => save(a, items[1], '3', k, { responseTimeMs: 900, presentedOrder: 2 })));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body.responseId)).size).toBe(1);
    expect(await count('SELECT count(*)::int AS n FROM santulan.responses WHERE attempt_id = $1 AND item_id = $2', [a.id, items[1]])).toBe(1);
    expect(await count(`SELECT count(*)::int AS n FROM santulan.response_events WHERE attempt_id = $1 AND event_type = 'RESPONSE_SAVED'`, [a.id])).toBe(1);
  });

  test('the same key racing with a changed payload: exactly one wins, the other is a conflict, no duplicate row', async () => {
    const a = await started();
    const k = key('race');
    const [x, y] = await Promise.all([save(a, items[2], '2', k), save(a, items[2], '5', k)]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect(await count('SELECT count(*)::int AS n FROM santulan.responses WHERE attempt_id = $1 AND item_id = $2', [a.id, items[2]])).toBe(1);
  });

  test('a lost acknowledgement (persist, drop the reply, retry) yields one version', async () => {
    const a = await started();
    const k = key('lost');
    await save(a, items[3], '4', k);                              // the client never saw this reply
    const retry = await save(a, items[3], '4', k);
    expect(retry.status).toBe(200);
    expect(await count('SELECT count(*)::int AS n FROM santulan.responses WHERE attempt_id = $1 AND item_id = $2', [a.id, items[3]])).toBe(1);
  });

  test('many concurrent saves to different items all persist, with no deadlock and one CURRENT each', async () => {
    const a = await started();
    const results = await Promise.all(items.slice(0, 25).map((id, i) => save(a, id, String((i % 5) + 1), key(`bulk${i}`))));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await count('SELECT count(*)::int AS n FROM santulan.responses WHERE attempt_id = $1 AND is_current', [a.id])).toBe(25);
    expect(await count('SELECT count(DISTINCT item_id)::int AS n FROM santulan.responses WHERE attempt_id = $1', [a.id])).toBe(25);
  });
});

describe('concurrent submits (B05-038)', () => {
  test('simultaneous submits with the same key write one SUBMIT event, one SESSION_END and one audit row', async () => {
    const a = await started();
    await save(a, items[0], '3', key('s'));
    const k = key('submit');
    const results = await Promise.all([1, 2, 3, 4].map(() => post(`/attempts/${a.id}/submit`, a.p, { submissionKey: k })));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(new Set(results.map((r) => r.body.submittedAt)).size).toBe(1);
    expect(await count(`SELECT count(*)::int AS n FROM santulan.response_events WHERE attempt_id = $1 AND event_type = 'SUBMIT'`, [a.id])).toBe(1);
    expect(await count(`SELECT count(*)::int AS n FROM santulan.response_events WHERE attempt_id = $1 AND event_type = 'SESSION_END'`, [a.id])).toBe(1);
    expect(await count(`SELECT count(*)::int AS n FROM santulan.audit_logs WHERE action_type = 'ATTEMPT_SUBMITTED' AND target_id = $1`, [a.id])).toBe(1);
  });

  test('simultaneous submits with different keys: exactly one wins and the rest conflict', async () => {
    const a = await started();
    const results = await Promise.all([1, 2, 3].map((i) => post(`/attempts/${a.id}/submit`, a.p, { submissionKey: key(`diff${i}`) })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409 && r.body.error.code === 'SUBMIT_KEY_CONFLICT')).toHaveLength(2);
    expect(await count(`SELECT count(*)::int AS n FROM santulan.response_events WHERE attempt_id = $1 AND event_type = 'SUBMIT'`, [a.id])).toBe(1);
  });

  test('a save racing a submit either lands before the lock or is refused after it; an accepted answer never postdates the submission', async () => {
    for (let round = 0; round < 3; round += 1) {
      const a = await started();
      const [s, sub] = await Promise.all([save(a, items[0], '3', key('race')), post(`/attempts/${a.id}/submit`, a.p, { submissionKey: key('rs') })]);
      expect(sub.status).toBe(200);
      expect([200, 422]).toContain(s.status);
      // success reported to the client <=> the answer exists; a refused save leaves nothing behind
      expect(await count('SELECT count(*)::int AS n FROM santulan.responses WHERE attempt_id = $1', [a.id])).toBe(s.status === 200 ? 1 : 0);
      expect(await count(`SELECT count(*)::int AS n FROM santulan.responses r JOIN santulan.assessment_attempts a USING (attempt_id)
                           WHERE a.attempt_id = $1 AND r.answered_at > a.submitted_at`, [a.id])).toBe(0);
      expect((await save(a, items[1], '3', key('after'))).status).toBe(422);          // and once SUBMITTED nothing more is accepted
    }
  });
});

describe('reconnect and sessions (B05-025, 026)', () => {
  test('simultaneous first-start requests create exactly one session; reconnect storms never add sessions', async () => {
    const p = await f.participant(16);
    const created = await post('/attempts', p);
    const id = created.body.attemptId;
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => post(`/attempts/${id}/sessions/resume`, p)));
    expect(results.every((r) => r.status === 200 && r.body.session.n === 1)).toBe(true);
    expect(await count(`SELECT count(*)::int AS n FROM santulan.response_events WHERE attempt_id = $1 AND event_type = 'SESSION_START'`, [id])).toBe(1);
    expect(await count('SELECT session_count AS n FROM santulan.assessment_attempts WHERE attempt_id = $1', [id])).toBe(1);
  });

  test('simultaneous resumes from PAUSED add exactly one session', async () => {
    const a = await started();
    await post(`/attempts/${a.id}/pause`, a.p);
    const results = await Promise.all([1, 2, 3].map(() => post(`/attempts/${a.id}/sessions/resume`, a.p)));
    expect(results.every((r) => r.status === 200 && r.body.session.n === 2)).toBe(true);
    expect(await count('SELECT session_count AS n FROM santulan.assessment_attempts WHERE attempt_id = $1', [a.id])).toBe(2);
  });
});
