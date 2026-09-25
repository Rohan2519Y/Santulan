/* Scoring rules through the store (B06-001..060; SC-015..SC-017): eligibility, statuses, no imputation, evidence, idempotency, atomicity. */
const store = require('../../../src/models/db');
const scoringRules = require('../../../src/services/domain/scoringRules');
const scoreService = require('../../../src/services/scoring/scoreService');
const { closeClient } = require('../../../src/models/db/client');
const f = require('../helpers/committed');
const P = require('../helpers/pipeline');
const H = require('../helpers/mongoHarness');

let S; let adminCtx;
beforeAll(async () => {
  adminCtx = await f.admin();
  S = await f.openSet({ ageGroup: 'ADOLESCENT', perDomain: 10, optionCounts: [] }); // 70 questions: 10 per domain, 5 options each
});
afterAll(async () => { await f.closeOpenSets(); await f.cleanupFixtures(); await closeClient(); await H.closeAll(); });

const byDomain = (d) => S.items.filter((i) => i.domainCode === d);
const rowOf = (rows, d) => rows.find((r) => r.domain_code === d);

describe('the seven results (B06-011..015, 032; SC-015)', () => {
  test('B06-011 a fully answered attempt gets seven rows: COMPLETE, mean of the positions, S1 by default, nothing else changes', async () => {
    const a = await P.submittedAttempt(S, { value: (i) => 4 });
    const r = await P.runPipeline(a.attemptId);
    expect(r.quality.outcome).toBe('CLEAR');
    expect(r.score.outcome).toBe('SCORED');
    const rows = await P.scoresOf(a.attemptId);
    expect(rows.map((x) => x.domain_code)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']);
    for (const row of rows) expect(row).toMatchObject({ raw_score: 4, eligible_items: 10, valid_items: 10, completeness_rate: 1, completeness_status: 'COMPLETE', score_status: 'S1', scoring_version: 'domain-mean-v1' });
    const attempt = await P.attemptOf(a.attemptId);
    expect(attempt).toMatchObject({ status: 'SCORED', scoring_version: 'domain-mean-v1' });
    expect(attempt.completed_at).toBeInstanceOf(Date);
    expect(await (await H.admin()).collection('reports').countDocuments({ attempt_id: a.attemptId })).toBe(0); // scoring never creates a report
  });

  test.each([
    [10, 'COMPLETE', true], [9, 'COMPLETE_WITH_MISSING', true], [8, 'INCOMPLETE', true], [7, 'INCOMPLETE', true], [6, 'INSUFFICIENT', false], [3, 'INSUFFICIENT', false],
  ])('B06-012..015 %i of 10 answered in C2 -> %s, %s', async (answered, status, hasScore) => {
    const c2 = byDomain('C2').map((i) => i.itemId);
    const a = await P.submittedAttempt(S, { value: (i) => (i.domainCode !== 'C2' ? 3 : c2.indexOf(i.itemId) < answered ? 5 : null) });
    await P.runPipeline(a.attemptId);
    const rows = await P.scoresOf(a.attemptId);
    const c2row = rowOf(rows, 'C2');
    expect(c2row).toMatchObject({ eligible_items: 10, valid_items: answered, completeness_status: status });
    expect(c2row.raw_score === null).toBe(!hasScore);
    if (hasScore) expect(c2row.raw_score).toBe(5); // no imputation: the mean of the answers that exist
    expect(c2row.score_status).toBe(status === 'INSUFFICIENT' ? 'S0' : 'S1');
    expect(rowOf(rows, 'C1')).toMatchObject({ completeness_status: 'COMPLETE', raw_score: 3 }); // other domains are unaffected
  });

  test('B06-016 an answer that was revised counts only in its CURRENT version', async () => {
    const a = await P.submittedAttempt(S, { value: (i) => 2 });
    const db = await H.admin();
    const item = byDomain('C1')[0];
    await db.collection('responses').updateOne({ attempt_id: a.attemptId, item_id: item.itemId }, { $set: { is_current: false } });
    await db.collection('responses').insertOne(require('../helpers/fixtures').response(a.attemptId, item.itemId, { response_value: '5', response_version: 2, supersedes_response_id: null, idempotency_key: `fx-rev-${a.attemptId}` }));
    await P.runPipeline(a.attemptId);
    expect(rowOf(await P.scoresOf(a.attemptId), 'C1').raw_score).toBe(2.3); // nine answers of 2 and the revised 5: (9*2 + 5) / 10
  });

  test('B06-017 mixed option counts inside one domain score by position, not by raw value', async () => {
    const mixed = await f.openSet({ ageGroup: 'ADOLESCENT', perDomain: 3, optionCounts: [2, 3, 9, 2, 3, 9, 2, 3, 9, 2, 3, 9, 2, 3, 9, 2, 3, 9, 2, 3, 9] });
    const a = await P.submittedAttempt(mixed, { value: (i) => i.optionCount }); // the LAST option of every question
    await P.runPipeline(a.attemptId);
    for (const r of await P.scoresOf(a.attemptId)) expect(r.raw_score).toBe(5);
    const b = await P.submittedAttempt(mixed, { value: () => 1 }); // the FIRST option of every question
    await P.runPipeline(b.attemptId);
    for (const r of await P.scoresOf(b.attemptId)) expect(r.raw_score).toBe(1);
    await f.openSet({ ageGroup: 'ADOLESCENT', perDomain: 10 }); // restore the shared fixture set for the following tests
    S = (await f.openSet({ ageGroup: 'ADOLESCENT', perDomain: 10 }));
  });
});

describe('checks before scoring (B06-001..010)', () => {
  test('B06-001 only a SUBMITTED attempt is scored', async () => {
    const a = await P.submittedAttempt(S, { status: 'IN_PROGRESS' });
    await expect(scoreService.scoreAttempt(a.attemptId, 'domain-mean-v1')).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(await P.scoresOf(a.attemptId)).toEqual([]);
  });

  test('B06-002 quality first: scoring without a CLEAR quality outcome is QUALITY_NOT_CLEAR and writes nothing', async () => {
    const a = await P.submittedAttempt(S);
    await expect(scoreService.scoreAttempt(a.attemptId, 'domain-mean-v1')).rejects.toMatchObject({ status: 409, code: 'QUALITY_NOT_CLEAR' });
    expect(await P.scoresOf(a.attemptId)).toEqual([]);
    expect((await P.attemptOf(a.attemptId)).status).toBe('SUBMITTED');
  });

  test('B06-003 a scoring version is required and a second run with the same version is ALREADY_SCORED with no new rows', async () => {
    const a = await P.submittedAttempt(S);
    await scoreService.runQualityCheck(a.attemptId);
    await expect(scoreService.scoreAttempt(a.attemptId, '  ')).rejects.toMatchObject({ status: 422 });
    expect((await scoreService.scoreAttempt(a.attemptId, 'domain-mean-v1')).outcome).toBe('SCORED');
    expect((await scoreService.scoreAttempt(a.attemptId, 'domain-mean-v1')).outcome).toBe('ALREADY_SCORED');
    expect(await P.scoresOf(a.attemptId)).toHaveLength(7);
    await expect(scoreService.scoreAttempt(a.attemptId, 'domain-mean-v2')).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(await P.scoresOf(a.attemptId)).toHaveLength(7);
  });

  test('B06-004 two concurrent scorers give exactly one set of seven rows', async () => {
    const a = await P.submittedAttempt(S);
    await scoreService.runQualityCheck(a.attemptId);
    const results = await Promise.allSettled([1, 2, 3].map(() => scoreService.scoreAttempt(a.attemptId, 'domain-mean-v1')));
    expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    expect(await P.scoresOf(a.attemptId)).toHaveLength(7);
    expect((await P.attemptOf(a.attemptId)).status).toBe('SCORED');
  });

  test('B06-005 a reverse-keyed question fails the run closed and leaves nothing', async () => {
    const set = await f.openSet({ ageGroup: 'ADOLESCENT', perDomain: 1 });
    const a = await P.submittedAttempt(set);
    await scoreService.runQualityCheck(a.attemptId);
    const db = await H.admin();
    await db.collection('items').updateOne({ assessment_version_id: set.setId, item_code: 'C1-01' }, { $set: { keying: 'REVERSE' } });
    await expect(scoreService.scoreAttempt(a.attemptId, 'domain-mean-v1')).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(await P.scoresOf(a.attemptId)).toEqual([]);
    expect((await P.attemptOf(a.attemptId)).status).toBe('SUBMITTED');
    S = await f.openSet({ ageGroup: 'ADOLESCENT', perDomain: 10 });
  });

  test('B06-006 a failure part-way leaves no partial rows (the store refuses a bad row inside the transaction)', async () => {
    const a = await P.submittedAttempt(S);
    await scoreService.runQualityCheck(a.attemptId);
    await expect(store.withScope(store.systemScope(), async (tx) => {
      await scoringRules.scoreAttempt(tx, a.attemptId, 'domain-mean-v1', { evidence: {}, switches: {} });
      throw new Error('simulated failure after the rows were written');
    }, { transaction: true })).rejects.toThrow('simulated failure');
    expect(await P.scoresOf(a.attemptId)).toEqual([]);
    expect((await P.attemptOf(a.attemptId)).status).toBe('SUBMITTED');
  });
});

describe('eligibility uses the age group, never a flat total (B06-020)', () => {
  test('B06-020 only CORE + ACTIVE questions whose band and context fit the group are eligible for a domain', () => {
    const q = (o) => ({ layer: 'CORE', status: 'ACTIVE', age_band: '13–17', context: 'School', ...o });
    const { eligibleForGroup } = require('../../../src/services/domain/questionSetRules');
    expect(eligibleForGroup(q(), 'ADOLESCENT')).toBe(true);
    expect(eligibleForGroup(q({ age_band: '13–25', context: 'General' }), 'ADOLESCENT')).toBe(true);
    expect(eligibleForGroup(q({ age_band: '18–25' }), 'ADOLESCENT')).toBe(false);
    expect(eligibleForGroup(q({ context: 'College/Work' }), 'ADOLESCENT')).toBe(false);
    expect(eligibleForGroup(q({ layer: 'V' }), 'ADOLESCENT')).toBe(false);
    expect(eligibleForGroup(q({ status: 'RETIRED' }), 'ADOLESCENT')).toBe(false);
    expect(eligibleForGroup(q({ age_band: '18–25', context: 'College/Work' }), 'EMERGING_ADULT')).toBe(true);
    expect(eligibleForGroup(q({ age_band: '13–17', context: 'School' }), 'EMERGING_ADULT')).toBe(false);
  });
});

describe('Q06 and Q07 (B06-007..010, 048, 051)', () => {
  test('B06-007 a current answer to another set\'s question is Q06: no score, attempt INVALID, Q06 flag', async () => {
    const other = await f.openSet({ ageGroup: 'EMERGING_ADULT', perDomain: 1, open: false });
    const a = await P.submittedAttempt(S);
    const db = await H.admin();
    await db.collection('responses').insertOne(require('../helpers/fixtures').response(a.attemptId, other.items[0].itemId, { idempotency_key: `fx-q06-${a.attemptId}` }));
    const r = await P.runPipeline(a.attemptId);
    expect(r.quality.outcome).toBe('INVALID');
    expect(r.score).toBeNull();
    expect(await P.scoresOf(a.attemptId)).toEqual([]);
    expect((await P.attemptOf(a.attemptId)).status).toBe('INVALID');
    expect((await db.collection('quality_flags').find({ attempt_id: a.attemptId }).toArray()).map((x) => x.flag_code)).toEqual(['Q06']);
    await S && true;
  });

  test('B06-008 Q07 is raised for every INCOMPLETE or INSUFFICIENT domain, LOW, once, and never changes the attempt state', async () => {
    const c2 = byDomain('C2').map((i) => i.itemId); const c5 = byDomain('C5').map((i) => i.itemId);
    const a = await P.submittedAttempt(S, { value: (i) => (i.domainCode === 'C2' ? (c2.indexOf(i.itemId) < 8 ? 3 : null) : i.domainCode === 'C5' ? (c5.indexOf(i.itemId) < 4 ? 3 : null) : 3) });
    await P.runPipeline(a.attemptId);
    const flags = await (await H.admin()).collection('quality_flags').find({ attempt_id: a.attemptId, flag_code: 'Q07' }).sort({ domain_code: 1 }).toArray();
    expect(flags.map((x) => [x.domain_code, x.severity])).toEqual([['C2', 'LOW'], ['C5', 'LOW']]);
    expect((await P.attemptOf(a.attemptId)).status).toBe('SCORED');
    await scoreService.scoreAttempt(a.attemptId, 'domain-mean-v1'); // a repeat run raises nothing new
    expect(await (await H.admin()).collection('quality_flags').countDocuments({ attempt_id: a.attemptId, flag_code: 'Q07' })).toBe(2);
  });

  test('B06-009 a complete attempt raises no Q07', async () => {
    const a = await P.scoredAttempt(S);
    expect(await (await H.admin()).collection('quality_flags').countDocuments({ attempt_id: a.attemptId })).toBe(0);
  });
});
