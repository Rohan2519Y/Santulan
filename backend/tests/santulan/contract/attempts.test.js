/*
 * Delivery API contract (BUILD 05: B05-006, 029, 030, 036, AT-10..15, RC-01..03/07/08), ported to MongoDB and extended for
 * variable options (feature 006). Runs through the real app against the SCRATCH database with the runtime credential and the
 * scoped access layer. It publishes its own fx- question set for the adolescent age group and cleans up afterwards.
 */
const request = require('supertest');
const app = require('../../../src/app');
const { closeClient } = require('../../../src/modules/santulan/store/client');
const f = require('../helpers/committed');
const H = require('../helpers/mongoHarness');
const messages = require('../../../config/messages.json');

const api = () => request(app);
const bearer = (p) => ({ Authorization: `Bearer ${p.token}` });
const key = (tag = 'k') => `${tag}-${f.u()}-${f.u()}`;
const post = (path, p, body = {}) => api().post(`/api/v1${path}`).set(bearer(p)).send(body);
const get = (path, p) => api().get(`/api/v1${path}`).set(bearer(p));
const col = async (name) => (await f.db()).collection(name);

let S; // the open adolescent set: 14 questions, the first three have 2, 3 and 9 options
let items;
beforeAll(async () => {
  S = await f.openSet({ ageGroup: 'ADOLESCENT', perDomain: 2, optionCounts: [2, 3, 9] });
  items = S.items;
});
afterAll(async () => {
  await f.controlEvent('OPEN');
  await f.closeOpenSets();
  await f.cleanupFixtures();
  await closeClient();
  await H.closeAll();
});

async function newAttempt(age = 15) {
  const p = await f.participant(age);
  const res = await post('/attempts', p);
  expect(res.status).toBe(201);
  return { p, id: res.body.attemptId, model: res.body };
}
const save = (a, item, value, k = key('save'), extra = {}) => post(`/attempts/${a.id}/responses`, a.p, { itemId: item.itemId || item, value, idempotencyKey: k, ...extra });

describe('creating an attempt (POST /attempts)', () => {
  test('the server picks the set from the stored age; the client cannot supply set, participant, age or scores', async () => {
    const p = await f.participant(15);
    expect((await api().post('/api/v1/attempts').send({})).status).toBe(401);
    for (const extra of [{ assessmentVersionId: 'x' }, { versionId: '00000000-0000-4000-8000-000000000000' }, { participantId: '00000000-0000-4000-8000-000000000000' }, { age: 20 }, { score: 5 }]) {
      const res = await post('/attempts', p, extra);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    const ok = await post('/attempts', p);
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ status: 'CREATED', progress: { completed: 0, total: 14, percent: 0 }, session: { n: 0, of: 4 }, canContinue: true });
    const row = await (await col('assessment_attempts')).findOne({ _id: ok.body.attemptId });
    expect({ set: row.assessment_version_id, age: row.age_years_at_attempt }).toEqual({ set: S.setId, age: 15 });
    const dup = await post('/attempts', p); // B05-001: one nonterminal attempt
    expect(dup.status).toBe(409);
  });

  test('T03-017 without verified consent, with no open set for the age group, or while the control plane is STOPPED, no attempt is created', async () => {
    const noConsent = await f.participant(16, { consents: false });
    const blocked = await post('/attempts', noConsent);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('CONSENT_GATE_CLOSED');

    const adult = await f.participant(21); // no emerging-adult set is open
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
    expect(await (await col('assessment_attempts')).countDocuments({ participant_id: p.participantId })).toBe(1);
  });

  test('T03-018 age 18 goes to the emerging-adult set, never the adolescent set', async () => {
    const eighteen = await f.participant(18);
    const res = await post('/attempts', eighteen);
    expect(res.status).toBe(409); // only the adolescent set is open, and 18 is not adolescent
    expect(res.body.error.code).toBe('ASSESSMENT_NOT_OPEN');
  });

  test('a suspended participant cannot start an attempt', async () => {
    const p = await f.participant(15);
    await (await col('participants')).updateOne({ _id: p.participantId }, { $set: { status: 'SUSPENDED' } });
    expect((await post('/attempts', p)).status).toBe(403);
  });
});

describe('saving answers (POST /attempts/:id/responses)', () => {
  test('append-only versions, safe retries, payload-bound keys, and the option / set guards', async () => {
    const a = await newAttempt();
    expect((await save(a, items[3], '3')).status).toBe(422); // B05-005: not started (attempt is CREATED)

    const started = await post(`/attempts/${a.id}/sessions/resume`, a.p);
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({ status: 'IN_PROGRESS', session: { n: 1, of: 4 } });

    const k1 = key('first');
    const first = await save(a, items[3], '3', k1, { responseTimeMs: 1500, presentedOrder: 1 });
    expect(first.status).toBe(200);
    const replay = await save(a, items[3], '3', k1, { responseTimeMs: 1500, presentedOrder: 1 }); // lost-ack retry
    expect(replay.body.responseId).toBe(first.body.responseId);
    const conflict = await save(a, items[3], '4', k1, { responseTimeMs: 1500, presentedOrder: 1 });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('RESPONSE_KEY_CONFLICT');
    const revised = await save(a, items[3], '5');
    expect(revised.body.responseId).not.toBe(first.body.responseId);
    await save(a, items[4], '2');

    const versions = (await (await col('responses')).find({ attempt_id: a.id, item_id: items[3].itemId }).sort({ response_version: 1 }).toArray()).map((r) => [r.response_version, r.is_current, r.response_value]);
    expect(versions).toEqual([[1, false, '3'], [2, true, '5']]);

    // guards: option range, malformed values, unknown question, other set, bad keys, client scores
    expect((await save(a, items[5], '6')).body.error.code).toBe('OPTION_OUT_OF_RANGE'); // a 5-option question
    expect((await save(a, items[5], '0')).body.error.code).toBe('OPTION_OUT_OF_RANGE');
    expect((await save(a, items[5], 'three')).status).toBe(400);
    expect((await save(a, '00000000-0000-4000-8000-000000000000', '3')).status).toBe(422);
    const otherSet = await (await col('items')).findOne({ assessment_version_id: { $ne: S.setId } });
    if (otherSet) {
      const cross = await save(a, otherSet._id, '3');
      expect(cross.status).toBe(409);
      expect(cross.body.error.code).toBe('VERSION_MISMATCH');
    }
    expect((await save(a, items[5], '3', 'short')).status).toBe(400); // key must be 16-128 chars
    for (const extra of [{ score: 4 }, { rawScore: 4 }, { participantId: a.p.participantId }, { attemptStatus: 'SUBMITTED' }]) {
      expect((await save(a, items[5], '3', key('x'), extra)).status).toBe(400); // AT-12: client scores are not part of the schema
    }
    expect((await api().post('/api/v1/attempts/not-a-uuid/responses').set(bearer(a.p)).send({ itemId: items[0].itemId, value: '3', idempotencyKey: key() })).status).toBe(404);
  });

  test('variable options: 2, 3, 9 and 5 option questions each accept exactly their own positions', async () => {
    const a = await newAttempt();
    await post(`/attempts/${a.id}/sessions/resume`, a.p);
    const two = items[0]; const three = items[1]; const nine = items[2]; const five = items[3];
    expect([two.optionCount, three.optionCount, nine.optionCount, five.optionCount]).toEqual([2, 3, 9, 5]);
    for (const [item, ok, bad] of [[two, '2', '3'], [three, '3', '4'], [nine, '9', '10'], [five, '5', '6']]) {
      expect((await save(a, item, ok)).status).toBe(200);
      const refused = await save(a, item, bad);
      expect(refused.status).toBe(422);
      expect(refused.body.error.code).toBe('OPTION_OUT_OF_RANGE');
    }
    expect(await (await col('responses')).countDocuments({ attempt_id: a.id, is_current: true })).toBe(4); // nothing stored for the refused ones
  });

  test('GET current answers returns only the latest version per item; the resume model has delivery state and no scores', async () => {
    const a = await newAttempt();
    await post(`/attempts/${a.id}/sessions/resume`, a.p);
    await save(a, items[3], '1'); await save(a, items[3], '4'); await save(a, items[4], '2'); await save(a, items[5], '5');

    const answers = await get(`/attempts/${a.id}/responses`, a.p);
    expect(answers.status).toBe(200);
    expect(answers.body.responses.map((r) => [r.itemId, r.value, r.version])).toEqual([[items[3].itemId, '4', 2], [items[4].itemId, '2', 1], [items[5].itemId, '5', 1]]);
    expect(JSON.stringify(answers.body)).not.toMatch(/score|responseId|idempotency/i);

    const model = await get(`/attempts/${a.id}`, a.p);
    expect(Object.keys(model.body).sort()).toEqual(['attemptId', 'canContinue', 'lastSavedAt', 'progress', 'reportId', 'session', 'status']);
    expect(model.body).toMatchObject({ status: 'IN_PROGRESS', progress: { completed: 3, total: 14, percent: 21 }, session: { n: 1, of: 4 }, canContinue: true });
    expect(model.body.lastSavedAt).toBeTruthy();
    expect(model.body.reportId).toBeNull(); // no report yet (D-M18)
    expect(JSON.stringify(model.body)).not.toMatch(/score/i);
  });
});

describe('questions for the player (GET /attempts/:id/items)', () => {
  test('each question carries ITS OWN options in the uploaded order; nothing research-only; only to the owner', async () => {
    const a = await newAttempt();
    const res = await get(`/attempts/${a.id}/items`, a.p);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(14);
    expect(res.body.items.map((i) => i.order)).toEqual(items.map((i) => i.order));
    expect(Object.keys(res.body.items[0]).sort()).toEqual(['domainCode', 'itemId', 'options', 'order', 'text']);
    expect(res.body.items.slice(0, 4).map((i) => i.options.length)).toEqual([2, 3, 9, 5]);
    expect(res.body.items[2].options.map((o) => o.text)).toEqual(Array.from({ length: 9 }, (_, k) => `Choice ${k + 1}`));
    expect(res.body.items[3].options).toEqual([1, 2, 3, 4, 5].map((position, k) => ({ position, text: ['Almost never', 'Rarely', 'Sometimes', 'Often', 'Almost always'][k] })));
    expect(res.body.scale).toBeUndefined(); // the fixed 5-point scale is no longer implied
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
    expect(await (await col('response_events')).countDocuments({ attempt_id: a.id, event_type: 'SESSION_START' })).toBe(1);
    await save(a, items[3], '3');

    const paused = await post(`/attempts/${a.id}/pause`, a.p, { reason: 'LOGOUT' });
    expect(paused.body).toMatchObject({ status: 'PAUSED', session: { n: 1, of: 4 }, canContinue: true });
    expect((await post(`/attempts/${a.id}/pause`, a.p)).status).toBe(422); // only IN_PROGRESS can pause
    expect((await post(`/attempts/${a.id}/pause`, a.p, { reason: 'because' })).status).toBe(400);

    const answers = await get(`/attempts/${a.id}/responses`, a.p); // AT-15 / RC-07: reload recovers the answers
    expect(answers.body.responses).toHaveLength(1);

    for (const n of [2, 3, 4]) {
      expect((await post(`/attempts/${a.id}/sessions/resume`, a.p)).body.session.n).toBe(n);
      await post(`/attempts/${a.id}/pause`, a.p);
    }
    const fifth = await post(`/attempts/${a.id}/sessions/resume`, a.p); // RC-08
    expect(fifth.status).toBe(409);
    expect(fifth.body.error).toMatchObject({ code: 'SESSION_LIMIT', message: messages.sessionLimit, details: { sessionsUsed: 4, canSubmit: true } });
    expect(JSON.stringify(fifth.body)).not.toMatch(/score|risk|diagnos/i);
    const model = await get(`/attempts/${a.id}`, a.p);
    expect(model.body).toMatchObject({ status: 'PAUSED', session: { n: 4, of: 4 }, canContinue: false });
    expect((await (await col('assessment_attempts')).findOne({ _id: a.id })).session_count).toBe(4);
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
    await save(a, items[3], '3');
    expect((await post(`/attempts/${a.id}/submit`, a.p, { submissionKey: 'short' })).status).toBe(400);
    expect((await post(`/attempts/${a.id}/submit`, a.p, {})).status).toBe(400);

    const k = key('submit');
    const first = await post(`/attempts/${a.id}/submit`, a.p, { submissionKey: k });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ status: 'SUBMITTED', canContinue: false });
    expect(first.body.submittedAt).toBeTruthy();
    const replay = await post(`/attempts/${a.id}/submit`, a.p, { submissionKey: k });
    expect(replay.status).toBe(200);
    expect(new Date(replay.body.submittedAt).getTime()).toBe(new Date(first.body.submittedAt).getTime());
    const other = await post(`/attempts/${a.id}/submit`, a.p, { submissionKey: key('other') });
    expect(other.status).toBe(409);
    expect(other.body.error.code).toBe('SUBMIT_KEY_CONFLICT');

    const late = await save(a, items[4], '3');
    expect(late.status).toBe(422);
    expect(late.body.error.code).toBe('ATTEMPT_LOCKED');
    expect((await post(`/attempts/${a.id}/sessions/resume`, a.p)).status).toBe(422);

    const ev = await col('response_events');
    expect(await ev.countDocuments({ attempt_id: a.id, event_type: 'SUBMIT' })).toBe(1);
    expect(await ev.countDocuments({ attempt_id: a.id, event_type: 'SESSION_END' })).toBe(1);
    expect(await (await col('score_results')).countDocuments({ attempt_id: a.id })).toBe(0);
    expect(await (await col('audit_logs')).countDocuments({ action_type: 'ATTEMPT_SUBMITTED', target_id: a.id })).toBe(1); // the replay wrote no second audit
  });
});

describe('isolation (scope + token authority)', () => {
  test("another participant cannot read, save to, pause or submit someone else's attempt", async () => {
    const a = await newAttempt();
    await post(`/attempts/${a.id}/sessions/resume`, a.p);
    const intruder = await f.participant(16);
    expect((await get(`/attempts/${a.id}`, intruder)).status).toBe(404);
    expect((await get(`/attempts/${a.id}/responses`, intruder)).status).toBe(404);
    expect((await post(`/attempts/${a.id}/sessions/resume`, intruder)).status).toBe(404);
    expect([403, 404]).toContain((await save({ ...a, p: intruder }, items[3], '3')).status);
    expect([403, 404]).toContain((await post(`/attempts/${a.id}/pause`, intruder)).status);
    expect([403, 404]).toContain((await post(`/attempts/${a.id}/submit`, intruder, { submissionKey: key('bad') })).status);
    expect((await (await col('assessment_attempts')).findOne({ _id: a.id })).status).toBe('IN_PROGRESS');
    expect(await (await col('responses')).countDocuments({ attempt_id: a.id })).toBe(0);

    const admin = await f.admin();
    expect((await api().get(`/api/v1/attempts/${a.id}`).set({ Authorization: `Bearer ${admin.token}` })).status).toBe(403); // an admin token is not a participant token
  });
});
