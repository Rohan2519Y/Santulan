/* Freeze / open / close rules (FR-018; upload-format section 4). Through the service on the scratch database. */
const rules = require('../../../src/services/domain/questionSetRules');
const service = require('../../../src/services/questionsets/questionSetService');
const verifyFrozen = require('../../../src/services/questionsets/verifyFrozenSets');
const store = require('../../../src/models/db');
const { closeClient } = require('../../../src/models/db/client');
const f = require('../helpers/committed');
const H = require('../helpers/mongoHarness');
const W = require('../helpers/questionWorkbook');

let admin; let actor;
beforeAll(async () => { admin = await f.admin(); actor = { adminUserId: admin.adminUserId }; });
afterAll(async () => { await f.cleanupFixtures(); await closeClient(); await H.closeAll(); });

const label = () => `fx-life-${f.u().toLowerCase()}`;
const upload = (lbl, { rows, ageGroup = 'ADOLESCENT' } = {}) => service.upload({
  buffer: W.workbook(rows || W.validRows({ label: lbl, ageGroup })), fileName: 'q.xlsx', ageGroup, actor,
});
const raw = async (id) => (await f.db()).collection('assessment_versions').findOne({ _id: id });
/** Closes any set the earlier tests left open for the age group, so one test never blocks another. */
const closeAllOpen = async () => (await f.db()).collection('assessment_versions').updateMany({ participation_state: 'OPEN', version_label: /^fx-/ }, { $set: { participation_state: 'CLOSED' } });
beforeEach(closeAllOpen);

describe('freeze', () => {
  test('T-B02-040 a draft with an eligible question in every domain freezes and is audited', async () => {
    const up = await upload(label());
    const r = await service.freeze(actor, up.body.setId, 'corr-1');
    expect(r).toMatchObject({ status: 'FROZEN', participationState: 'CLOSED' });
    expect(r.frozenAt).toBeTruthy();
    const audit = await (await f.db()).collection('audit_logs').findOne({ action_type: 'QUESTION_SET_FROZEN', target_id: up.body.setId });
    expect(audit).toMatchObject({ actor_type: 'ADMIN', actor_id: admin.adminUserId, previous_state: { status: 'DRAFT' }, correlation_id: 'corr-1' });
    expect(audit.new_state.contentHash).toBe(up.body.contentHash);
  });

  test('T-B02-041 a domain with no eligible question blocks the freeze and names the domains (SET_INCOMPLETE)', async () => {
    const rows = W.validRows({ label: label() }).filter((x) => !['C3', 'C5'].includes(x.cells.domain_code));
    const up = await upload('unused', { rows });
    await expect(service.freeze(actor, up.body.setId)).rejects.toMatchObject({ status: 409, code: 'SET_INCOMPLETE', message: expect.stringContaining('C3, C5') });
    expect((await raw(up.body.setId)).status).toBe('DRAFT');
  });

  test('T-B02-042 a question that fits no scoring rule does not count as eligible', async () => {
    // C1 has only an 18-25 College/Work question in an ADOLESCENT set: the store-side upload check refuses band and context, so
    // exercise the rule directly with a stored-shaped item.
    const items = W.validRows().map((r) => ({ ...r.cells, options: r.options, layer: 'CORE', status: 'ACTIVE' }));
    expect(rules.missingDomains(items, 'ADOLESCENT')).toEqual([]);
    const c1 = items.filter((i) => i.domain_code !== 'C1');
    expect(rules.missingDomains(c1, 'ADOLESCENT')).toEqual(['C1']);
    const wrongContext = items.map((i) => (i.domain_code === 'C2' ? { ...i, context: 'College/Work' } : i));
    expect(rules.missingDomains(wrongContext, 'ADOLESCENT')).toEqual(['C2']);
    const retired = items.map((i) => (i.domain_code === 'C4' ? { ...i, status: 'RETIRED' } : i));
    expect(rules.missingDomains(retired, 'ADOLESCENT')).toEqual(['C4']);
  });

  test('T-B02-043 only a draft can be frozen; a frozen set refuses edits and a same-label re-upload (SET_NOT_DRAFT)', async () => {
    const lbl = label();
    const up = await upload(lbl);
    await service.freeze(actor, up.body.setId);
    await expect(service.freeze(actor, up.body.setId)).rejects.toMatchObject({ status: 409, code: 'SET_NOT_DRAFT' });
    await expect(upload(lbl)).rejects.toMatchObject({ status: 409, code: 'SET_NOT_DRAFT' });
  });

  test('T-B02-044 a set whose stored questions no longer match its hash cannot be frozen', async () => {
    const up = await upload(label());
    await (await f.db()).collection('assessment_versions').updateOne({ _id: up.body.setId }, { $set: { content_hash: 'f'.repeat(64) } });
    await expect(service.freeze(actor, up.body.setId)).rejects.toMatchObject({ code: 'CATALOG_DRIFT' });
  });

  test('T-B02-045 an unknown set id is 404', async () => {
    await expect(service.freeze(actor, '00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({ status: 404 });
  });
});

describe('open and close', () => {
  test('T-B02-046 open needs FROZEN (SET_NOT_FROZEN); a draft cannot be opened', async () => {
    const up = await upload(label());
    await expect(service.open(actor, up.body.setId, 'go live')).rejects.toMatchObject({ status: 409, code: 'SET_NOT_FROZEN' });
    expect((await raw(up.body.setId)).participation_state).toBe('CLOSED');
  });

  test('T-B02-047 open a frozen set; a second frozen set for the same age group cannot be opened (OPEN_SET_EXISTS, store-enforced)', async () => {
    const a = await upload(label()); await service.freeze(actor, a.body.setId);
    const b = await upload(label()); await service.freeze(actor, b.body.setId);
    const opened = await service.open(actor, a.body.setId, 'pilot start');
    expect(opened.participationState).toBe('OPEN');
    await expect(service.open(actor, b.body.setId, 'second')).rejects.toMatchObject({ status: 409, code: 'OPEN_SET_EXISTS' });
    expect((await raw(b.body.setId)).participation_state).toBe('CLOSED');
    // the other age group is independent
    const c = await upload(label(), { ageGroup: 'EMERGING_ADULT' }); await service.freeze(actor, c.body.setId);
    await expect(service.open(actor, c.body.setId, 'adults')).resolves.toMatchObject({ participationState: 'OPEN', ageGroup: 'EMERGING_ADULT' });
  });

  test('T-B02-048 close needs an open set and a reason; closing frees the age group for another set', async () => {
    const a = await upload(label()); await service.freeze(actor, a.body.setId);
    const b = await upload(label()); await service.freeze(actor, b.body.setId);
    await expect(service.close(actor, a.body.setId, 'not open')).rejects.toMatchObject({ code: 'SET_NOT_FROZEN' });
    await service.open(actor, a.body.setId, 'start');
    const closed = await service.close(actor, a.body.setId, 'end of pilot week');
    expect(closed.participationState).toBe('CLOSED');
    await expect(service.open(actor, b.body.setId, 'next set')).resolves.toMatchObject({ participationState: 'OPEN' });
  });

  test('T-B02-049 every step is audited with the actor, previous and new state, reason and time', async () => {
    const up = await upload(label());
    await service.freeze(actor, up.body.setId);
    await service.open(actor, up.body.setId, 'reason for opening');
    await service.close(actor, up.body.setId, 'reason for closing');
    const rows = await (await f.db()).collection('audit_logs').find({ target_id: up.body.setId, action_type: { $regex: '^QUESTION_SET_(FROZEN|OPENED|CLOSED)$' } }).sort({ occurred_at: 1 }).toArray();
    expect(rows.map((r) => r.action_type)).toEqual(['QUESTION_SET_FROZEN', 'QUESTION_SET_OPENED', 'QUESTION_SET_CLOSED']);
    expect(rows[1]).toMatchObject({ actor_type: 'ADMIN', actor_id: admin.adminUserId, reason: 'reason for opening', previous_state: { participationState: 'CLOSED' }, new_state: { participationState: 'OPEN' } });
    expect(rows[2].reason).toBe('reason for closing');
    for (const r of rows) expect(r.occurred_at).toBeInstanceOf(Date);
  });

  test('T-B02-050 an audit failure aborts the move (the set keeps its state)', async () => {
    const up = await upload(label());
    await expect(service.freeze({ adminUserId: 'bad-id' }, up.body.setId)).rejects.toMatchObject({ code: 'AUDIT_UNAVAILABLE' });
    expect((await raw(up.body.setId)).status).toBe('DRAFT');
  });

  test('T-B02-051 two concurrent opens for one age group: exactly one wins', async () => {
    const a = await upload(label()); await service.freeze(actor, a.body.setId);
    const b = await upload(label()); await service.freeze(actor, b.body.setId);
    const results = await Promise.allSettled([service.open(actor, a.body.setId, 'race a'), service.open(actor, b.body.setId, 'race b')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected').reason).toMatchObject({ status: 409 });
  });
});

describe('a frozen set is immutable', () => {
  test('T-B02-011 no repository path updates a question\'s text or options - only status (visibility) is ever a permitted field, at the application layer', async () => {
    const up = await upload(label());
    await service.freeze(actor, up.body.setId);
    await store.withScope(store.superAdminScope(admin.adminUserId), async (tx) => {
      const item = await tx.c.items.findOne({ assessment_version_id: up.body.setId });
      await expect(tx.c.items.updateOne({ _id: item._id }, { $set: { item_text: 'changed' } })).rejects.toMatchObject({ status: 403 });
      await expect(tx.c.items.updateOne({ _id: item._id }, { $set: { options: [] } })).rejects.toMatchObject({ status: 403 });
      await expect(tx.c.items.updateOne({ _id: item._id }, { $set: { status: 'RETIRED' } })).resolves.toBeTruthy(); // the one permitted field
      await tx.c.items.updateOne({ _id: item._id }, { $set: { status: 'ACTIVE' } }); // restore
      await expect(tx.c.assessment_versions.updateOne({ _id: up.body.setId }, { $set: { content_hash: 'a'.repeat(64) } })).rejects.toMatchObject({ status: 403 });
    });
    // The application-layer whitelist above (access.js/dal.js) is the actual guarantee for item_text/options - not a
    // database-level one. Since migration 005, the database role grants `update` on items at all (so a Super Admin can
    // toggle status), the same way `assessment_versions` (Tier B, reference kind) already only relies on the
    // application layer to keep `content_hash` etc. off limits, with no per-field database ACL either. A raw
    // credential-level bypass of item_text specifically is therefore no longer refused by the database itself; it
    // never was for assessment_versions.content_hash, and the guarantee that matters is the one just tested above.
  });

  test('T-B02-052 the fingerprint check catches a tampered question and quarantines the set', async () => {
    const up = await upload(label());
    await service.freeze(actor, up.body.setId);
    await service.open(actor, up.body.setId, 'go');
    const db = await f.db();
    const item = await db.collection('items').findOne({ assessment_version_id: up.body.setId });
    await db.collection('items').updateOne({ _id: item._id }, { $set: { item_text: 'tampered outside the application' } }); // migrator, bypassing every application rule
    try {
      expect(await verifyFrozen.verifyOpenSets()).toEqual(expect.arrayContaining([expect.stringContaining('fx-life-')]));
      expect(verifyFrozen.isQuarantined(up.body.setId)).toBe(true);
      await store.withScope(store.systemScope(), async (tx) => {
        await expect(verifyFrozen.assertIntact(tx, await tx.c.assessment_versions.findOne({ _id: up.body.setId }))).rejects.toMatchObject({ status: 503, code: 'CATALOG_DRIFT' });
      });
      const { verify } = require('../../../scripts/db-verify');
      expect((await verify(db)).failures.some((x) => x.check === 'frozen-hash')).toBe(true);
    } finally {
      verifyFrozen.clearQuarantine();
      await db.collection('items').updateOne({ _id: item._id }, { $set: { item_text: item.item_text } });
    }
  });
});
