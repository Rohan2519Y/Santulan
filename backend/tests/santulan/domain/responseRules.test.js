/* Response rules (B05-005..018, 033..035, 041, 044): versions, idempotency, option range, submit. Through the delivery services. */
const request = require('supertest');
const app = require('../../../src/app');
const rules = require('../../../src/modules/santulan/domain/responseRules');
const { closeClient } = require('../../../src/modules/santulan/store/client');
const f = require('../helpers/committed');
const H = require('../helpers/mongoHarness');

let S; let items;
beforeAll(async () => {
  S = await f.openSet({ ageGroup: 'ADOLESCENT', perDomain: 1, optionCounts: [2, 3, 5, 9, 20, 5, 5] });
  items = S.items;
});
afterAll(async () => { await f.closeOpenSets(); await f.cleanupFixtures(); await closeClient(); await H.closeAll(); });

const bearer = (p) => ({ Authorization: `Bearer ${p.token}` });
const key = () => `rr-${f.u()}-${f.u()}-${f.u()}`;
const col = async (n) => (await f.db()).collection(n);
async function started(age = 15) {
  const p = await f.participant(age);
  const a = await request(app).post('/api/v1/attempts').set(bearer(p)).send({});
  await request(app).post(`/api/v1/attempts/${a.body.attemptId}/sessions/resume`).set(bearer(p)).send({});
  return { p, id: a.body.attemptId };
}
const save = (a, item, value, k = key(), extra = {}) => request(app).post(`/api/v1/attempts/${a.id}/responses`).set(bearer(a.p)).send({ itemId: item.itemId, value, idempotencyKey: k, ...extra });

describe('pure rules', () => {
  test('normalisePosition and nextVersion', () => {
    expect(rules.normalisePosition('05')).toBe('5');
    expect(rules.normalisePosition('20')).toBe('20');
    expect(rules.nextVersion(null)).toEqual({ response_version: 1, supersedes_response_id: null });
    expect(rules.nextVersion({ _id: 'r1', response_version: 3 })).toEqual({ response_version: 4, supersedes_response_id: 'r1' });
  });
  test('samePayload compares the whole payload', () => {
    const existing = { attempt_id: 'a', item_id: 'i', response_value: '3', response_time_ms: 100, presented_order: 2 };
    const same = { attemptId: 'a', itemId: 'i', value: '3', responseTimeMs: 100, presentedOrder: 2 };
    expect(rules.samePayload(existing, same)).toBe(true);
    for (const change of [{ attemptId: 'b' }, { itemId: 'j' }, { value: '4' }, { responseTimeMs: 101 }, { presentedOrder: 3 }]) expect(rules.samePayload(existing, { ...same, ...change })).toBe(false);
    expect(rules.samePayload({ ...existing, response_time_ms: null, presented_order: null }, { ...same, responseTimeMs: undefined, presentedOrder: undefined })).toBe(true);
  });
});

describe('versions (B05-005..008)', () => {
  test('B05-005 the first answer is version 1 and supersedes nothing; a revision inserts version 2 superseding it and retires only the prior current', async () => {
    const a = await started();
    const r1 = await save(a, items[2], '3');
    const r2 = await save(a, items[2], '4');
    const rows = await (await col('responses')).find({ attempt_id: a.id, item_id: items[2].itemId }).sort({ response_version: 1 }).toArray();
    expect(rows.map((r) => [r.response_version, r.is_current, r.response_value, r.supersedes_response_id])).toEqual([[1, false, '3', null], [2, true, '4', r1.body.responseId]]);
    expect(r2.body.responseId).toBe(rows[1]._id);
    await save(a, items[3], '2'); // another question is unaffected
    expect(await (await col('responses')).countDocuments({ attempt_id: a.id, is_current: true })).toBe(2);
  });

  test('B05-006 many revisions keep contiguous versions and exactly one current answer', async () => {
    const a = await started();
    for (const v of ['1', '2', '3', '4', '5', '1']) await save(a, items[2], v);
    const rows = await (await col('responses')).find({ attempt_id: a.id, item_id: items[2].itemId }).sort({ response_version: 1 }).toArray();
    expect(rows.map((r) => r.response_version)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rows.filter((r) => r.is_current)).toHaveLength(1);
    expect(rows[5].response_value).toBe('1');
    rows.slice(1).forEach((r, i) => expect(r.supersedes_response_id).toBe(rows[i]._id));
  });
});

describe('idempotency (B05-007, B05-AUD-001)', () => {
  test('B05-007 the same key and payload returns the same response id; the same key with a different payload is RESPONSE_KEY_CONFLICT', async () => {
    const a = await started();
    const k = key();
    const first = await save(a, items[2], '3', k, { responseTimeMs: 900 });
    const again = await save(a, items[2], '3', k, { responseTimeMs: 900 });
    expect(again.body.responseId).toBe(first.body.responseId);
    for (const change of [{ value: '4' }, { responseTimeMs: 901 }]) {
      const r = await request(app).post(`/api/v1/attempts/${a.id}/responses`).set(bearer(a.p)).send({ itemId: items[2].itemId, value: '3', responseTimeMs: 900, idempotencyKey: k, ...change });
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('RESPONSE_KEY_CONFLICT');
    }
    const other = await save(a, items[3], '3', k); // the same key for another question is a different payload
    expect(other.status).toBe(409);
    expect(await (await col('responses')).countDocuments({ attempt_id: a.id })).toBe(1);
  });

  test('B05-008 a key used by another attempt is refused by the store index', async () => {
    const a = await started(); const b = await started();
    const k = key();
    expect((await save(a, items[2], '3', k)).status).toBe(200);
    const r = await save(b, items[2], '3', k);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('RESPONSE_KEY_CONFLICT');
  });
});

describe('the question and the option range (B05-009..018, spec FR-014)', () => {
  test('B06-071 OPTION_OUT_OF_RANGE for 2, 3, 5, 9 and 20 options: the last position is accepted, the next one is refused with nothing stored', async () => {
    const a = await started();
    const cases = [[items[0], 2], [items[1], 3], [items[2], 5], [items[3], 9], [items[4], 20]];
    for (const [item, n] of cases) {
      expect(item.optionCount).toBe(n);
      expect((await save(a, item, String(n))).status).toBe(200);
      const bad = await save(a, item, String(n + 1));
      expect(bad.status).toBe(422);
      expect(bad.body.error.code).toBe('OPTION_OUT_OF_RANGE');
      expect((await save(a, item, '0')).body.error.code).toBe('OPTION_OUT_OF_RANGE');
    }
    const current = await (await col('responses')).find({ attempt_id: a.id, is_current: true }).toArray();
    expect(current).toHaveLength(5);
    expect(await (await col('responses')).countDocuments({ attempt_id: a.id })).toBe(5);
  });

  test('B05-010 a question from another set is refused (VERSION_MISMATCH, the Q06 path); an unknown question is 422', async () => {
    const a = await started();
    const other = await f.openSet({ ageGroup: 'EMERGING_ADULT', perDomain: 1, open: false });
    const cross = await save(a, other.items[0], '3');
    expect(cross.status).toBe(409);
    expect(cross.body.error.code).toBe('VERSION_MISMATCH');
    const unknown = await save(a, { itemId: '00000000-0000-4000-8000-000000000000' }, '3');
    expect(unknown.status).toBe(422);
    expect(await (await col('responses')).countDocuments({ attempt_id: a.id })).toBe(0);
  });

  test('B05-011 a non-CORE or inactive question is not answerable', async () => {
    const a = await started();
    const db = await f.db();
    await db.collection('items').updateOne({ _id: items[5].itemId }, { $set: { status: 'RETIRED' } }); // migrator, as an inactivation would be
    try {
      const r = await save(a, items[5], '3');
      expect(r.status).toBe(422);
    } finally { await db.collection('items').updateOne({ _id: items[5].itemId }, { $set: { status: 'ACTIVE' } }); }
  });

  test('B05-012 answers are only written while the attempt is STARTED or IN_PROGRESS', async () => {
    const p = await f.participant(15);
    const created = await request(app).post('/api/v1/attempts').set(bearer(p)).send({});
    const a = { p, id: created.body.attemptId };
    expect((await save(a, items[2], '3')).body.error.code).toBe('ATTEMPT_LOCKED'); // CREATED
    await request(app).post(`/api/v1/attempts/${a.id}/sessions/resume`).set(bearer(p)).send({});
    expect((await save(a, items[2], '3')).status).toBe(200);
    await request(app).post(`/api/v1/attempts/${a.id}/pause`).set(bearer(p)).send({});
    expect((await save(a, items[2], '4')).body.error.code).toBe('ATTEMPT_LOCKED'); // PAUSED
  });

  test('B05-013 a saved answer never changes: the store refuses any update except retiring is_current', async () => {
    const a = await started();
    await save(a, items[2], '3');
    const row = await (await col('responses')).findOne({ attempt_id: a.id });
    const runtime = await H.runtime();
    await runtimeRefusesDelete(runtime, row._id);
    const store = require('../../../src/modules/santulan/store');
    await store.withScope(store.participantScope(a.p.participantId), async (tx) => {
      await expect(tx.c.responses.updateOne({ _id: row._id, attempt_id: a.id }, { $set: { response_value: '5' } })).rejects.toMatchObject({ status: 403 });
      await expect(tx.c.responses.updateOne({ _id: row._id, attempt_id: a.id }, { $set: { attempt_id: 'x' } })).rejects.toMatchObject({ status: 403 });
    });
  });
});

async function runtimeRefusesDelete(db, id) {
  await H.expectRefused(db.collection('responses').deleteOne({ _id: id }), 13);
}

describe('submit (B05-033..035, 041, 044)', () => {
  test('B05-033 submit is atomic from IN_PROGRESS: active session closed, SUBMIT recorded, server-clock submitted_at', async () => {
    const a = await started();
    await save(a, items[2], '3');
    const k = key();
    const before = Date.now();
    const s = await request(app).post(`/api/v1/attempts/${a.id}/submit`).set(bearer(a.p)).send({ submissionKey: k });
    expect(s.status).toBe(200);
    const row = await (await col('assessment_attempts')).findOne({ _id: a.id });
    expect(row.status).toBe('SUBMITTED');
    expect(row.submitted_at.getTime()).toBeGreaterThanOrEqual(before - 1000);
    const events = (await (await col('response_events')).find({ attempt_id: a.id }).sort({ occurred_at: 1, _id: 1 }).toArray()).map((e) => e.event_type);
    expect(events).toEqual(expect.arrayContaining(['SESSION_START', 'RESPONSE_SAVED', 'SESSION_END', 'SUBMIT']));
    expect(events.indexOf('SESSION_END')).toBeLessThan(events.indexOf('SUBMIT'));
  });

  test('B05-034 submit from PAUSED writes SUBMIT only (no second SESSION_END); same key is idempotent, another key is SUBMIT_KEY_CONFLICT', async () => {
    const a = await started();
    await request(app).post(`/api/v1/attempts/${a.id}/pause`).set(bearer(a.p)).send({});
    const k = key();
    expect((await request(app).post(`/api/v1/attempts/${a.id}/submit`).set(bearer(a.p)).send({ submissionKey: k })).status).toBe(200);
    expect((await request(app).post(`/api/v1/attempts/${a.id}/submit`).set(bearer(a.p)).send({ submissionKey: k })).status).toBe(200);
    const other = await request(app).post(`/api/v1/attempts/${a.id}/submit`).set(bearer(a.p)).send({ submissionKey: key() });
    expect(other.body.error.code).toBe('SUBMIT_KEY_CONFLICT');
    const ev = await col('response_events');
    expect(await ev.countDocuments({ attempt_id: a.id, event_type: 'SUBMIT' })).toBe(1);
    expect(await ev.countDocuments({ attempt_id: a.id, event_type: 'SESSION_END' })).toBe(1); // from the pause, none added by the submit
  });

  test('B05-035 a client score or rawScore field is a 400; nothing is scored by delivery', async () => {
    const a = await started();
    for (const extra of [{ score: 1 }, { rawScore: 3 }]) {
      const r = await save(a, items[2], '3', key(), extra);
      expect(r.status).toBe(400);
    }
    const s = await request(app).post(`/api/v1/attempts/${a.id}/submit`).set(bearer(a.p)).send({ submissionKey: key(), score: 5 });
    expect(s.status).toBe(400);
    expect(await (await col('score_results')).countDocuments({ attempt_id: a.id })).toBe(0);
  });
});
