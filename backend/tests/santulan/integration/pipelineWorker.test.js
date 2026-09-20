/*
 * T098 — submit -> quality -> score pipeline worker: HOLD/INVALID are left as set, scoring happens only after CLEAR, a failing
 * attempt does not block the others and is retried, concurrent workers process each attempt once, and a second pass is a no-op.
 * Opens the adolescent version for its duration and restores DRAFT/CLOSED afterwards.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const app = require('../../../src/app');
const db = require('../../../src/shared/db');
const config = require('../../../src/config');
const f = require('../helpers/committed');
const worker = require('../../../src/jobs/workers/pipelineWorker');

const ADOL = 'santulan-adolescent-pilot-v3.1';
const key = (tag) => `${tag}-${f.u()}-${f.u()}`;
const post = (p, who, body = {}) => request(app).post(`/api/v1${p}`).set({ Authorization: `Bearer ${who.token}` }).send(body);
const tmp = [];

beforeAll(async () => { await f.openVersion(ADOL); });
afterEach(() => { config.qualityPolicyPath = ''; });
afterAll(async () => {
  await f.restoreVersions();
  await f.cleanupFixtures();
  tmp.forEach((file) => fs.rmSync(file, { force: true }));
  await db.pool.end();
});

async function submitted() {
  const p = await f.participant(15);
  const id = (await post('/attempts', p)).body.attemptId;
  await post(`/attempts/${id}/sessions/resume`, p);
  await f.answerAll(id, () => '4');
  expect((await post(`/attempts/${id}/submit`, p, { submissionKey: key('sub') })).status).toBe(200);
  return id;
}
async function injectQ06(id) {
  const other = (await f.query(`SELECT i.item_id FROM santulan.items i JOIN santulan.assessment_versions v USING (assessment_version_id) WHERE v.version_label = 'santulan-emergingadult-pilot-v3.1' LIMIT 1`))[0].item_id;
  await f.owner(async (c) => {
    await c.query("SET session_replication_role = 'replica'");
    await c.query(`INSERT INTO santulan.responses (attempt_id, item_id, response_value, response_version, is_current, idempotency_key) VALUES ($1, $2, '3', 1, true, $3)`, [id, other, `fx-pq06-${id}`]);
  });
}
const status = async (id) => (await f.query('SELECT status FROM santulan.assessment_attempts WHERE attempt_id = $1', [id]))[0].status;
const scoreCount = async (id) => (await f.query('SELECT count(*)::int AS n FROM santulan.score_results WHERE attempt_id = $1', [id]))[0].n;
const qualityEvents = async (id) => (await f.query(`SELECT count(*)::int AS n FROM santulan.response_events WHERE attempt_id = $1 AND event_type = 'QUALITY_CHECK_COMPLETED'`, [id]))[0].n;

describe('pipeline worker', () => {
  test('is off unless explicitly enabled', () => {
    expect(worker.start({ enabled: false })).toBeNull();
    expect(worker.start({ enabled: undefined })).toBeNull();
  });

  test('scores CLEAR attempts, leaves an INVALID one as set, and a second pass finds nothing to do', async () => {
    const a = await submitted(); const b = await submitted(); const bad = await submitted();
    await injectQ06(bad);
    const first = await worker.runOnce({ scoringVersion: 'pipeline-test-v1' });
    expect(first).toMatchObject({ processed: 3, scored: 2, held: 0, invalid: 1, failed: 0 });
    expect([await status(a), await status(b), await status(bad)]).toEqual(['SCORED', 'SCORED', 'INVALID']);
    expect([await scoreCount(a), await scoreCount(b), await scoreCount(bad)]).toEqual([7, 7, 0]);
    expect((await f.query(`SELECT scoring_version FROM santulan.assessment_attempts WHERE attempt_id = $1`, [a]))[0].scoring_version).toBe('pipeline-test-v1');
    expect(await worker.runOnce({ scoringVersion: 'pipeline-test-v1' })).toMatchObject({ processed: 0, failed: 0 });
  });

  test('a failing attempt does not block the others; nothing is half-done; it is retried once the cause is fixed', async () => {
    const ids = [await submitted(), await submitted()];
    const file = path.join(os.tmpdir(), `santulan-${f.u()}-stub-policy.json`);
    fs.writeFileSync(file, JSON.stringify({ version: 'test-enabled-stub', detectors: { Q01: { enabled: true } } })); tmp.push(file);
    config.qualityPolicyPath = file;                                              // an enabled detector with no approved implementation: the run fails closed
    const failed = await worker.runOnce({ scoringVersion: 'pipeline-test-v1' });
    expect(failed).toMatchObject({ processed: 0, failed: 2 });
    for (const id of ids) {
      expect(await status(id)).toBe('SUBMITTED');                                 // the whole per-attempt transaction rolled back
      expect(await qualityEvents(id)).toBe(0);
      expect(await scoreCount(id)).toBe(0);
    }
    config.qualityPolicyPath = '';
    expect(await worker.runOnce({ scoringVersion: 'pipeline-test-v1' })).toMatchObject({ processed: 2, scored: 2, failed: 0 });
    for (const id of ids) expect(await status(id)).toBe('SCORED');
  });

  test('concurrent workers process each attempt exactly once (SKIP LOCKED): one quality event and one set of scores each', async () => {
    const ids = await Promise.all([1, 2, 3, 4, 5, 6].map(() => submitted()));
    const runs = await Promise.all([1, 2, 3].map(() => worker.runOnce({ scoringVersion: 'pipeline-test-v1' })));
    expect(runs.reduce((n, r) => n + r.processed, 0)).toBe(6);
    expect(runs.reduce((n, r) => n + r.failed, 0)).toBe(0);
    for (const id of ids) {
      expect(await status(id)).toBe('SCORED');
      expect(await scoreCount(id)).toBe(7);
      expect(await qualityEvents(id)).toBe(1);
    }
  });

  test('a Q09 hold is never picked up or scored', async () => {
    const id = await submitted();
    await f.query(`INSERT INTO santulan.quality_flags (attempt_id, flag_code, severity) VALUES ($1, 'Q09', 'CRITICAL')`, [id]);   // the database routes it to QUALITY_HOLD
    expect(await status(id)).toBe('QUALITY_HOLD');
    expect(await worker.runOnce({ scoringVersion: 'pipeline-test-v1' })).toMatchObject({ processed: 0 });
    expect(await scoreCount(id)).toBe(0);
    expect(await status(id)).toBe('QUALITY_HOLD');
  });
});
