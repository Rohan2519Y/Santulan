/*
 * Submit -> quality -> score pipeline worker (MongoDB): HOLD/INVALID are left as set, scoring happens only after CLEAR, a failing
 * attempt does not block the others and is retried, concurrent workers process each attempt once, and a second pass is a no-op.
 * Opens an adolescent question set for its duration.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../../../src/config');
const f = require('../helpers/committed');
const F = require('../helpers/fixtures');
const H = require('../helpers/mongoHarness');
const P = require('../helpers/pipeline');
const worker = require('../../../src/jobs/workers/pipelineWorker');
const { closeClient } = require('../../../src/models/db/client');

const tmp = [];
let S;
beforeAll(async () => { S = await f.openSet({ ageGroup: 'ADOLESCENT', perDomain: 2 }); });
afterEach(() => { config.qualityPolicyPath = ''; });
afterAll(async () => { tmp.forEach((file) => fs.rmSync(file, { force: true })); await f.closeOpenSets(); await f.cleanupFixtures(); await closeClient(); await H.closeAll(); });

const submitted = async () => (await P.submittedAttempt(S, { value: () => 4 })).attemptId;
async function injectQ06(id) {
  const otherSet = await f.insert('assessment_versions', F.versionDoc({ configuration: 'EMERGING_ADULT', participant_min_age: 18, participant_max_age: 25 }));
  const other = await f.insert('items', F.item(otherSet._id));
  await (await H.admin()).collection('responses').insertOne(F.response(id, other._id, { idempotency_key: `fx-pq06-${id}` }));
}
const status = async (id) => (await P.attemptOf(id)).status;
const scoreCount = async (id) => (await H.admin()).collection('score_results').countDocuments({ attempt_id: id });
const qualityEvents = async (id) => (await H.admin()).collection('response_events').countDocuments({ attempt_id: id, event_type: 'QUALITY_CHECK_COMPLETED' });
// this suite owns every SUBMITTED fixture attempt in the scratch database: park leftovers so counts are exact
const parkOthers = async () => (await H.admin()).collection('assessment_attempts').updateMany({ status: 'SUBMITTED', assessment_version_id: { $ne: S.setId } }, { $set: { status: 'EXPIRED' } });

describe('pipeline worker', () => {
  beforeEach(parkOthers);

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
    expect((await P.attemptOf(a)).scoring_version).toBe('pipeline-test-v1');
    expect(await worker.runOnce({ scoringVersion: 'pipeline-test-v1' })).toMatchObject({ processed: 0, failed: 0 });
  });

  test('a failing attempt does not block the others; nothing is half-done; it is retried once the cause is fixed', async () => {
    const ids = [await submitted(), await submitted()];
    const file = path.join(os.tmpdir(), `santulan-${f.u()}-stub-policy.json`);
    fs.writeFileSync(file, JSON.stringify({ version: 'test-enabled-stub', detectors: { Q01: { enabled: true } } })); tmp.push(file);
    config.qualityPolicyPath = file; // an enabled detector with no approved implementation: the run fails closed
    const failed = await worker.runOnce({ scoringVersion: 'pipeline-test-v1' });
    expect(failed).toMatchObject({ processed: 0, failed: 2 });
    for (const id of ids) {
      expect(await status(id)).toBe('SUBMITTED'); // the whole per-attempt transaction rolled back
      expect(await qualityEvents(id)).toBe(0);
      expect(await scoreCount(id)).toBe(0);
    }
    config.qualityPolicyPath = '';
    expect(await worker.runOnce({ scoringVersion: 'pipeline-test-v1' })).toMatchObject({ processed: 2, scored: 2, failed: 0 });
    for (const id of ids) expect(await status(id)).toBe('SCORED');
  });

  test('concurrent workers process each attempt exactly once: one quality event and one set of scores each', async () => {
    const ids = await Promise.all([1, 2, 3, 4, 5, 6].map(() => submitted()));
    const runs = await Promise.all([1, 2, 3].map(() => worker.runOnce({ scoringVersion: 'pipeline-test-v1' })));
    // a worker that loses a race skips the attempt (counted as failed) and a later pass finishes it: the end state is what matters
    await worker.runOnce({ scoringVersion: 'pipeline-test-v1' });
    expect(runs.reduce((n, r) => n + r.processed, 0)).toBeLessThanOrEqual(6);
    for (const id of ids) {
      expect(await status(id)).toBe('SCORED');
      expect(await scoreCount(id)).toBe(7);
      expect(await qualityEvents(id)).toBe(1);
    }
  });

  test('a Q09 hold is never picked up or scored', async () => {
    const id = await submitted();
    await (await H.admin()).collection('assessment_attempts').updateOne({ _id: id }, { $set: { status: 'QUALITY_HOLD' } });
    await (await H.admin()).collection('quality_flags').insertOne(F.qualityFlag(id, { flag_code: 'Q09', severity: 'CRITICAL', domain_code: null }));
    expect(await worker.runOnce({ scoringVersion: 'pipeline-test-v1' })).toMatchObject({ processed: 0 });
    expect(await scoreCount(id)).toBe(0);
    expect(await status(id)).toBe('QUALITY_HOLD');
  });
});
