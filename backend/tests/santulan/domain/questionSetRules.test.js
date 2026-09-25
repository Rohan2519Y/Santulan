/* Question-set upload rules (FR-016/017): what an upload does for a label, and the write is one transaction. */
const rules = require('../../../src/services/domain/questionSetRules');
const service = require('../../../src/services/questionsets/questionSetService');
const { closeClient } = require('../../../src/models/db/client');
const f = require('../helpers/committed');
const H = require('../helpers/mongoHarness');
const W = require('../helpers/questionWorkbook');

let admin;
beforeAll(async () => { admin = await f.admin(); });
afterAll(async () => { await f.cleanupFixtures(); await closeClient(); await H.closeAll(); });

const label = () => `fx-rules-${f.u().toLowerCase()}`;
const upload = (lbl, rows = W.validRows({ label: lbl }), ageGroup = 'ADOLESCENT') => service.upload({
  buffer: W.workbook(rows), fileName: 'q.xlsx', ageGroup, actor: { adminUserId: admin.adminUserId }, correlationId: 'test-corr-1',
});

describe('decideUpload (pure)', () => {
  const rev = (revision, status, hash) => ({ revision, status, content_hash: hash });
  test('T-B02-020 a new label creates revision 1', () => {
    expect(rules.decideUpload([], 'h1')).toMatchObject({ action: 'CREATE', nextRevision: 1 });
  });
  test('T-B02-021 identical content under a draft label is a no-op', () => {
    expect(rules.decideUpload([rev(1, 'DRAFT', 'h1')], 'h1')).toMatchObject({ action: 'NOOP' });
  });
  test('T-B02-022 different content under a draft label is the next revision', () => {
    expect(rules.decideUpload([rev(1, 'RETIRED', 'h0'), rev(2, 'DRAFT', 'h1')], 'h2')).toMatchObject({ action: 'REVISE', nextRevision: 3 });
  });
  test('T-B02-023 a frozen or retired latest revision refuses the upload (SET_NOT_DRAFT)', () => {
    for (const status of ['FROZEN', 'RETIRED']) {
      const d = rules.decideUpload([rev(1, status, 'h1')], 'h1');
      expect(d.action).toBe('REFUSE');
      expect(() => rules.assertUploadable(d)).toThrow(expect.objectContaining({ status: 409, code: 'SET_NOT_DRAFT' }));
    }
  });
  test('T-B02-024 the age group decides the stored age range', () => {
    expect(rules.ageRange('ADOLESCENT')).toEqual([13, 17]);
    expect(rules.ageRange('EMERGING_ADULT')).toEqual([18, 25]);
  });
});

describe('the upload transaction (FR-016/017)', () => {
  test('T-B02-025 a new label makes revision 1 as DRAFT / CLOSED with all questions and options stored', async () => {
    const lbl = label();
    const r = await upload(lbl);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ versionLabel: lbl, revision: 1, ageGroup: 'ADOLESCENT', status: 'DRAFT', participationState: 'CLOSED', questionCount: 7, optionCount: 35, created: true, supersededRevision: null });
    const db = await f.db();
    expect(await db.collection('items').countDocuments({ assessment_version_id: r.body.setId })).toBe(7);
    const item = await db.collection('items').findOne({ assessment_version_id: r.body.setId, item_code: 'C1-01' });
    expect(item.options).toHaveLength(5);
    expect(item.keying).toBe('POSITIVE');
  });

  test('T-B02-026 an identical re-upload is a no-op that returns the existing set', async () => {
    const lbl = label();
    const first = await upload(lbl);
    const again = await upload(lbl);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ created: false, setId: first.body.setId, revision: 1 });
    expect(await (await f.db()).collection('assessment_versions').countDocuments({ version_label: lbl })).toBe(1);
  });

  test('T-B02-027 different content makes revision 2 and retires revision 1, without deleting anything', async () => {
    const lbl = label();
    const first = await upload(lbl);
    const rows = W.validRows({ label: lbl });
    rows[0].cells.item_text += ' (revised)';
    const second = await upload(lbl, rows);
    expect(second.status).toBe(201);
    expect(second.body).toMatchObject({ revision: 2, supersededRevision: 1 });
    const db = await f.db();
    const revs = await db.collection('assessment_versions').find({ version_label: lbl }).sort({ revision: 1 }).toArray();
    expect(revs.map((r) => [r.revision, r.status])).toEqual([[1, 'RETIRED'], [2, 'DRAFT']]);
    expect(await db.collection('items').countDocuments({ assessment_version_id: first.body.setId })).toBe(7); // the old revision is kept
  });

  test('T-B02-028 a frozen label refuses any upload with SET_NOT_DRAFT', async () => {
    const lbl = label();
    const first = await upload(lbl);
    const db = await f.db();
    await db.collection('assessment_versions').updateOne({ _id: first.body.setId }, { $set: { status: 'FROZEN', frozen_at: new Date() } });
    await expect(upload(lbl)).rejects.toMatchObject({ status: 409, code: 'SET_NOT_DRAFT' });
    const rows = W.validRows({ label: lbl });
    rows[0].cells.item_text += ' changed';
    await expect(upload(lbl, rows)).rejects.toMatchObject({ status: 409, code: 'SET_NOT_DRAFT' });
  });

  test('T-B02-029 the whole write (set + questions + audit) is one transaction: a failure leaves nothing', async () => {
    const lbl = label();
    const rows = W.validRows({ label: lbl });
    // an option list that passes upload validation but is refused by the store validator would leave a partial set; here the
    // store refuses a question whose stored item_code collides inside the transaction (same display_order is caught earlier, so
    // simulate by making the audit fail): the audit actor id must be a UUID, so a bad admin id aborts everything.
    await expect(service.upload({ buffer: W.workbook(rows), fileName: 'q.xlsx', ageGroup: 'ADOLESCENT', actor: { adminUserId: 'not-a-uuid' } })).rejects.toBeTruthy();
    const db = await f.db();
    expect(await db.collection('assessment_versions').countDocuments({ version_label: lbl })).toBe(0);
    expect(await db.collection('items').countDocuments({ assessment_version_id: require('../../../src/services/questionsets/canonical').setId(lbl, 1) })).toBe(0);
  });

  test('T-B02-030 the audit row carries the file hash, counts and revision - and no participant data', async () => {
    const lbl = label();
    const r = await upload(lbl);
    const audit = await (await f.db()).collection('audit_logs').findOne({ action_type: 'QUESTION_SET_UPLOADED', target_id: r.body.setId });
    expect(audit).toMatchObject({ actor_type: 'ADMIN', actor_id: admin.adminUserId });
    expect(audit.new_state).toMatchObject({ versionLabel: lbl, revision: 1, questionCount: 7, optionCount: 35, contentHash: r.body.contentHash, fileSha256: r.body.sourceFileHash });
  });
});
