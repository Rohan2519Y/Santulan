/*
 * T080 — delivery API contract (BUILD 05: B05-006, 029, 030, 036, AT-10…15, RC-01…03/07/08).
 * Runs through the real app against the SCRATCH database with the real runtime role and RLS. It opens the adolescent
 * version for its duration and restores DRAFT/CLOSED in afterAll (the catalog suites depend on that state).
 */
const request = require('supertest');
const app = require('../../../src/app');
const db = require('../../../src/shared/db');
const f = require('../helpers/committed');
const messages = require('../../../config/messages.json');

const ADOL = 'santulan-adolescent-pilot-v3.1';
const api = () => request(app);
const bearer = (p) => ({ Authorization: `Bearer ${p.token}` });
const key = (tag = 'k') => `${tag}-${f.u()}-${f.u()}`;
const post = (path, p, body = {}) => api().post(`/api/v1${path}`).set(bearer(p)).send(body);
const get = (path, p) => api().get(`/api/v1${path}`).set(bearer(p));

let items;
beforeAll(async () => {
  await f.openVersion(ADOL);
  items = (await f.query(`SELECT i.item_id FROM santulan.items i JOIN santulan.assessment_versions v USING (assessment_version_id) WHERE v.version_label = $1 ORDER BY i.display_order LIMIT 5`, [ADOL])).map((r) => r.item_id);
});
afterAll(async () => {
  await f.controlEvent('OPEN');
  await f.restoreVersions();
  await f.cleanupFixtures();
  await db.pool.end();
});

async function newAttempt(age = 15) {
  const p = await f.participant(age);
  const res = await post('/attempts', p);
  expect(res.status).toBe(201);
  return { p, id: res.body.attemptId, model: res.body };
}
const save = (a, itemId, value, k = key('save'), extra = {}) => post(`/attempts/${a.id}/responses`, a.p, { itemId, value, idempotencyKey: k, ...extra });

describe('creating an attempt (POST /attempts)', () => {
  test('the server picks the version from the stored age; the client cannot supply version, participant, age or scores', async () => {
    const p = await f.participant(15);
    expect((await api().post('/api/v1/attempts').send({})).status).toBe(401);
    for (const extra of [{ assessmentVersionId: 'x' }, { versionId: '00000000-0000-4000-8000-000000000000' }, { participantId: '00000000-0000-4000-8000-000000000000' }, { age: 20 }, { score: 5 }]) {
      const res = await post('/attempts', p, extra);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    const ok = await post('/attempts', p);
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ status: 'CREATED', progress: { completed: 0, total: 175, percent: 0 }, session: { n: 0, of: 4 }, canContinue: true });
    const row = (await f.query('SELECT v.version_label, a.age_years_at_attempt FROM santulan.assessment_attempts a JOIN santulan.assessment_versions v USING (assessment_version_id) WHERE a.attempt_id = $1', [ok.body.attemptId]))[0];
    expect(row).toEqual({ version_label: ADOL, age_years_at_attempt: 15 });
    const dup = await post('/attempts', p);                                                        // B05-001: one nonterminal attempt
    expect(dup.status).toBe(409);
  });

  test('without verified consent, on a closed version, or while the control plane is STOPPED, no attempt is created', async () => {
    const noConsent = await f.participant(16, { consents: false });
    const blocked = await post('/attempts', noConsent);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('CONSENT_GATE_CLOSED');

    const adult = await f.participant(21);                                                          // emerging-adult version is still CLOSED
    const closed = await post('/attempts', adult);
    expect(closed.status).toBe(409);
    expect(closed.body.error.code).toBe('ASSESSMENT_NOT_OPEN');

    const p = await f.participant(14);
    await f.controlEvent('STOPPED');
    const stopped = await post('/attempts', p);
    expect(stopped.status).toBe(409);
    expect(stopped.body.error.code).toBe('ASSESSMENT_NOT_OPEN');
    await f.controlEvent('OPEN');
    expect((await post('/attempts', p)).status).toBe(201);
    expect((await f.query('SELECT count(*)::int AS n FROM santulan.assessment_attempts WHERE participant_id = $1', [p.participantId]))[0].n).toBe(1);
  });
});

describe('saving answers (POST /attempts/:id/responses)', () => {
  test('append-only versions, safe retries, payload-bound keys, and the frozen-scale / version guards', async () => {
    const a = await newAttempt();
    expect((await save(a, items[0], '3')).status).toBe(422);                                        // B05-005: not started (attempt is CREATED)

    const started = await post(`/attempts/${a.id}/sessions/resume`, a.p);
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({ status: 'IN_PROGRESS', session: { n: 1, of: 4 } });

    const k1 = key('first');
    const first = await save(a, items[0], '3', k1, { responseTimeMs: 1500, presentedOrder: 1 });
    expect(first.status).toBe(200);
    const replay = await save(a, items[0], '3', k1, { responseTimeMs: 1500, presentedOrder: 1 });   // lost-ack retry
    expect(replay.body.responseId).toBe(first.body.responseId);
    const conflict = await save(a, items[0], '4', k1, { responseTimeMs: 1500, presentedOrder: 1 });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('RESPONSE_KEY_CONFLICT');
    const revised = await save(a, items[0], '5');
    expect(revised.body.responseId).not.toBe(first.body.responseId);
    await save(a, items[1], '2');

    const versions = await f.query('SELECT response_version, is_current FROM santulan.responses WHERE attempt_id = $1 AND item_id = $2 ORDER BY response_version', [a.id, items[0]]);
    expect(versions).toEqual([{ response_version: 1, is_current: false }, { response_version: 2, is_current: true }]);

    // guards: scale, unknown item, other version, malformed bodies
    expect((await save(a, items[2], '6')).body.error.code).toBe('SCALE_OUT_OF_RANGE');
    expect((await save(a, items[2], '0')).status).toBe(422);
    expect((await save(a, items[2], 'three')).status).toBe(400);
    expect((await save(a, '00000000-0000-4000-8000-000000000000', '3')).status).toBe(422);
    const eaItem = (await f.query(`SELECT i.item_id FROM santulan.items i JOIN santulan.assessment_versions v USING (assessment_version_id) WHERE v.version_label = 'santulan-emergingadult-pilot-v3.1' LIMIT 1`))[0].item_id;
    const cross = await save(a, eaItem, '3');
    expect(cross.status).toBe(409);
    expect(cross.body.error.code).toBe('VERSION_MISMATCH');
    expect((await save(a, items[2], '3', 'short')).status).toBe(400);                               // key must be 16-128 chars
    for (const extra of [{ score: 4 }, { rawScore: 4 }, { participantId: a.p.participantId }, { attemptStatus: 'SUBMITTED' }]) {
      const res = await save(a, items[2], '3', key('x'), extra);                                    // AT-12: client scores are not part of the schema
      expect(res.status).toBe(400);
    }
    expect((await api().post('/api/v1/attempts/not-a-uuid/responses').set(bearer(a.p)).send({ itemId: items[0], value: '3', idempotencyKey: key() })).status).toBe(404);
  });

  test('GET current answers returns only the latest version per item; the resume model has delivery state and no scores', async () => {
    const a = await newAttempt();
    await post(`/attempts/${a.id}/sessions/resume`, a.p);
    await save(a, items[0], '1'); await save(a, items[0], '4'); await save(a, items[1], '2'); await save(a, items[2], '5');

    const answers = await get(`/attempts/${a.id}/responses`, a.p);
    expect(answers.status).toBe(200);
    expect(answers.body.responses.map((r) => [r.itemId, r.value, r.version])).toEqual([[items[0], '4', 2], [items[1], '2', 1], [items[2], '5', 1]]);
    expect(JSON.stringify(answers.body)).not.toMatch(/score|responseId|idempotency/i);

    const model = await get(`/attempts/${a.id}`, a.p);
    expect(Object.keys(model.body).sort()).toEqual(['attemptId', 'canContinue', 'lastSavedAt', 'progress', 'session', 'status']);
    expect(model.body).toMatchObject({ status: 'IN_PROGRESS', progress: { completed: 3, total: 175, percent: 2 }, session: { n: 1, of: 4 }, canContinue: true });
    expect(model.body.lastSavedAt).toBeTruthy();
    expect(JSON.stringify(model.body)).not.toMatch(/score/i);
  });
});

describe('items for the player (GET /attempts/:id/items)', () => {
  test('returns the attempt version items in order with the frozen anchors, nothing research-only, and only to the owner', async () => {
    const a = await newAttempt();
    const res = await get(`/attempts/${a.id}/items`, a.p);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(175);
    expect(res.body.items.map((i) => i.order)).toEqual(Array.from({ length: 175 }, (_, i) => i + 1));
    expect(Object.keys(res.body.items[0]).sort()).toEqual(['domainCode', 'itemId', 'order', 'text']);
    expect(res.body.scale).toEqual({ points: 5, anchors: { 1: 'Almost never', 2: 'Rarely', 3: 'Sometimes', 4: 'Often', 5: 'Almost always' } });
    expect(JSON.stringify(res.body)).not.toMatch(/keying|subdomain|hash|pilot|score/i);
    expect((await get(`/attempts/${a.id}/items`, await f.participant(16))).status).toBe(404);
    expect((await api().get(`/api/v1/attempts/${a.id}/items`)).status).toBe(401);
  });
});

describe('sessions (POST /attempts/:id/sessions/resume, /pause)', () => {
  test('reconnect keeps the session, each true resume adds one, the fifth is refused with controlled copy, and answers survive', async () => {
    const a = await newAttempt();
    const r1 = await post(`/attempts/${a.id}/sessions/resume`, a.p);
    const reconnect = await post(`/attempts/${a.id}/sessions/resume`, a.p);
    expect([r1.body.session.n, reconnect.body.session.n]).toEqual([1, 1]);
    expect((await f.query(`SELECT count(*)::int AS n FROM santulan.response_events WHERE attempt_id = $1 AND event_type = 'SESSION_START'`, [a.id]))[0].n).toBe(1);
    await save(a, items[0], '3');

    const paused = await post(`/attempts/${a.id}/pause`, a.p, { reason: 'LOGOUT' });
    expect(paused.body).toMatchObject({ status: 'PAUSED', session: { n: 1, of: 4 }, canContinue: true });
    expect((await post(`/attempts/${a.id}/pause`, a.p)).status).toBe(422);                         // only IN_PROGRESS can pause
    expect((await post(`/attempts/${a.id}/pause`, a.p, { reason: 'because' })).status).toBe(400);

    const answers = await get(`/attempts/${a.id}/responses`, a.p);                                  // AT-15 / RC-07: reload recovers the answers
    expect(answers.body.responses).toHaveLength(1);

    for (const n of [2, 3, 4]) {
      expect((await post(`/attempts/${a.id}/sessions/resume`, a.p)).body.session.n).toBe(n);
      await post(`/attempts/${a.id}/pause`, a.p);
    }
    const fifth = await post(`/attempts/${a.id}/sessions/resume`, a.p);                             // RC-08
    expect(fifth.status).toBe(409);
    expect(fifth.body.error).toMatchObject({ code: 'SESSION_LIMIT', message: messages.sessionLimit, details: { sessionsUsed: 4, canSubmit: true } });
    expect(JSON.stringify(fifth.body)).not.toMatch(/score|risk|diagnos/i);
    const model = await get(`/attempts/${a.id}`, a.p);
    expect(model.body).toMatchObject({ status: 'PAUSED', session: { n: 4, of: 4 }, canContinue: false });
    expect((await f.query('SELECT session_count FROM santulan.assessment_attempts WHERE attempt_id = $1', [a.id]))[0].session_count).toBe(4);
  });

  test('a STOPPED control plane blocks starting or resuming a session but never blocks pausing or submitting', async () => {
    const a = await newAttempt();
    await post(`/attempts/${a.id}/sessions/resume`, a.p);
    await f.controlEvent('STOPPED');
    try {
      expect((await post(`/attempts/${a.id}/pause`, a.p)).status).toBe(200);
      const blocked = await post(`/attempts/${a.id}/sessions/resume`, a.p);
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe('ASSESSMENT_NOT_OPEN');
      expect((await post(`/attempts/${a.id}/submit`, a.p, { submissionKey: key('sub') })).status).toBe(200);
    } finally { await f.controlEvent('OPEN'); }
  });
});

describe('submitting (POST /attempts/:id/submit)', () => {
  test('atomic and idempotent: same key replays, another key conflicts, writes are locked, and nothing is scored', async () => {
    const a = await newAttempt();
    await post(`/attempts/${a.id}/sessions/resume`, a.p);
    await save(a, items[0], '3');
    expect((await post(`/attempts/${a.id}/submit`, a.p, { submissionKey: 'short' })).status).toBe(400);
    expect((await post(`/attempts/${a.id}/submit`, a.p, {})).status).toBe(400);

    const k = key('submit');
    const first = await post(`/attempts/${a.id}/submit`, a.p, { submissionKey: k });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ status: 'SUBMITTED', canContinue: false });
    expect(first.body.submittedAt).toBeTruthy();
    const replay = await post(`/attempts/${a.id}/submit`, a.p, { submissionKey: k });
    expect(replay.status).toBe(200);
    expect(replay.body.submittedAt).toBe(first.body.submittedAt);
    const other = await post(`/attempts/${a.id}/submit`, a.p, { submissionKey: key('other') });
    expect(other.status).toBe(409);
    expect(other.body.error.code).toBe('SUBMIT_KEY_CONFLICT');

    const late = await save(a, items[1], '3');
    expect(late.status).toBe(422);
    expect(late.body.error.code).toBe('ATTEMPT_LOCKED');
    expect((await post(`/attempts/${a.id}/sessions/resume`, a.p)).status).toBe(422);

    const events = await f.query(`SELECT event_type, count(*)::int AS n FROM santulan.response_events WHERE attempt_id = $1 AND event_type IN ('SUBMIT','SESSION_END') GROUP BY event_type ORDER BY event_type`, [a.id]);
    expect(events).toEqual([{ event_type: 'SESSION_END', n: 1 }, { event_type: 'SUBMIT', n: 1 }]);
    expect((await f.query('SELECT count(*)::int AS n FROM santulan.score_results WHERE attempt_id = $1', [a.id]))[0].n).toBe(0);
    expect((await f.query(`SELECT count(*)::int AS n FROM santulan.audit_logs WHERE action_type = 'ATTEMPT_SUBMITTED' AND target_id = $1`, [a.id]))[0].n).toBe(1);   // the replay wrote no second audit
  });
});

describe('isolation (RLS + token authority)', () => {
  test("another participant cannot read, save to, pause or submit someone else's attempt", async () => {
    const a = await newAttempt();
    await post(`/attempts/${a.id}/sessions/resume`, a.p);
    const intruder = await f.participant(16);
    expect((await get(`/attempts/${a.id}`, intruder)).status).toBe(404);
    expect((await get(`/attempts/${a.id}/responses`, intruder)).status).toBe(404);
    expect((await post(`/attempts/${a.id}/sessions/resume`, intruder)).status).toBe(404);
    expect((await save({ ...a, p: intruder }, items[0], '3')).status).toBe(403);
    expect((await post(`/attempts/${a.id}/pause`, intruder)).status).toBe(403);
    expect((await post(`/attempts/${a.id}/submit`, intruder, { submissionKey: key('bad') })).status).toBe(403);
    expect((await f.query('SELECT status FROM santulan.assessment_attempts WHERE attempt_id = $1', [a.id]))[0].status).toBe('IN_PROGRESS');
    expect((await f.query('SELECT count(*)::int AS n FROM santulan.responses WHERE attempt_id = $1', [a.id]))[0].n).toBe(0);

    const admin = await f.admin();
    expect((await api().get(`/api/v1/attempts/${a.id}`).set({ Authorization: `Bearer ${admin.token}` })).status).toBe(403);   // an admin token is not a participant token
  });
});
