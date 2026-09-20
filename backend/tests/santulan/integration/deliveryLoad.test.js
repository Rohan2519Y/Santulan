/*
 * T082 — burst load (B05-039, 040). SKIPPED unless RUN_LOAD=1 (it creates ~120 attempts on the scratch database):
 *   RUN_LOAD=1 npx jest --runInBand tests/santulan/integration/deliveryLoad.test.js
 * 40 participants burst-save, then two classes (80 participants) burst-submit: no lost or duplicate writes, no deadlocks.
 * Timing is INFORMATIONAL (recorded in tests/santulan/evidence/register.json); it is not a pass/fail threshold.
 */
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../../../src/app');
const db = require('../../../src/shared/db');
const f = require('../helpers/committed');

const ADOL = 'santulan-adolescent-pilot-v3.1';
const RUN = process.env.RUN_LOAD === '1';
const maybe = RUN ? describe : describe.skip;
const post = (path, p, body = {}) => request(app).post(`/api/v1${path}`).set({ Authorization: `Bearer ${p.token}` }).send(body);
const key = (tag) => `${tag}-${f.u()}-${f.u()}`;

let items;
beforeAll(async () => {
  if (!RUN) return;
  await f.openVersion(ADOL);
  items = (await f.query(`SELECT i.item_id FROM santulan.items i JOIN santulan.assessment_versions v USING (assessment_version_id) WHERE v.version_label = $1 ORDER BY i.display_order LIMIT 10`, [ADOL])).map((r) => r.item_id);
});
afterAll(async () => {
  if (RUN) { await f.restoreVersions(); await f.cleanupFixtures(); }
  await db.pool.end();
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
  current.deliveryLoad = { ...entry, recordedAt: new Date().toISOString(), informational: true, database: 'scratch (local)' };
  fs.writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
}

maybe('burst load', () => {
  jest.setTimeout(600000);

  test('40 participants burst-save and 80 participants burst-submit with no lost or duplicate writes', async () => {
    const group = await attempts(80);

    let t = Date.now();
    const saves = await Promise.all(group.slice(0, 40).flatMap((a) => items.map((id, i) => post(`/attempts/${a.id}/responses`, a.p, { itemId: id, value: String((i % 5) + 1), idempotencyKey: key(`load${i}`) }))));
    const saveMs = Date.now() - t;
    expect(saves.every((r) => r.status === 200)).toBe(true);
    const rows = await f.query(`SELECT attempt_id, count(*)::int AS n, count(*) FILTER (WHERE is_current)::int AS current FROM santulan.responses WHERE attempt_id = ANY($1) GROUP BY attempt_id`, [group.slice(0, 40).map((a) => a.id)]);
    expect(rows).toHaveLength(40);
    expect(rows.every((r) => r.n === items.length && r.current === items.length)).toBe(true);

    t = Date.now();
    const submits = await Promise.all(group.map((a) => post(`/attempts/${a.id}/submit`, a.p, { submissionKey: key('loadsubmit') })));
    const submitMs = Date.now() - t;
    expect(submits.every((r) => r.status === 200)).toBe(true);
    const events = await f.query(`SELECT count(*)::int AS n FROM santulan.response_events WHERE attempt_id = ANY($1) AND event_type = 'SUBMIT'`, [group.map((a) => a.id)]);
    expect(events[0].n).toBe(80);

    record({ participantsSaving: 40, savesPerParticipant: items.length, saveRequests: saves.length, saveTotalMs: saveMs, participantsSubmitting: 80, submitTotalMs: submitMs, poolMax: 10 });
  });
});

test('load test is opt-in (RUN_LOAD=1)', () => { expect(typeof RUN).toBe('boolean'); });
