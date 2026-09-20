/*
 * T093 — quality and scoring API contract (BUILD 06: B06-002, 042, 048, 051 and the §14-§15 rules). Through the real app,
 * runtime role and RLS on the SCRATCH database. It opens the adolescent version for its duration and restores DRAFT/CLOSED
 * in afterAll; governed configuration files are pointed at temporary fixtures and reset after each test.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const app = require('../../../src/app');
const db = require('../../../src/shared/db');
const config = require('../../../src/config');
const f = require('../helpers/committed');

const ADOL = 'santulan-adolescent-pilot-v3.1';
const INTERNAL = { 'X-Internal-Api-Key': 'test-internal-key' };
const api = () => request(app);
const key = (tag) => `${tag}-${f.u()}-${f.u()}`;
const post = (p, who, body = {}) => api().post(`/api/v1${p}`).set({ Authorization: `Bearer ${who.token}` }).send(body);
const internal = (method, p, body) => api()[method](`/api/v1${p}`).set(INTERNAL).send(body);
const tmp = [];
const writeTmp = (name, data) => { const file = path.join(os.tmpdir(), `santulan-${f.u()}-${name}`); fs.writeFileSync(file, JSON.stringify(data)); tmp.push(file); return file; };

let versionId;
beforeAll(async () => {
  await f.openVersion(ADOL);
  versionId = (await f.query('SELECT assessment_version_id FROM santulan.assessment_versions WHERE version_label = $1', [ADOL]))[0].assessment_version_id;
});
afterEach(() => { config.qualityPolicyPath = ''; config.evidenceConfigPath = ''; });
afterAll(async () => {
  await f.restoreVersions();
  await f.cleanupFixtures();
  tmp.forEach((file) => fs.rmSync(file, { force: true }));
  await db.pool.end();
});

/** A participant with a SUBMITTED attempt, made through the real delivery API (answers are bulk-inserted as the owner). */
async function submitted({ value = () => '3', age = 15 } = {}) {
  const p = await f.participant(age);
  const created = await post('/attempts', p);
  expect(created.status).toBe(201);
  const id = created.body.attemptId;
  expect((await post(`/attempts/${id}/sessions/resume`, p)).status).toBe(200);
  await f.answerAll(id, value);
  expect((await post(`/attempts/${id}/submit`, p, { submissionKey: key('sub') })).status).toBe(200);
  return { p, id };
}
const status = async (id) => (await f.query('SELECT status FROM santulan.assessment_attempts WHERE attempt_id = $1', [id]))[0].status;
const rows = (id) => f.query('SELECT domain_code, raw_score, score_status FROM santulan.score_results WHERE attempt_id = $1 ORDER BY domain_code', [id]);

describe('access and request schemas', () => {
  test('the engines need the internal key; participant, admin and missing credentials are refused; the score body is {scoringVersion} only', async () => {
    const a = await submitted();
    const admin = await f.admin();
    for (const path of ['quality', 'score']) {
      const url = `/api/v1/internal/attempts/${a.id}/${path}`;
      expect((await api().post(url).send(path === 'score' ? { scoringVersion: 'v1' } : {})).status).toBe(403);
      expect((await api().post(url).set({ Authorization: `Bearer ${a.p.token}` }).send(path === 'score' ? { scoringVersion: 'v1' } : {})).status).toBe(403);
      expect((await api().post(url).set({ Authorization: `Bearer ${admin.token}` }).send(path === 'score' ? { scoringVersion: 'v1' } : {})).status).toBe(403);
      expect((await api().post(url).set({ 'X-Internal-Api-Key': 'wrong' }).send(path === 'score' ? { scoringVersion: 'v1' } : {})).status).toBe(403);
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
    await internal('post', `/internal/attempts/${a.id}/quality`, {});                                // retry
    expect((await f.query(`SELECT count(*)::int AS n FROM santulan.response_events WHERE attempt_id = $1 AND event_type = 'QUALITY_CHECK_COMPLETED'`, [a.id]))[0].n).toBe(1);

    const s1 = await internal('post', `/internal/attempts/${a.id}/score`, { scoringVersion: 'scoring-v1' });
    expect(s1.body).toMatchObject({ outcome: 'SCORED', scoringVersion: 'scoring-v1' });
    expect((await rows(a.id)).map((r) => [r.domain_code, r.raw_score, r.score_status])).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'].map((d) => [d, '3.00', 'S1']));
    expect(await status(a.id)).toBe('SCORED');
    expect((await internal('post', `/internal/attempts/${a.id}/score`, { scoringVersion: 'scoring-v1' })).body.outcome).toBe('ALREADY_SCORED');
    expect((await internal('post', `/internal/attempts/${a.id}/score`, { scoringVersion: 'scoring-v2' })).status).toBe(422);          // bound to v1
    expect((await rows(a.id))).toHaveLength(7);
    expect((await f.query('SELECT count(*)::int AS n FROM santulan.reports WHERE attempt_id = $1', [a.id]))[0].n).toBe(0);              // BUILD 06 ends at SCORED
    expect((await f.query(`SELECT count(*)::int AS n FROM santulan.audit_logs WHERE action_type = 'ATTEMPT_SCORED' AND target_id = $1`, [a.id]))[0].n).toBe(1);
    expect((await internal('post', `/internal/attempts/${a.id}/quality`, {})).status).toBe(422);                                       // quality runs on SUBMITTED attempts
  });

  test('two simultaneous scorers produce exactly one set of seven rows', async () => {
    const a = await submitted();
    await internal('post', `/internal/attempts/${a.id}/quality`, {});
    const results = await Promise.all([1, 2, 3].map(() => internal('post', `/internal/attempts/${a.id}/score`, { scoringVersion: 'scoring-v1' })));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(results.filter((r) => r.body.outcome === 'SCORED')).toHaveLength(1);
    expect((await rows(a.id))).toHaveLength(7);
  });
});

describe('participant score visibility (B06-042, AT evidence states)', () => {
  test('default S1 shows nothing to the participant; a governed S2 domain shows only that domain; others cannot read it', async () => {
    const a = await submitted();
    await internal('post', `/internal/attempts/${a.id}/quality`, {});
    await internal('post', `/internal/attempts/${a.id}/score`, { scoringVersion: 'scoring-v1' });
    const hidden = await api().get(`/api/v1/attempts/${a.id}/scores`).set({ Authorization: `Bearer ${a.p.token}` });
    expect(hidden.status).toBe(200);
    expect(hidden.body).toEqual({ attemptId: a.id, scores: [] });                                                                        // S1 is research only

    config.evidenceConfigPath = writeTmp('evidence.json', { [versionId]: { C1: 'S2', C3: 'S2' } });
    const b = await submitted({ value: (r) => (r.domain_code === 'C1' ? '5' : '2') });
    await internal('post', `/internal/attempts/${b.id}/quality`, {});
    await internal('post', `/internal/attempts/${b.id}/score`, { scoringVersion: 'scoring-v1' });
    const shown = await api().get(`/api/v1/attempts/${b.id}/scores`).set({ Authorization: `Bearer ${b.p.token}` });
    expect(shown.body.scores).toEqual([
      { domainCode: 'C1', score: 5, completeness: 1, evidenceState: 'S2' },
      { domainCode: 'C3', score: 2, completeness: 1, evidenceState: 'S2' },
    ]);
    expect(JSON.stringify(shown.body)).not.toMatch(/rawScore|percentile|norm|risk|diagnos/i);

    expect((await api().get(`/api/v1/attempts/${b.id}/scores`).set({ Authorization: `Bearer ${a.p.token}` })).status).toBe(404);          // another participant
    expect((await api().get(`/api/v1/attempts/${b.id}/scores`)).status).toBe(401);
    expect((await api().get('/api/v1/attempts/not-a-uuid/scores').set({ Authorization: `Bearer ${b.p.token}` })).status).toBe(404);
  });

  test('an evidence configuration that asks for S3-S5, an unknown domain, or invalid JSON fails closed with nothing scored', async () => {
    for (const bad of [{ [versionId]: { C1: 'S4' } }, { [versionId]: { C1: 'S3' } }, { [versionId]: { C9: 'S2' } }, { [versionId]: { C1: 'S0' } }]) {
      config.evidenceConfigPath = writeTmp('evidence-bad.json', bad);
      const a = await submitted();
      await internal('post', `/internal/attempts/${a.id}/quality`, {});
      const res = await internal('post', `/internal/attempts/${a.id}/score`, { scoringVersion: 'scoring-v1' });
      expect(res.status).toBe(503);
      expect(await rows(a.id)).toEqual([]);
      expect(await status(a.id)).toBe('SUBMITTED');
    }
    const broken = path.join(os.tmpdir(), `santulan-${f.u()}-broken.json`); fs.writeFileSync(broken, '{not json'); tmp.push(broken);
    config.evidenceConfigPath = broken;
    const a = await submitted();
    await internal('post', `/internal/attempts/${a.id}/quality`, {});
    expect((await internal('post', `/internal/attempts/${a.id}/score`, { scoringVersion: 'scoring-v1' })).status).toBe(503);
  });
});

describe('quality engine behaviour (B06-048, 051)', () => {
  test('Q05 is inert: a second historical attempt is not labelled a duplicate and no other detector fires', async () => {
    const p = await f.participant(15);
    const first = (await post('/attempts', p)).body.attemptId;
    await f.query(`UPDATE santulan.assessment_attempts SET status = 'EXPIRED' WHERE attempt_id = $1`, [first]);            // a genuinely terminal earlier attempt
    const second = await post('/attempts', p);
    expect(second.status).toBe(201);
    const id = second.body.attemptId;
    await post(`/attempts/${id}/sessions/resume`, p);
    await f.answerAll(id);
    await post(`/attempts/${id}/submit`, p, { submissionKey: key('sub') });
    const q = await internal('post', `/internal/attempts/${id}/quality`, {});
    expect(q.body.outcome).toBe('CLEAR');
    expect((await internal('get', `/internal/attempts/${id}/quality-flags`)).body).toEqual({ attemptId: id, flags: [] });
    expect((await f.query('SELECT count(*)::int AS n FROM santulan.quality_flags WHERE attempt_id = ANY($1)', [[first, id]]))[0].n).toBe(0);
  });

  test('an approved policy that enables a detector with no approved implementation fails closed instead of clearing', async () => {
    config.qualityPolicyPath = writeTmp('policy-stub.json', { version: 'test-enabled-stub', detectors: { Q01: { enabled: true } } });
    const a = await submitted();
    const res = await internal('post', `/internal/attempts/${a.id}/quality`, {});
    expect(res.status).toBe(503);
    expect(res.body.error.message).toMatch(/Q01/);
    expect((await f.query(`SELECT count(*)::int AS n FROM santulan.response_events WHERE attempt_id = $1 AND event_type = 'QUALITY_CHECK_COMPLETED'`, [a.id]))[0].n).toBe(0);
    expect(await status(a.id)).toBe('SUBMITTED');
    config.qualityPolicyPath = writeTmp('policy-bad.json', { detectors: {} });                                                              // no version => invalid policy
    expect((await internal('post', `/internal/attempts/${a.id}/quality`, {})).status).toBe(503);
  });

  test('Q06: a response to another version\'s item invalidates the attempt and blocks scoring', async () => {
    const a = await submitted();
    const other = (await f.query(`SELECT i.item_id FROM santulan.items i JOIN santulan.assessment_versions v USING (assessment_version_id) WHERE v.version_label = 'santulan-emergingadult-pilot-v3.1' LIMIT 1`))[0].item_id;
    await f.owner(async (c) => {
      await c.query("SET session_replication_role = 'replica'");
      await c.query(`INSERT INTO santulan.responses (attempt_id, item_id, response_value, response_version, is_current, idempotency_key) VALUES ($1, $2, '3', 1, true, $3)`, [a.id, other, `fx-q06-${a.id}`]);
    });
    const q = await internal('post', `/internal/attempts/${a.id}/quality`, {});
    expect(q.body.outcome).toBe('INVALID');
    expect(await status(a.id)).toBe('INVALID');
    expect((await internal('get', `/internal/attempts/${a.id}/quality-flags`)).body.flags.map((x) => [x.code, x.severity])).toEqual([['Q06', 'HIGH']]);
    expect((await internal('post', `/internal/attempts/${a.id}/score`, { scoringVersion: 'v1' })).status).toBe(422);
    expect(await rows(a.id)).toEqual([]);
    const replay = await internal('post', `/internal/attempts/${a.id}/quality`, {});
    expect(replay.status).toBe(422);                                                                                                        // an INVALID attempt is not re-checked
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
    await internal('post', `/internal/attempts/${a.id}/safeguarding`, { triggerSource: 'TEST_SOURCE' });                                    // idempotent
    expect((await internal('get', `/internal/attempts/${a.id}/quality-flags`)).body.flags.map((x) => [x.code, x.severity])).toEqual([['Q09', 'CRITICAL']]);

    expect((await internal('post', `/internal/attempts/${a.id}/score`, { scoringVersion: 'v1' })).status).toBe(422);                       // never converted to a score
    expect((await internal('post', `/internal/attempts/${a.id}/quality`, {})).body.outcome).toBe('HOLD');
    expect(await rows(a.id)).toEqual([]);
    expect(await status(a.id)).toBe('QUALITY_HOLD');

    const audit = await f.query(`SELECT new_state FROM santulan.audit_logs WHERE action_type = 'Q09_FIRED' AND target_id = $1`, [a.id]);
    expect(audit).toHaveLength(1);
    expect(audit[0].new_state).toEqual({ flag: 'Q09' });                                                                                   // no trigger source, no detail
    const model = await api().get(`/api/v1/attempts/${a.id}`).set({ Authorization: `Bearer ${a.p.token}` });
    expect(JSON.stringify(model.body)).not.toMatch(/Q09|safeguard|flag/i);                                                                 // nothing leaks to the participant
    expect((await api().get(`/api/v1/attempts/${a.id}/scores`).set({ Authorization: `Bearer ${a.p.token}` })).body.scores).toEqual([]);
    expect((await api().get(`/api/v1/internal/attempts/${a.id}/quality-flags`).set({ Authorization: `Bearer ${a.p.token}` })).status).toBe(403);
  });
});
