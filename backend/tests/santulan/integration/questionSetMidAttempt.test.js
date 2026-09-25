/*
 * A participant mid-attempt keeps the exact question set the attempt began with (FR-020, constitution II).
 * Store-level part: the attempt's set id is immutable and unaffected by a newer set being frozen and opened. The end-to-end part
 * (POST /attempts then the delivery API) is exercised in integration/variableOptions.test.js.
 */
const service = require('../../../src/services/questionsets/questionSetService');
const store = require('../../../src/models/db');
const { closeClient } = require('../../../src/models/db/client');
const f = require('../helpers/committed');
const F = require('../helpers/fixtures');
const H = require('../helpers/mongoHarness');
const W = require('../helpers/questionWorkbook');

let admin; let actor;
beforeAll(async () => { admin = await f.admin(); actor = { adminUserId: admin.adminUserId }; });
afterAll(async () => { await f.cleanupFixtures(); await closeClient(); await H.closeAll(); });

const label = () => `fx-mid-${f.u().toLowerCase()}`;
const publish = async (lbl) => {
  const up = await service.upload({ buffer: W.workbook(W.validRows({ label: lbl })), fileName: 'q.xlsx', ageGroup: 'ADOLESCENT', actor });
  await service.freeze(actor, up.body.setId);
  return up.body.setId;
};

test('FR-020 an attempt keeps its set after a newer set is frozen and opened for the same age group', async () => {
  const db = await f.db();
  await db.collection('assessment_versions').updateMany({ participation_state: 'OPEN', version_label: /^fx-/ }, { $set: { participation_state: 'CLOSED' } });
  const first = await publish(label());
  await service.open(actor, first, 'first set');
  const p = await f.participant(16);
  const attempt = await f.insert('assessment_attempts', F.attempt(p.participantId, first, { status: 'IN_PROGRESS', session_count: 1 }));

  // a newer set is uploaded, frozen and (after the first is closed) opened
  await service.close(actor, first, 'replace the set');
  const second = await publish(label());
  await service.open(actor, second, 'second set');

  const stored = await db.collection('assessment_attempts').findOne({ _id: attempt._id });
  expect(stored.assessment_version_id).toBe(first);
  // the first set's questions are untouched and still readable
  expect(await db.collection('items').countDocuments({ assessment_version_id: first })).toBe(7);
});

test('FR-020 the attempt row has no update path for its question set, and the store refuses it for the runtime credential too', async () => {
  const first = await publish(label());
  const p = await f.participant(16);
  const attempt = await f.insert('assessment_attempts', F.attempt(p.participantId, first, { status: 'IN_PROGRESS', session_count: 1 }));
  await store.withScope(store.systemScope(), async (tx) => {
    await expect(tx.c.assessment_attempts.updateOne({ _id: attempt._id }, { $set: { assessment_version_id: F.versionDoc()._id } })).rejects.toMatchObject({ status: 403 });
    await expect(tx.c.assessment_attempts.updateOne({ _id: attempt._id }, { $set: { age_years_at_attempt: 20 } })).rejects.toMatchObject({ status: 403 });
    await expect(tx.c.assessment_attempts.updateOne({ _id: attempt._id }, { $set: { participant_id: F.participant()._id } })).rejects.toMatchObject({ status: 403 });
  });
});
