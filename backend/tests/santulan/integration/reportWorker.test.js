/*
 * The report worker (MongoDB): it claims SCORED attempts (and submitted QUALITY_HOLD / INVALID ones) without a finished report,
 * generates each in its own transactions, leaves FAILED_RETRYABLE for the controlled retry, and is idempotent. Scratch database,
 * committed fixtures.
 */
const p = require('../helpers/contractPipeline');
const worker = require('../../../src/jobs/workers/reportWorker');
const { closeClient } = require('../../../src/models/db/client');

const { f, H, P, scoredAttempt, terminalAttempt, attemptStatus, clearRules } = p;
const reportOf = async (attemptId) => (await H.admin()).collection('reports').findOne({ attempt_id: attemptId });

beforeAll(async () => { await p.openAdolescentSet(); });
beforeEach(() => P.approveWording(p.currentSet().setId));
afterEach(async () => { await clearRules(); await p.resetSwitches(); });
afterAll(async () => { await f.closeOpenSets(); await f.cleanupFixtures(); await closeClient(); await H.closeAll(); });

describe('report worker', () => {
  test('one pass builds a REPORT_READY report, a T11 and a T12; a second pass finds nothing; attempts move only as the contract allows', async () => {
    const scored = await scoredAttempt({ s2: true });
    const held = await terminalAttempt('QUALITY_HOLD', { q09: true });
    const invalid = await terminalAttempt('INVALID');
    const tally = await worker.runOnce();
    expect(tally.errors).toBe(0);
    expect(tally.processed).toBeGreaterThanOrEqual(3);
    expect(await reportOf(scored.id)).toMatchObject({ generation_status: 'REPORT_READY', report_type: 'STANDARD', retry_count: 0 });
    expect(await reportOf(held.id)).toMatchObject({ generation_status: 'UNDER_REVIEW', report_type: 'T11' });
    expect(await reportOf(invalid.id)).toMatchObject({ generation_status: 'NOT_ELIGIBLE', report_type: 'T12' });
    expect([await attemptStatus(scored.id), await attemptStatus(held.id), await attemptStatus(invalid.id)]).toEqual(['REPORT_READY', 'QUALITY_HOLD', 'INVALID']);
    expect(await worker.runOnce()).toMatchObject({ processed: 0, errors: 0 });
  }, 60000);

  test('a render failure leaves FAILED_RETRYABLE with the attempt SCORED; the worker does not retry it (the retry is a controlled, audited action)', async () => {
    const a = await scoredAttempt({ s2: true });
    const tally = await worker.runOnce({ renderer: async () => { throw new Error('forced'); } });
    expect(tally.failed).toBeGreaterThanOrEqual(1);
    expect(await reportOf(a.id)).toMatchObject({ generation_status: 'FAILED_RETRYABLE', retry_count: 0 });
    expect(await attemptStatus(a.id)).toBe('SCORED');
    expect(await worker.runOnce()).toMatchObject({ processed: 0 }); // not picked up again
    expect((await reportOf(a.id)).generation_status).toBe('FAILED_RETRYABLE');
  });

  test('a missing layer of approved wording fails that report closed (WORDING_MISSING) without blocking the others', async () => {
    await clearRules(); // no approved wording at all: an S2 report cannot be built
    const third = await scoredAttempt({ s2: true });
    const other = await terminalAttempt('INVALID');
    expect(await worker.runOnce()).toMatchObject({ failed: 1, terminal: 1, errors: 0 });
    expect(await reportOf(third.id)).toMatchObject({ generation_status: 'FAILED_RETRYABLE', last_error_code: 'WORDING_MISSING' });
    expect((await reportOf(other.id)).generation_status).toBe('NOT_ELIGIBLE');
    expect(await attemptStatus(third.id)).toBe('SCORED');
  });

  test('two workers running together never build the same report twice', async () => {
    const attempts = [await scoredAttempt({ s2: true }), await scoredAttempt({ s2: true })];
    const [x, y] = await Promise.all([worker.runOnce(), worker.runOnce()]);
    expect(x.errors + y.errors).toBe(0);
    const db = await H.admin();
    for (const a of attempts) expect(await db.collection('reports').countDocuments({ attempt_id: a.id })).toBe(1);
    const reportIds = (await Promise.all(attempts.map((a) => reportOf(a.id)))).map((r) => r._id);
    expect(await db.collection('audit_logs').countDocuments({ action_type: 'REPORT_GENERATED', target_id: { $in: reportIds } })).toBe(2);
  });

  test('the worker is off unless REPORT_WORKER=on', () => {
    expect(worker.start({ enabled: false })).toBeNull();
    const timer = worker.start({ enabled: true, intervalMs: 3600000 });
    expect(timer).not.toBeNull();
    clearInterval(timer);
  });
});
