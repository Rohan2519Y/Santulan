/* Question-set lifecycle over HTTP (US4 acceptance 1-5). */
const request = require('supertest');
const app = require('../../../src/app');
const { closeClient } = require('../../../src/models/db/client');
const f = require('../helpers/committed');
const H = require('../helpers/mongoHarness');
const W = require('../helpers/questionWorkbook');

let admin;
beforeAll(async () => { admin = await f.admin(); });
afterAll(async () => { await f.cleanupFixtures(); await closeClient(); await H.closeAll(); });
beforeEach(async () => { (await f.db()).collection('assessment_versions').updateMany({ participation_state: 'OPEN', version_label: /^fx-/ }, { $set: { participation_state: 'CLOSED' } }); });

const auth = (t = admin.token) => ({ Authorization: `Bearer ${t}` });
const label = () => `fx-lc-${f.u().toLowerCase()}`;
const upload = async (ageGroup = 'ADOLESCENT', perDomain = 1) => {
  const lbl = label();
  const res = await request(app).post('/api/v1/admin/question-sets').set(auth()).field('ageGroup', ageGroup).attach('file', W.workbook(W.validRows({ label: lbl, ageGroup, perDomain })), 'q.xlsx');
  expect(res.status).toBe(201);
  return res.body;
};
const step = (id, verb, body = {}, headers = auth()) => request(app).post(`/api/v1/admin/question-sets/${id}/${verb}`).set(headers).send(body);
const itemStep = (setId, itemId, body, headers = auth()) => request(app).post(`/api/v1/admin/question-sets/${setId}/items/${itemId}/status`).set(headers).send(body);
const audits = async (id) => (await f.db()).collection('audit_logs').find({ target_id: id, action_type: { $regex: '^QUESTION_SET_' } }).sort({ occurred_at: 1 }).toArray();
const itemAudits = async (itemId) => (await f.db()).collection('audit_logs').find({ target_id: itemId, action_type: { $regex: '^QUESTION_ITEM_' } }).sort({ occurred_at: 1 }).toArray();
const itemsOf = async (setId) => (await f.db()).collection('items').find({ assessment_version_id: setId }).sort({ display_order: 1 }).toArray();

describe('US4 acceptance: draft -> frozen -> open -> closed', () => {
  test('T-B02-011 the whole lifecycle, one audit row per step, and nothing else changes', async () => {
    const set = await upload();
    const frozen = await step(set.setId, 'freeze');
    expect(frozen.status).toBe(200);
    expect(frozen.body).toMatchObject({ status: 'FROZEN', participationState: 'CLOSED' });
    const opened = await step(set.setId, 'open', { reason: 'Pilot cohort 1' });
    expect(opened.body).toMatchObject({ status: 'FROZEN', participationState: 'OPEN' });
    const closed = await step(set.setId, 'close', { reason: 'Pilot cohort 1 complete' });
    expect(closed.body).toMatchObject({ participationState: 'CLOSED' });
    expect((await audits(set.setId)).map((a) => a.action_type)).toEqual(['QUESTION_SET_UPLOADED', 'QUESTION_SET_FROZEN', 'QUESTION_SET_OPENED', 'QUESTION_SET_CLOSED']);
  });

  test('B08-004 open and close need a reason of 3 to 300 characters; freeze takes an empty body; unknown keys are 400', async () => {
    const set = await upload();
    await step(set.setId, 'freeze');
    for (const body of [{}, { reason: '' }, { reason: 'ab' }, { reason: 'x'.repeat(301) }, { reason: 'ok reason', extra: 1 }]) {
      expect((await step(set.setId, 'open', body)).status).toBe(400);
      expect((await step(set.setId, 'close', body)).status).toBe(400);
    }
    expect((await step(set.setId, 'freeze', { reason: 'not accepted' })).status).toBe(400);
    expect((await (await f.db()).collection('assessment_versions').findOne({ _id: set.setId })).participation_state).toBe('CLOSED');
  });

  test('a second frozen set for the same age group cannot be opened (409 OPEN_SET_EXISTS); closing frees the group', async () => {
    const a = await upload(); const b = await upload();
    await step(a.setId, 'freeze'); await step(b.setId, 'freeze');
    expect((await step(a.setId, 'open', { reason: 'first' })).status).toBe(200);
    const clash = await step(b.setId, 'open', { reason: 'second' });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('OPEN_SET_EXISTS');
    expect((await step(a.setId, 'close', { reason: 'switch over' })).status).toBe(200);
    expect((await step(b.setId, 'open', { reason: 'second' })).status).toBe(200);
  });

  test('freeze of an incomplete set is 409 SET_INCOMPLETE naming the domains; open of a draft is 409 SET_NOT_FROZEN', async () => {
    const lbl = label();
    const rows = W.validRows({ label: lbl }).filter((x) => x.cells.domain_code !== 'C6');
    const up = await request(app).post('/api/v1/admin/question-sets').set(auth()).field('ageGroup', 'ADOLESCENT').attach('file', W.workbook(rows), 'q.xlsx');
    expect(up.status).toBe(201);
    const fr = await step(up.body.setId, 'freeze');
    expect(fr.status).toBe(409);
    expect(fr.body.error.code).toBe('SET_INCOMPLETE');
    expect(fr.body.error.message).toContain('C6');
    const op = await step(up.body.setId, 'open', { reason: 'too early' });
    expect(op.status).toBe(409);
    expect(op.body.error.code).toBe('SET_NOT_FROZEN');
  });

  test('a frozen set cannot be uploaded over (409 SET_NOT_DRAFT)', async () => {
    const lbl = label();
    const buf = W.workbook(W.validRows({ label: lbl }));
    const up = await request(app).post('/api/v1/admin/question-sets').set(auth()).field('ageGroup', 'ADOLESCENT').attach('file', buf, 'q.xlsx');
    await step(up.body.setId, 'freeze');
    const again = await request(app).post('/api/v1/admin/question-sets').set(auth()).field('ageGroup', 'ADOLESCENT').attach('file', buf, 'q.xlsx');
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('SET_NOT_DRAFT');
  });

  test('non-admins are refused on every step', async () => {
    const set = await upload();
    const p = await f.participant(16);
    const suspended = await f.admin('SUSPENDED');
    for (const verb of ['freeze', 'open', 'close']) {
      const body = verb === 'freeze' ? {} : { reason: 'nope nope' };
      expect((await step(set.setId, verb, body, {})).status).toBe(401);
      expect((await step(set.setId, verb, body, auth(p.token))).status).toBe(403);
      expect((await step(set.setId, verb, body, auth(suspended.token))).status).toBe(403);
    }
    expect((await step('not-a-uuid', 'freeze')).status).toBe(404);
    expect((await step('00000000-0000-4000-8000-000000000000', 'freeze')).status).toBe(404);
  });
});

describe('CR-006-12: deleting a draft question set', () => {
  test('a draft set is deleted (RETIRED), audited, disappears from the freezable list, and cannot be frozen afterwards', async () => {
    const set = await upload();
    const del = await step(set.setId, 'delete');
    expect(del.status).toBe(200);
    expect(del.body).toMatchObject({ status: 'RETIRED', setId: set.setId });
    expect((await audits(set.setId)).map((a) => a.action_type)).toEqual(['QUESTION_SET_UPLOADED', 'QUESTION_SET_DELETED']);
    expect((await step(set.setId, 'freeze')).status).toBe(409);
    const row = await (await f.db()).collection('assessment_versions').findOne({ _id: set.setId });
    expect(row.status).toBe('RETIRED');
  });

  test('a frozen set can never be deleted (409 SET_NOT_DRAFT) - a frozen set is permanent, constitution IV', async () => {
    const set = await upload();
    await step(set.setId, 'freeze');
    const del = await step(set.setId, 'delete');
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('SET_NOT_DRAFT');
    const row = await (await f.db()).collection('assessment_versions').findOne({ _id: set.setId });
    expect(row.status).toBe('FROZEN'); // unchanged
  });

  test('an opened set can never be deleted either, and no HTTP DELETE verb route exists for it (G-22 stays true)', async () => {
    const set = await upload();
    await step(set.setId, 'freeze');
    await step(set.setId, 'open', { reason: 'in use' });
    expect((await step(set.setId, 'delete')).status).toBe(409);
    const verbDelete = await request(app).delete(`/api/v1/admin/question-sets/${set.setId}`).set(auth());
    expect(verbDelete.status).toBe(404); // no DELETE-verb route exists; "delete" here is always a POST action, never the HTTP verb
  });

  test('delete needs an admin token, an empty body, and a real, existing draft', async () => {
    const set = await upload();
    const p = await f.participant(16);
    expect((await step(set.setId, 'delete', {}, {})).status).toBe(401);
    expect((await step(set.setId, 'delete', {}, auth(p.token))).status).toBe(403);
    expect((await step(set.setId, 'delete', { reason: 'not accepted here' })).status).toBe(400);
    expect((await step('00000000-0000-4000-8000-000000000000', 'delete')).status).toBe(404);
  });
});

describe('showing and hiding a question from participants (items.status)', () => {
  test('hiding a question with a sibling in its domain succeeds, is audited, and the item stays in Review (still readable) but ACTIVE elsewhere in the same domain', async () => {
    const set = await upload('ADOLESCENT', 2); // 2 questions per domain, so hiding one still leaves the domain covered
    await step(set.setId, 'freeze');
    const items = await itemsOf(set.setId);
    const [first, second] = items.filter((i) => i.domain_code === items[0].domain_code);

    const hide = await itemStep(set.setId, first._id, { status: 'RETIRED', reason: 'flagged as ambiguous wording' });
    expect(hide.status).toBe(200);
    expect(hide.body).toEqual({ itemId: first._id, status: 'RETIRED' });
    expect((await itemAudits(first._id)).map((a) => a.action_type)).toEqual(['QUESTION_ITEM_HIDDEN']);
    expect((await itemAudits(first._id))[0]).toMatchObject({ previous_state: { status: 'ACTIVE' }, new_state: { status: 'RETIRED' }, reason: 'flagged as ambiguous wording' });

    // hidden from delivery/scoring eligibility - the exact filter attemptService.getItems and scoreAttempt both use
    const deliverable = await (await f.db()).collection('items').find({ assessment_version_id: set.setId, layer: 'CORE', status: 'ACTIVE' }).toArray();
    expect(deliverable.map((i) => i._id)).not.toContain(first._id);
    expect(deliverable.map((i) => i._id)).toContain(second._id); // its sibling is untouched

    // still visible to the admin review endpoint, now marked hidden
    const review = await request(app).get(`/api/v1/admin/question-sets/${set.setId}`).set(auth());
    const reviewed = review.body.questions.find((q) => q.itemId === first._id);
    expect(reviewed).toMatchObject({ status: 'RETIRED' });

    // showing it back has no restriction and is audited separately
    const show = await itemStep(set.setId, first._id, { status: 'ACTIVE', reason: 'wording approved after review' });
    expect(show.status).toBe(200);
    expect((await itemAudits(first._id)).map((a) => a.action_type)).toEqual(['QUESTION_ITEM_HIDDEN', 'QUESTION_ITEM_SHOWN']);
  });

  test('hiding the last active question in a domain is refused (409 SET_INCOMPLETE) - scoring can never be silently broken', async () => {
    const set = await upload('ADOLESCENT', 1); // exactly one question per domain
    await step(set.setId, 'freeze');
    const [only] = await itemsOf(set.setId);
    const hide = await itemStep(set.setId, only._id, { status: 'RETIRED', reason: 'trying to hide the only one' });
    expect(hide.status).toBe(409);
    expect(hide.body.error.code).toBe('SET_INCOMPLETE');
    expect(hide.body.error.message).toContain(only.domain_code);
    const row = await (await f.db()).collection('items').findOne({ _id: only._id });
    expect(row.status).toBe('ACTIVE'); // unchanged
  });

  test('refused on a DRAFT set (409 SET_NOT_FROZEN) - nothing to show or hide before freezing', async () => {
    const set = await upload('ADOLESCENT', 2);
    const [item] = await itemsOf(set.setId);
    const res = await itemStep(set.setId, item._id, { status: 'RETIRED', reason: 'too early' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SET_NOT_FROZEN');
  });

  test('an already-hidden question cannot be hidden again, and an unknown item is 404', async () => {
    const set = await upload('ADOLESCENT', 2);
    await step(set.setId, 'freeze');
    const [item] = await itemsOf(set.setId);
    expect((await itemStep(set.setId, item._id, { status: 'RETIRED', reason: 'first hide' })).status).toBe(200);
    const again = await itemStep(set.setId, item._id, { status: 'RETIRED', reason: 'second hide' });
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('INVALID_STATE');
    const unknown = await itemStep(set.setId, '00000000-0000-4000-8000-000000000000', { status: 'RETIRED', reason: 'no such item' });
    expect(unknown.status).toBe(404);
  });

  test('needs a reason of 3 to 300 characters, a valid status enum value, and no unknown keys (400)', async () => {
    const set = await upload('ADOLESCENT', 2);
    await step(set.setId, 'freeze');
    const [item] = await itemsOf(set.setId);
    for (const body of [{ status: 'RETIRED' }, { status: 'RETIRED', reason: '' }, { status: 'RETIRED', reason: 'ab' }, { status: 'RETIRED', reason: 'x'.repeat(301) }, { status: 'HIDDEN', reason: 'not a real status' }, { status: 'RETIRED', reason: 'ok reason', extra: 1 }]) {
      expect((await itemStep(set.setId, item._id, body)).status).toBe(400);
    }
    const row = await (await f.db()).collection('items').findOne({ _id: item._id });
    expect(row.status).toBe('ACTIVE'); // unchanged by every rejected attempt
  });

  test('non-admins are refused; a real admin token is required (401/403)', async () => {
    const set = await upload('ADOLESCENT', 2);
    await step(set.setId, 'freeze');
    const [item] = await itemsOf(set.setId);
    const p = await f.participant(16);
    const suspended = await f.admin('SUSPENDED');
    const body = { status: 'RETIRED', reason: 'access check' };
    expect((await itemStep(set.setId, item._id, body, {})).status).toBe(401);
    expect((await itemStep(set.setId, item._id, body, auth(p.token))).status).toBe(403);
    expect((await itemStep(set.setId, item._id, body, auth(suspended.token))).status).toBe(403);
    const row = await (await f.db()).collection('items').findOne({ _id: item._id });
    expect(row.status).toBe('ACTIVE'); // unchanged - none of the refused attempts took effect
  });
});
