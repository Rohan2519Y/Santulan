/*
 * Variable options end to end (US3 acceptance 1-5; SC-007, SC-016): upload -> freeze -> open -> participant answers questions with
 * 2, 3, 5, 9 and 20 options through the real API. The set is picked by the server, options are shown per question, an
 * out-of-range answer is refused, changing an answer keeps history, and the counted values follow the position rule.
 */
const request = require('supertest');
const app = require('../../../src/app');
const { closeClient } = require('../../../src/modules/santulan/store/client');
const f = require('../helpers/committed');
const H = require('../helpers/mongoHarness');
const { optionValue } = require('../../../src/modules/santulan/domain/optionScale');
const service = require('../../../src/modules/santulan/questionsets/questionSetService');
const W = require('../helpers/questionWorkbook');

const bearer = (p) => ({ Authorization: `Bearer ${p.token}` });
const key = () => `vo-${f.u()}-${f.u()}-${f.u()}`;
const col = async (n) => (await f.db()).collection(n);

let S;
beforeAll(async () => { S = await f.openSet({ ageGroup: 'ADOLESCENT', perDomain: 1, optionCounts: [2, 3, 5, 9, 20, 5, 5] }); });
afterAll(async () => { await f.closeOpenSets(); await f.cleanupFixtures(); await closeClient(); await H.closeAll(); });

test('US3-1 the participant sees, per question, exactly its own options in the uploaded order', async () => {
  const p = await f.participant(15);
  const created = await request(app).post('/api/v1/attempts').set(bearer(p)).send({});
  expect(created.status).toBe(201);
  const items = await request(app).get(`/api/v1/attempts/${created.body.attemptId}/items`).set(bearer(p));
  expect(items.body.items.map((i) => i.options.length)).toEqual([2, 3, 5, 9, 20, 5, 5]);
  const twenty = items.body.items[4];
  expect(twenty.options.map((o) => o.position)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  expect(twenty.options.map((o) => o.text)).toEqual(Array.from({ length: 20 }, (_, i) => `Choice ${i + 1}`));
});

test('US3-2..4 answer every question by position; out-of-range is refused; changing an answer keeps history; counted values follow the rule', async () => {
  const p = await f.participant(15);
  const created = await request(app).post('/api/v1/attempts').set(bearer(p)).send({});
  const id = created.body.attemptId;
  await request(app).post(`/api/v1/attempts/${id}/sessions/resume`).set(bearer(p)).send({});
  const save = (item, value) => request(app).post(`/api/v1/attempts/${id}/responses`).set(bearer(p)).send({ itemId: item.itemId, value, idempotencyKey: key() });

  // answer the LAST option of every question: value must be 5 for every question, whatever its option count
  for (const item of S.items) expect((await save(item, String(item.optionCount))).status).toBe(200);
  for (const item of S.items) expect((await save(item, String(item.optionCount + 1))).body.error.code).toBe('OPTION_OUT_OF_RANGE');
  const current = await (await col('responses')).find({ attempt_id: id, is_current: true }).toArray();
  expect(current).toHaveLength(7);
  const byItem = new Map(S.items.map((i) => [i.itemId, i.optionCount]));
  expect(current.map((r) => optionValue(Number(r.response_value), byItem.get(r.item_id)))).toEqual(Array(7).fill(5));

  // the FIRST option always counts as 1, the middle of 3 as 3, and a 5-option question is identical to today
  expect(optionValue(1, 20)).toBe(1);
  expect(optionValue(2, 3)).toBe(3);
  expect([1, 2, 3, 4, 5].map((v) => optionValue(v, 5))).toEqual([1, 2, 3, 4, 5]);

  // change an answer: the earlier one stays as history, exactly one current
  expect((await save(S.items[3], '4')).status).toBe(200);
  const rows = await (await col('responses')).find({ attempt_id: id, item_id: S.items[3].itemId }).sort({ response_version: 1 }).toArray();
  expect(rows.map((r) => [r.response_version, r.response_value, r.is_current])).toEqual([[1, '9', false], [2, '4', true]]);
});

test('US3-5 the attempt is tied to the set open when it began; a newer set for the same age group does not change it', async () => {
  const p = await f.participant(16);
  const created = await request(app).post('/api/v1/attempts').set(bearer(p)).send({});
  const id = created.body.attemptId;
  await request(app).post(`/api/v1/attempts/${id}/sessions/resume`).set(bearer(p)).send({});
  const before = (await (await col('assessment_attempts')).findOne({ _id: id })).assessment_version_id;
  expect(before).toBe(S.setId);

  // an admin closes the first set and opens a second one with different options
  const second = await f.openSet({ ageGroup: 'ADOLESCENT', perDomain: 1, optionCounts: [4, 4, 4, 4, 4, 4, 4] });
  expect(second.setId).not.toBe(S.setId);
  const after = (await (await col('assessment_attempts')).findOne({ _id: id })).assessment_version_id;
  expect(after).toBe(S.setId);
  // the participant keeps getting the first set's questions and options ...
  const items = await request(app).get(`/api/v1/attempts/${id}/items`).set(bearer(p));
  expect(items.body.items.map((i) => i.options.length)).toEqual([2, 3, 5, 9, 20, 5, 5]);
  // ... and answers are validated against those, not the new set
  const save = (item, value) => request(app).post(`/api/v1/attempts/${id}/responses`).set(bearer(p)).send({ itemId: item.itemId, value, idempotencyKey: key() });
  expect((await save(S.items[4], '20')).status).toBe(200);
  expect((await save(second.items[0], '1')).body.error.code).toBe('VERSION_MISMATCH');
  // a NEW participant is given the second set
  const q = await f.participant(15);
  const fresh = await request(app).post('/api/v1/attempts').set(bearer(q)).send({});
  expect((await (await col('assessment_attempts')).findOne({ _id: fresh.body.attemptId })).assessment_version_id).toBe(second.setId);
});

test('a draft set is never given to a participant', async () => {
  await f.closeOpenSets();
  const lbl = `fx-draft-${f.u().toLowerCase()}`;
  const admin = await f.admin();
  await service.upload({ buffer: W.workbook(W.validRows({ label: lbl })), fileName: 'q.xlsx', ageGroup: 'ADOLESCENT', actor: { adminUserId: admin.adminUserId } });
  const p = await f.participant(15);
  const res = await request(app).post('/api/v1/attempts').set(bearer(p)).send({});
  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe('ASSESSMENT_NOT_OPEN');
});
