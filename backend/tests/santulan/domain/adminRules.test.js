/*
 * Admin rules (B08-004..010, 013, 054, 055, 079): the pilot role model, atomic audited control changes, no update / remove on audit rows or
 * answers for the runtime credential, no delete path for an institution, and the data model staying at 27 collections + 9 views.
 * (A suspended admin being denied on the next request is asserted over HTTP in contract/adminControl.test.js.)
 */
const { v4: uuidv4 } = require('uuid');
const rules = require('../../../src/services/domain/adminRules');
const controlService = require('../../../src/services/admin/controlService');
const institutionService = require('../../../src/services/admin/institutionService');
const store = require('../../../src/models/db');
const collections = require('../../../src/models/schema/collections');
const { views } = require('../../../src/models/schema/views');
const f = require('../helpers/committed');
const F = require('../helpers/fixtures');
const H = require('../helpers/mongoHarness');
const { closeClient } = require('../../../src/models/db/client');

let admin;
beforeAll(async () => { admin = await f.admin(); });
afterAll(async () => {
  await (await H.admin()).collection('audit_logs').deleteMany({ action_type: { $in: ['PARTICIPATION_CONTROL', 'INSTITUTION_CREATED', 'INSTITUTION_UPDATED', 'INSTITUTION_ARCHIVED'] } });
  await (await H.admin()).collection('institutions').deleteMany({ institution_code: /^FX-ADM-/ });
  await f.cleanupFixtures(); await closeClient(); await H.closeAll();
});

const actor = () => ({ scope: 'SUPER_ADMIN', adminUserId: admin.adminUserId });
const latestControl = async () => (await (await H.admin()).collection('audit_logs').find({ action_type: 'PARTICIPATION_CONTROL' }).sort({ occurred_at: -1, _id: -1 }).limit(1).toArray())[0];

describe('the pilot role model (B08-004..010, G-07)', () => {
  test('only SUPER_ADMIN can be ACTIVE; INSTITUTION_ADMIN and RESEARCH_OPERATOR cannot', () => {
    expect(() => rules.assertRoleCanBeActive('SUPER_ADMIN', 'ACTIVE')).not.toThrow();
    for (const role of ['INSTITUTION_ADMIN', 'RESEARCH_OPERATOR']) {
      expect(() => rules.assertRoleCanBeActive(role, 'ACTIVE')).toThrow(expect.objectContaining({ status: 422 }));
      expect(() => rules.assertRoleCanBeActive(role, 'INACTIVE')).not.toThrow();
      expect(() => rules.assertRoleCanBeActive(role, 'SUSPENDED')).not.toThrow();
    }
    expect(() => rules.assertRoleCanBeActive('ROOT', 'ACTIVE')).toThrow(expect.objectContaining({ status: 400 }));
  });

  test('the store refuses an ACTIVE INSTITUTION_ADMIN / RESEARCH_OPERATOR too (validator), so no code path can save one', async () => {
    const db = await H.admin();
    for (const role of ['INSTITUTION_ADMIN', 'RESEARCH_OPERATOR']) {
      await H.expectRefused(db.collection('admin_users').insertOne(F.admin({ role, status: 'ACTIVE' })), 121);
    }
    const ok = F.admin({ role: 'INSTITUTION_ADMIN', status: 'INACTIVE' });
    await db.collection('admin_users').insertOne(ok);
    await db.collection('admin_users').deleteOne({ _id: ok._id });
  });
});

describe('the control plane (B08-013, 054, 055)', () => {
  test('a pause or stop needs a reason of 3 to 300 characters; OPEN does not', () => {
    for (const state of ['PAUSED', 'STOPPED']) {
      for (const reason of [undefined, null, '', '  ', 'ab', 'x'.repeat(301)]) expect(() => rules.assertControlChange(state, reason)).toThrow(expect.objectContaining({ status: 422 }));
      expect(rules.assertControlChange(state, '  maintenance window  ')).toBe('maintenance window');
    }
    expect(rules.assertControlChange('OPEN', undefined)).toBeNull();
    expect(rules.assertControlChange('OPEN', 'reopened')).toBe('reopened');
    expect(() => rules.assertControlChange('CLOSED', 'reason')).toThrow(expect.objectContaining({ status: 400 }));
  });

  test('B08-054 the change and its audit event are one write: an audit failure leaves the state exactly as it was', async () => {
    await controlService.setState(actor(), { state: 'OPEN', reason: 'baseline' });
    const before = await latestControl();
    await expect(controlService.setState({ scope: 'SUPER_ADMIN', adminUserId: 'not-a-uuid' }, { state: 'STOPPED', reason: 'should not persist' })).rejects.toMatchObject({ code: 'AUDIT_UNAVAILABLE' });
    expect((await latestControl())._id).toBe(before._id);
    expect((await controlService.read(actor())).state).toBe('OPEN');
  });

  test('a change records actor, previous and new state, reason and time; the previous state defaults to OPEN', async () => {
    await controlService.setState(actor(), { state: 'STOPPED', reason: 'unit test stop' });
    const row = await latestControl();
    expect(row).toMatchObject({ actor_type: 'ADMIN', actor_id: admin.adminUserId, previous_state: { state: 'OPEN' }, new_state: { state: 'STOPPED' }, reason: 'unit test stop' });
    expect(row.occurred_at).toBeInstanceOf(Date);
    await controlService.setState(actor(), { state: 'OPEN', reason: 'reopened' });
    expect((await controlService.read(actor())).controlPlane).toBe('OPEN');
  });

  test('a PAUSED event also stops new attempts (only OPEN opens the control plane); an unrecognised value fails closed', async () => {
    await controlService.setState(actor(), { state: 'PAUSED', reason: 'pause for test' });
    expect((await controlService.read(actor())).controlPlane).toBe('STOPPED');
    await (await H.admin()).collection('audit_logs').insertOne(F.audit({ action_type: 'PARTICIPATION_CONTROL', target_entity: 'participation', new_state: { state: 'MAYBE' }, occurred_at: new Date() }));
    expect((await controlService.read(actor())).controlPlane).toBe('STOPPED');
    await new Promise((resolve) => setTimeout(resolve, 20));
    await controlService.setState(actor(), { state: 'OPEN', reason: 'reopened' });
    expect((await controlService.read(actor())).controlPlane).toBe('OPEN');
  });
});

describe('append-only data stays append-only for the runtime credential (B08-006, G-13)', () => {
  test('the runtime credential can neither update nor remove audit rows or answers', async () => {
    const runtime = await H.runtime();
    const audit = F.audit({ action_type: 'FX_ADMIN_RULES' });
    await (await H.admin()).collection('audit_logs').insertOne(audit);
    await H.expectRefused(runtime.collection('audit_logs').updateOne({ _id: audit._id }, { $set: { reason: 'edited' } }), 13);
    await H.expectRefused(runtime.collection('audit_logs').deleteOne({ _id: audit._id }), 13);
    await H.expectRefused(runtime.collection('responses').deleteMany({}), 13); // answers are never removed
    await H.expectRefused(runtime.collection('response_events').updateMany({}, { $set: { event_type: 'SUBMIT' } }), 13);
    await H.expectRefused(runtime.collection('score_results').deleteMany({}), 13);
    await (await H.admin()).collection('audit_logs').deleteOne({ _id: audit._id });
  });

  test('the data-access layer has no remove at all, and no audit or score update path', async () => {
    await store.withScope(store.superAdminScope(admin.adminUserId), async (tx) => {
      for (const name of Object.keys(tx.c)) { expect(tx.c[name].deleteOne).toBeUndefined(); expect(tx.c[name].remove).toBeUndefined(); expect(tx.c[name].deleteMany).toBeUndefined(); }
      await expect(tx.c.audit_logs.updateOne({}, { $set: { reason: 'x' } })).rejects.toMatchObject({ status: 403 });
      // an answer's content never changes: the only permitted update is retiring the previous version (is_current)
      await expect(tx.c.responses.updateOne({}, { $set: { response_value: '5' } })).rejects.toMatchObject({ status: 403 });
      await expect(tx.c.responses.updateOne({}, { $set: { answered_at: new Date() } })).rejects.toMatchObject({ status: 403 });
    });
  });
});

describe('institutions have no delete path (B08-079)', () => {
  test('an institution is archived, never deleted; an archived one cannot be reopened; a parent cycle is refused', async () => {
    const a = await institutionService.create(actor(), { institutionCode: `FX-ADM-${f.u()}`, institutionName: 'Fixture A', institutionType: 'SCHOOL' });
    const b = await institutionService.create(actor(), { institutionCode: `FX-ADM-${f.u()}`, institutionName: 'Fixture B', institutionType: 'COLLEGE', parentInstitutionId: a.institutionId });
    await expect(institutionService.update(actor(), a.institutionId, { parentInstitutionId: b.institutionId })).rejects.toMatchObject({ status: 422 }); // a would sit under its own child
    await expect(institutionService.update(actor(), a.institutionId, { parentInstitutionId: a.institutionId })).rejects.toMatchObject({ status: 422 });
    expect((await institutionService.update(actor(), a.institutionId, { status: 'ARCHIVED' })).status).toBe('ARCHIVED');
    await expect(institutionService.update(actor(), a.institutionId, { status: 'ACTIVE' })).rejects.toMatchObject({ status: 422 });
    const runtime = await H.runtime();
    await H.expectRefused(runtime.collection('institutions').deleteOne({ _id: a.institutionId }), 13);
    expect(await (await H.admin()).collection('institutions').countDocuments({ _id: a.institutionId })).toBe(1);
    expect(typeof institutionService.remove).toBe('undefined');
    expect(rules.assertNoParentCycle).toBeDefined();
  });

  test('status moves: ACTIVE <-> INACTIVE, either to ARCHIVED, ARCHIVED is final; participant status only ACTIVE <-> SUSPENDED and WITHDRAWN is final', () => {
    expect(() => rules.assertStatusMove('ACTIVE', 'INACTIVE')).not.toThrow();
    expect(() => rules.assertStatusMove('INACTIVE', 'ACTIVE')).not.toThrow();
    expect(() => rules.assertStatusMove('INACTIVE', 'ARCHIVED')).not.toThrow();
    expect(() => rules.assertStatusMove('ARCHIVED', 'ACTIVE')).toThrow(expect.objectContaining({ status: 422 }));
    expect(() => rules.assertStatusMove('ACTIVE', 'DELETED')).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => rules.assertParticipantStatusMove('ACTIVE', 'SUSPENDED')).not.toThrow();
    expect(() => rules.assertParticipantStatusMove('SUSPENDED', 'ACTIVE')).not.toThrow();
    expect(() => rules.assertParticipantStatusMove('WITHDRAWN', 'ACTIVE')).toThrow(expect.objectContaining({ status: 422 }));
    expect(() => rules.assertParticipantStatusMove('ACTIVE', 'ACTIVE')).toThrow(expect.objectContaining({ status: 422 }));
    expect(() => rules.assertParticipantStatusMove('ACTIVE', 'WITHDRAWN')).toThrow(expect.objectContaining({ status: 400 }));
  });

  test('the participant listing whitelist: route, institutionId, cohortId, status, search and limit; any other key is EXPORT_FILTER_UNKNOWN (422)', () => {
    expect(() => rules.assertKnownListingKeys({ route: 'OPEN', status: 'ACTIVE', limit: '10' })).not.toThrow();
    expect(() => rules.assertKnownListingKeys({ search: 'STN-ABC' })).not.toThrow();
    expect(() => rules.assertKnownListingKeys({})).not.toThrow();
    expect(() => rules.assertKnownListingKeys({ institution: 'x' })).toThrow(expect.objectContaining({ status: 422, code: 'EXPORT_FILTER_UNKNOWN' }));
  });
});

describe('the Santulan ID search box (admin listings)', () => {
  test('an empty box is not a search and not an error', () => {
    for (const empty of [undefined, null, '', '   ']) expect(rules.santulanIdPrefix(empty)).toBeNull();
  });

  test('a partial id becomes an anchored prefix, with or without the STN- prefix, in any case', () => {
    expect(rules.santulanIdPrefix('STN-ABC')).toEqual({ $regex: '^STN-ABC' });
    expect(rules.santulanIdPrefix('abc')).toEqual({ $regex: '^STN-ABC' });
    expect(rules.santulanIdPrefix('  stn-abc23  ')).toEqual({ $regex: '^STN-ABC23' });
  });

  test('a regex metacharacter can never reach the regex engine (no injection, no backtracking)', () => {
    for (const hostile of ['.*', 'A|B', '(a+)+$', 'STN-.*', 'a[bc]', '^', 'STN-']) {
      expect(() => rules.santulanIdPrefix(hostile)).toThrow(expect.objectContaining({ status: 422, code: 'VALIDATION_ERROR' }));
    }
  });

  test('characters a Santulan ID never uses (I, L, O, U) and over-long input are refused', () => {
    for (const bad of ['STN-I', 'STN-L', 'STN-O', 'STN-U', 'A'.repeat(21)]) {
      expect(() => rules.santulanIdPrefix(bad)).toThrow(expect.objectContaining({ status: 422 }));
    }
  });
});

describe('the data model is unchanged (B08-079)', () => {
  test('28 canonical collections, one dev collection and 9 views exist in the scratch database', async () => {
    expect(collections.canonical).toHaveLength(28);
    expect(views).toHaveLength(9);
    const list = await (await H.admin()).listCollections().toArray();
    const names = (type) => list.filter((c) => c.type === type).map((c) => c.name);
    for (const c of collections.canonical) expect(names('collection')).toContain(c.name);
    for (const v of views) expect(names('view')).toContain(v.name);
    expect(names('view').filter((n) => n.startsWith('v_'))).toHaveLength(9);
    expect(names('collection').filter((n) => !n.startsWith('_') && !n.startsWith('system.') && !collections.DEV_COLLECTIONS.includes(n) && !collections.canonical.some((c) => c.name === n))).toEqual([]);
  });
});
