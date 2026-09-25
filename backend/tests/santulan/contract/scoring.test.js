/*
 * Quality and scoring API contract (BUILD 06: B06-002, 042, 048, 051 and the sections 14-15 rules) on MongoDB. Through the real app and
 * the runtime credential on the SCRATCH database. It opens an adolescent question set for its duration; governed configuration files
 * are pointed at temporary fixtures and reset after each test. The participant score endpoint of feature 005 is withdrawn (B06-042).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { v4: uuidv4 } = require('uuid');
const app = require('../../../src/app');
const config = require('../../../src/config');
const f = require('../helpers/committed');
const F = require('../helpers/fixtures');
const H = require('../helpers/mongoHarness');
const P = require('../helpers/pipeline');
const { closeClient } = require('../../../src/models/db/client');

const INTERNAL = { 'X-Internal-Api-Key': 'test-internal-key' };
const api = () => request(app);
const internal = (method, p, body) => api()[method](`/api/v1${p}`).set(INTERNAL).send(body);
const tmp = [];
const writeTmp = (name, data) => { const file = path.join(os.tmpdir(), `santulan-${f.u()}-${name}`); fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data)); tmp.push(file); return file; };
const count = async (coll, filter) => (await H.admin()).collection(coll).countDocuments(filter);

let S;
let admin;
beforeAll(async () => { S = await f.openSet({ ageGroup: 'ADOLESCENT', perDomain: 2 }); admin = await f.admin(); });
afterEach(async () => {
  config.qualityPolicyPath = ''; config.evidenceConfigPath = '';
  await P.setSwitch('pilotS2', false, admin.adminUserId);
});
afterAll(async () => { tmp.forEach((file) => fs.rmSync(file, { force: true })); await f.closeOpenSets(); await f.cleanupFixtures(); await closeClient(); await H.closeAll(); });

const submitted = (opts) => P.submittedAttempt(S, { value: () => 3, ...opts }).then((a) => ({ p: { participantId: a.participantId, token: a.token }, id: a.attemptId }));
const status = async (id) => (await P.attemptOf(id)).status;
const rows = async (id) => (await P.scoresOf(id)).map((r) => ({ domain_code: r.domain_code, raw_score: r.raw_score, score_status: r.score_status }));

describe('access and request schemas', () => {
  test('the engines need the internal key; participant, admin and missing credentials are refused; the score body is {scoringVersion} only', async () => {
    const a = await submitted();
    for (const seg of ['quality', 'score']) {
      const url = `/api/v1/internal/attempts/${a.id}/${seg}`;
      const body = seg === 'score' ? { scoringVersion: 'v1' } : {};
      expect((await api().post(url).send(body)).status).toBe(403);
      expect((await api().post(url).set({ Authorization: `Bearer ${a.p.token}` }).send(body)).status).toBe(403);
      expect((await api().post(url).set({ Authorization: `Bearer ${admin.token}` }).send(body)).status).toBe(403);
      expect((await api().post(url).set({ 'X-Internal-Api-Key': 'wrong' }).send(body)).status).toBe(403);
    }
    for (const body of [{ scoringVersion: 'v1', rawScore: 5 }, { scoringVersion: 'v1', scoreStatus: 'S2' }, { scoringVersion: 'v1', score: 4 }, {}, { scoringVersion: '' }, { scoringVersion: 'bad version!' }, { scoringVersion: 5 }]) {
      const res = await internal('post', `/internal/attempts/${a.id}/score`, body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect((await internal('post', `/internal/attempts/${a.id}/quality`, { disposition: 'CLEAR' })).status).toBe(400);
    expect((await internal('post', '/internal/attempts/not-a-uuid/score', { scoringVersion: 'v1' })).status).toBe(404);
    expect((await internal('post', '/internal/attempts/00000000-0000-4000-8000-000000000000/quality', {})).status).toBe(404);
    expect(await rows(a.id)).toEqual([]);
    expect(await status(a.id)).toBe('SUBMITTED');
  });
});

describe('quality first, then scoring (B06-001, 002)', () => {
  test('scoring before a CLEAR quality outcome is refused; quality is idempotent; scoring is idempotent and version-bound; the run ends at SCORED', async () => {
    const a = await submitted();
    const early = await internal('post', `/internal/attempts/${a.id}/score`, { scoringVersion: 'v1' });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('QUALITY_NOT_CLEAR');
    expect(await rows(a.id)).toEqual([]);

    const q1 = await internal('post', `/internal/attempts/${a.id}/quality`, {});
    expect(q1.status).toBe(200);
    expect(q1.body).toMatchObject({ outcome: 'CLEAR', policyVersion: 'q06-only' });
    await internal('post', `/internal/attempts/${a.id}/quality`, {}); // retry
    expect(await count('response_events', { attempt_id: a.id, event_type: 'QUALITY_CHECK_COMPLETED' })).toBe(1);

    const s1 = await internal('post', `/internal/attempts/${a.id}/score`, { scoringVersion: 'scoring-v1' });
    expect(s1.body).toMatchObject({ outcome: 'SCORED', scoringVersion: 'scoring-v1' });
    expect(await rows(a.id)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'].map((d) => ({ domain_code: d, raw_score: 3, score_status: 'S1' })));
    expect(await status(a.id)).toBe('SCORED');
    expect((await internal('post', `/internal/attempts/${a.id}/score`, { scoringVersion: 'scoring-v1' })).body.outcome).toBe('ALREADY_SCORED');
    expect((await internal('post', `/internal/attempts/${a.id}/score`, { scoringVersion: 'scoring-v2' })).status).toBe(409); // bound to v1
    expect(await rows(a.id)).toHaveLength(7);
    expect(await count('reports', { attempt_id: a.id })).toBe(0); // BUILD 06 ends at SCORED
    expect(await count('audit_logs', { action_type: 'ATTEMPT_SCORED', target_id: a.id })).toBe(1);
    expect((await internal('post', `/internal/attempts/${a.id}/quality`, {})).status).toBe(422); // quality runs on SUBMITTED attempts
  });

  test('simultaneous scorers produce exactly one set of seven rows', async () => {
    const a = await submitted();
    await internal('post', `/internal/attempts/${a.id}/quality`, {});
    const results = await Promise.all([1, 2, 3].map(() => internal('post', `/internal/attempts/${a.id}/score`, { scoringVersion: 'scoring-v1' })));
    expect(results.filter((r) => r.body.outcome === 'SCORED')).toHaveLength(1);
    expect(results.every((r) => r.status === 200 || r.status === 409 || r.status === 503)).toBe(true);
    expect(await rows(a.id)).toHaveLength(7);
    const again = await internal('post', `/internal/attempts/${a.id}/score`, { scoringVersion: 'scoring-v1' });
    expect(again.body.outcome).toBe('ALREADY_SCORED');
  });
});

describe('participant score visibility (B06-042; evidence states)', () => {
  test('the participant score endpoint is withdrawn: no score reaches a participant outside a released report', async () => {
    const a = await submitted();
    await internal('post', `/internal/attempts/${a.id}/quality`, {});
    await internal('post', `/internal/attempts/${a.id}/score`, { scoringVersion: 'scoring-v1' });
    expect((await api().get(`/api/v1/attempts/${a.id}/scores`).set({ Authorization: `Bearer ${a.p.token}` })).status).toBe(404);
    const model = await api().get(`/api/v1/attempts/${a.id}`).set({ Authorization: `Bearer ${a.p.token}` });
    expect(JSON.stringify(model.body)).not.toMatch(/rawScore|raw_score|scoreStatus|score_status|evidence/i);
  });

  test('S2 is assigned only with the audited pilotS2 switch; the switch off (the default) leaves every usable domain at S1', async () => {
    const off = await submitted({ value: (i) => (i.domainCode === 'C1' ? 5 : 2) });
    await internal('post', `/internal/attempts/${off.id}/quality`, {});
    await internal('post', `/internal/attempts/${off.id}/score`, { scoringVersion: 'scoring-v1' });
    expect((await rows(off.id)).every((r) => r.score_status === 'S1')).toBe(true);

    await P.setSwitch('pilotS2', true, admin.adminUserId);
    const on = await submitted({ value: (i) => (i.domainCode === 'C1' ? 5 : 2) });
    await internal('post', `/internal/attempts/${on.id}/quality`, {});
    await internal('post', `/internal/attempts/${on.id}/score`, { scoringVersion: 'scoring-v1' });
    expect((await rows(on.id)).map((r) => [r.domain_code, r.raw_score, r.score_status])).toEqual([['C1', 5, 'S2'], ['C2', 2, 'S2'], ['C3', 2, 'S2'], ['C4', 2, 'S2'], ['C5', 2, 'S2'], ['C6', 2, 'S2'], ['C7', 2, 'S2']]);
  });

  test('the governed evidence file can hold a domain (SH) but never promote; S2, S0, an unknown domain or invalid JSON fail closed with nothing scored', async () => {
    await P.setSwitch('pilotS2', true, admin.adminUserId);
    config.evidenceConfigPath = writeTmp('evidence-hold.json', { [S.setId]: { C3: 'SH' } });
    const held = await submitted();
    await internal('post', `/internal/attempts/${held.id}/quality`, {});
    await internal('post', `/internal/attempts/${held.id}/score`, { scoringVersion: 'scoring-v1' });
    expect((await rows(held.id)).map((r) => [r.domain_code, r.score_status]).filter(([d]) => ['C2', 'C3'].includes(d))).toEqual([['C2', 'S2'], ['C3', 'SH']]);

    for (const bad of [{ [S.setId]: { C1: 'S2' } }, { [S.setId]: { C9: 'SH' } }, { [S.setId]: { C1: 'S0' } }]) {
      config.evidenceConfigPath = writeTmp('evidence-bad.json', bad);
      const a = await submitted();
      await internal('post', `/internal/attempts/${a.id}/quality`, {});
      const res = await internal('post', `/internal/attempts/${a.id}/score`, { scoringVersion: 'scoring-v1' });
      expect(res.status).toBe(503);
      expect(await rows(a.id)).toEqual([]);
      expect(await status(a.id)).toBe('SUBMITTED');
    }
    config.evidenceConfigPath = writeTmp('evidence-broken.json', '{not json');
    const a = await submitted();
    await internal('post', `/internal/attempts/${a.id}/quality`, {});
    expect((await internal('post', `/internal/attempts/${a.id}/score`, { scoringVersion: 'scoring-v1' })).status).toBe(503);
  });
});

describe('quality engine behaviour (B06-048, 051)', () => {
  test('Q05 is inert: a second historical attempt is not labelled a duplicate and no other detector fires', async () => {
    const first = await submitted();
    await (await H.admin()).collection('assessment_attempts').updateOne({ _id: first.id }, { $set: { status: 'EXPIRED' } }); // a genuinely terminal earlier attempt
    const second = await submitted();
    await (await H.admin()).collection('assessment_attempts').updateOne({ _id: second.id }, { $set: { participant_id: first.p.participantId } });
    const q = await internal('post', `/internal/attempts/${second.id}/quality`, {});
    expect(q.body.outcome).toBe('CLEAR');
    expect((await internal('get', `/internal/attempts/${second.id}/quality-flags`)).body).toEqual({ attemptId: second.id, flags: [] });
    expect(await count('quality_flags', { attempt_id: { $in: [first.id, second.id] } })).toBe(0);
  });

  test('an approved policy that enables a detector with no approved implementation fails closed instead of clearing', async () => {
    config.qualityPolicyPath = writeTmp('policy-stub.json', { version: 'test-enabled-stub', detectors: { Q01: { enabled: true } } });
    const a = await submitted();
    const res = await internal('post', `/internal/attempts/${a.id}/quality`, {});
    expect(res.status).toBe(503);
    expect(res.body.error.message).toMatch(/Q01/);
    expect(await count('response_events', { attempt_id: a.id, event_type: 'QUALITY_CHECK_COMPLETED' })).toBe(0);
    expect(await status(a.id)).toBe('SUBMITTED');
    config.qualityPolicyPath = writeTmp('policy-bad.json', { detectors: {} }); // no version => invalid policy
    expect((await internal('post', `/internal/attempts/${a.id}/quality`, {})).status).toBe(503);
  });

  test('Q06: a response to another set\'s question invalidates the attempt and blocks scoring', async () => {
    const a = await submitted();
    const db = await H.admin();
    const otherSet = await f.insert('assessment_versions', F.versionDoc({ configuration: 'EMERGING_ADULT', participant_min_age: 18, participant_max_age: 25 }));
    const other = await f.insert('items', F.item(otherSet._id));
    await db.collection('responses').insertOne(F.response(a.id, other._id, { idempotency_key: `fx-q06-${a.id}` }));
    const q = await internal('post', `/internal/attempts/${a.id}/quality`, {});
    expect(q.body.outcome).toBe('INVALID');
    expect(await status(a.id)).toBe('INVALID');
    expect((await internal('get', `/internal/attempts/${a.id}/quality-flags`)).body.flags.map((x) => [x.code, x.severity])).toEqual([['Q06', 'HIGH']]);
    expect((await internal('post', `/internal/attempts/${a.id}/score`, { scoringVersion: 'v1' })).status).toBe(422);
    expect(await rows(a.id)).toEqual([]);
    expect((await internal('post', `/internal/attempts/${a.id}/quality`, {})).status).toBe(422); // an INVALID attempt is not re-checked
  });
});

describe('Q09 safeguarding trigger (B06-051)', () => {
  test('with no approved trigger configuration nothing fires; with one, only an approved source fires, holds the attempt and never scores', async () => {
    const a = await submitted();
    const none = await internal('post', `/internal/attempts/${a.id}/safeguarding`, { triggerSource: 'TEST_SOURCE' });
    expect(none.body).toEqual({ fired: false, reason: 'NO_APPROVED_TRIGGER' });
    expect(await status(a.id)).toBe('SUBMITTED');

    config.qualityPolicyPath = writeTmp('policy-q09.json', { version: 'test-q09', detectors: { Q09: { approvedTriggerSources: ['TEST_SOURCE'] } } });
    expect((await internal('post', `/internal/attempts/${a.id}/safeguarding`, { triggerSource: 'OTHER_SOURCE' })).body.fired).toBe(false);
    expect((await internal('post', `/internal/attempts/${a.id}/safeguarding`, { triggerSource: 'TEST_SOURCE', note: 'free text' })).status).toBe(400);
    const fired = await internal('post', `/internal/attempts/${a.id}/safeguarding`, { triggerSource: 'TEST_SOURCE' });
    expect(fired.body).toEqual({ fired: true, attemptStatus: 'QUALITY_HOLD' });
    await internal('post', `/internal/attempts/${a.id}/safeguarding`, { triggerSource: 'TEST_SOURCE' }); // idempotent
    expect((await internal('get', `/internal/attempts/${a.id}/quality-flags`)).body.flags.map((x) => [x.code, x.severity])).toEqual([['Q09', 'CRITICAL']]);

    expect((await internal('post', `/internal/attempts/${a.id}/score`, { scoringVersion: 'v1' })).status).toBe(422); // never converted to a score
    expect((await internal('post', `/internal/attempts/${a.id}/quality`, {})).body.outcome).toBe('HOLD');
    expect(await rows(a.id)).toEqual([]);
    expect(await status(a.id)).toBe('QUALITY_HOLD');

    const audit = await (await H.admin()).collection('audit_logs').find({ action_type: 'Q09_FIRED', target_id: a.id }).toArray();
    expect(audit).toHaveLength(1);
    expect(audit[0].new_state).toEqual({ flag: 'Q09' }); // no trigger source, no detail
    const model = await api().get(`/api/v1/attempts/${a.id}`).set({ Authorization: `Bearer ${a.p.token}` });
    expect(JSON.stringify(model.body)).not.toMatch(/Q09|safeguard|flag/i); // nothing leaks to the participant
    expect((await api().get(`/api/v1/internal/attempts/${a.id}/quality-flags`).set({ Authorization: `Bearer ${a.p.token}` })).status).toBe(403);
  });
});
