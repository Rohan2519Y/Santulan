/* Quality rules (B06-002..010, 048, 051; FR-051, FR-052): Q05 inactive, Q01-Q04/Q08 inert stubs fail closed, Q09 only from approved sources. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../../../src/config');
const scoreService = require('../../../src/modules/santulan/scoring/scoreService');
const { fireQ09, setP5Hook } = require('../../../src/modules/santulan/quality/q09Trigger');
const policyLoader = require('../../../src/modules/santulan/quality/policyLoader');
const { closeClient } = require('../../../src/modules/santulan/store/client');
const f = require('../helpers/committed');
const P = require('../helpers/pipeline');
const H = require('../helpers/mongoHarness');

let S;
beforeAll(async () => { S = await f.openSet({ ageGroup: 'ADOLESCENT', perDomain: 2 }); });
afterAll(async () => { config.qualityPolicyPath = ''; await f.closeOpenSets(); await f.cleanupFixtures(); await closeClient(); await H.closeAll(); });

const writePolicy = (obj) => { const p = path.join(os.tmpdir(), `quality-${Date.now()}-${Math.random()}.json`); fs.writeFileSync(p, JSON.stringify(obj)); return p; };
const flagsOf = async (id) => (await H.admin()).collection('quality_flags').find({ attempt_id: id }).sort({ flag_code: 1 }).toArray();

describe('the built-in policy runs only the deterministic Q06 stop', () => {
  test('B06-030 a normal attempt is CLEAR and the outcome is recorded once per policy version (idempotent)', async () => {
    const a = await P.submittedAttempt(S);
    const first = await scoreService.runQualityCheck(a.attemptId);
    expect(first).toMatchObject({ outcome: 'CLEAR', policyVersion: 'q06-only' });
    const again = await scoreService.runQualityCheck(a.attemptId);
    expect(again.outcome).toBe('CLEAR');
    expect(await (await H.admin()).collection('response_events').countDocuments({ attempt_id: a.attemptId, event_type: 'QUALITY_CHECK_COMPLETED' })).toBe(1);
    expect(await flagsOf(a.attemptId)).toEqual([]);
  });

  test('B06-031 a quality check runs only on a submitted attempt', async () => {
    const a = await P.submittedAttempt(S, { status: 'IN_PROGRESS' });
    await expect(scoreService.runQualityCheck(a.attemptId)).rejects.toMatchObject({ status: 422, code: 'INVALID_STATE' });
    await expect(scoreService.runQualityCheck('00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({ status: 404 });
  });
});

describe('Q01-Q04 and Q08 are inert stubs; an approved policy that enables one fails closed (FR-051)', () => {
  test.each(['Q01', 'Q02', 'Q03', 'Q04', 'Q08'])('B06-032 enabling %s in the policy fails the run and does NOT clear the attempt', async (code) => {
    config.qualityPolicyPath = writePolicy({ version: `enable-${code}`, detectors: { [code]: { enabled: true } } });
    try {
      const a = await P.submittedAttempt(S);
      await expect(scoreService.runQualityCheck(a.attemptId)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
      expect(await (await H.admin()).collection('response_events').countDocuments({ attempt_id: a.attemptId, event_type: 'QUALITY_CHECK_COMPLETED' })).toBe(0);
      expect((await P.attemptOf(a.attemptId)).status).toBe('SUBMITTED');
    } finally { config.qualityPolicyPath = ''; }
  });

  test('B06-033 a policy that disables them (or does not mention them) changes nothing', async () => {
    config.qualityPolicyPath = writePolicy({ version: 'stubs-off', detectors: { Q01: { enabled: false }, Q02: {} } });
    try {
      const a = await P.submittedAttempt(S);
      expect((await scoreService.runQualityCheck(a.attemptId)).outcome).toBe('CLEAR');
    } finally { config.qualityPolicyPath = ''; }
  });

  test('B06-034 an unreadable policy file fails closed (no outcome recorded)', async () => {
    const p = path.join(os.tmpdir(), `quality-bad-${Date.now()}.json`);
    fs.writeFileSync(p, '{ not json');
    config.qualityPolicyPath = p;
    try {
      const a = await P.submittedAttempt(S);
      await expect(scoreService.runQualityCheck(a.attemptId)).rejects.toMatchObject({ status: 503 });
      expect(() => policyLoader.loadPolicy(p)).toThrow();
    } finally { config.qualityPolicyPath = ''; }
  });
});

describe('Q05 stays inactive (FR-051, A-15a)', () => {
  test('B06-035 a second attempt by the same participant is never labelled a duplicate', async () => {
    const a = await P.scoredAttempt(S);
    const db = await H.admin();
    await db.collection('assessment_attempts').updateOne({ _id: a.attemptId }, { $set: { status: 'REPORT_READY' } }); // a finished earlier attempt
    const second = await P.submittedAttempt(S);
    // a different participant object: reassign the second attempt to the same participant to model a legitimate reassessment
    await db.collection('assessment_attempts').updateOne({ _id: second.attemptId }, { $set: { participant_id: a.participantId } });
    expect((await scoreService.runQualityCheck(second.attemptId)).outcome).toBe('CLEAR');
    expect((await flagsOf(second.attemptId)).map((x) => x.flag_code)).not.toContain('Q05');
  });
});

describe('Q09 only from an approved trigger source (B06-048, 051)', () => {
  test('B06-048 with no approved source nothing fires: no flag, no hold, no P5', async () => {
    const a = await P.submittedAttempt(S);
    expect(await fireQ09({ attemptId: a.attemptId, triggerSource: 'anything' })).toEqual({ fired: false, reason: 'NO_APPROVED_TRIGGER' });
    expect(await flagsOf(a.attemptId)).toEqual([]);
    expect((await P.attemptOf(a.attemptId)).status).toBe('SUBMITTED');
  });

  test('B06-049 an approved source records a CRITICAL Q09 once, routes the attempt to QUALITY_HOLD, fires the P5 hook once, and never scores', async () => {
    config.qualityPolicyPath = writePolicy({ version: 'q09-approved', detectors: { Q09: { approvedTriggerSources: ['test-source'] } } });
    const calls = [];
    setP5Hook(async (tx, ctx) => { calls.push(ctx.attemptId); });
    try {
      const a = await P.submittedAttempt(S);
      const r1 = await fireQ09({ attemptId: a.attemptId, triggerSource: 'test-source', correlationId: 'q09-1' });
      expect(r1).toMatchObject({ fired: true, attemptStatus: 'QUALITY_HOLD' });
      const r2 = await fireQ09({ attemptId: a.attemptId, triggerSource: 'test-source' });
      expect(r2.fired).toBe(true);
      expect(calls).toEqual([a.attemptId]); // one hook call for two triggers
      const flags = await flagsOf(a.attemptId);
      expect(flags.map((x) => [x.flag_code, x.severity])).toEqual([['Q09', 'CRITICAL']]);
      expect(await (await H.admin()).collection('audit_logs').countDocuments({ action_type: 'Q09_FIRED', target_id: a.attemptId })).toBe(1);
      expect(await P.scoresOf(a.attemptId)).toEqual([]);
      await expect(scoreService.scoreAttempt(a.attemptId, 'domain-mean-v1')).rejects.toBeTruthy(); // a held attempt is never scored
      expect(JSON.stringify(await (await H.admin()).collection('audit_logs').find({ target_id: a.attemptId }).toArray())).not.toMatch(/test-source/);
    } finally { config.qualityPolicyPath = ''; setP5Hook(null); }
  });

  test('B06-050 Q09 is never derived from a score: a very low scoring attempt raises no Q09 (and no P3 / P4)', async () => {
    const a = await P.scoredAttempt(S, { value: () => 1 });
    const flags = (await flagsOf(a.attemptId)).map((x) => x.flag_code);
    expect(flags).not.toContain('Q09');
    expect(await (await H.admin()).collection('pathway_decisions').countDocuments({ source_attempt_id: a.attemptId })).toBe(0);
  });

  test('B06-051 a QUALITY_HOLD attempt reports the neutral hold outcome, never a score', async () => {
    const a = await P.submittedAttempt(S);
    await (await H.admin()).collection('quality_flags').insertOne(require('../helpers/fixtures').qualityFlag(a.attemptId, { flag_code: 'Q09', severity: 'CRITICAL', domain_code: null }));
    const q = await scoreService.runQualityCheck(a.attemptId);
    expect(q.outcome).toBe('HOLD');
    expect((await P.attemptOf(a.attemptId)).status).toBe('QUALITY_HOLD');
    expect(await P.scoresOf(a.attemptId)).toEqual([]);
  });
});
