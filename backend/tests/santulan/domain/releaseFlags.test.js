/* Release switches (FR-057, SC-022): all OFF on a new database, the latest audited event decides, unknown => OFF, change + audit atomic. */
const store = require('../../../src/modules/santulan/store');
const flags = require('../../../src/modules/santulan/domain/releaseFlags');
const { closeClient } = require('../../../src/modules/santulan/store/client');
const f = require('../helpers/committed');
const F = require('../helpers/fixtures');
const H = require('../helpers/mongoHarness');

let admin;
beforeAll(async () => { admin = await f.admin(); });
afterAll(async () => { await f.cleanupFixtures(); await closeClient(); await H.closeAll(); });

const sa = () => store.superAdminScope(admin.adminUserId);
const set = (flag, value, reason = 'a valid reason') => store.withScope(sa(), (tx) => flags.setFlag(tx, flag, value, reason, { adminUserId: admin.adminUserId }), { transaction: true });
const get = () => store.withScope(sa(), (tx) => flags.getSwitches(tx));

describe('defaults and reading', () => {
  test('B07-100 the four switches are exactly pilotS2, advancedEvidence, developmentRelease, pathwayRelease', () => {
    expect(flags.FLAGS).toEqual(['pilotS2', 'advancedEvidence', 'developmentRelease', 'pathwayRelease']);
  });

  test('B07-101 a switch that was never changed reads false, with no change record', async () => {
    const all = await store.withScope(sa(), (tx) => flags.getFlags(tx));
    for (const flag of flags.FLAGS) {
      if (!all[flag].changedAt) expect(all[flag]).toEqual({ value: false, changedAt: null, changedBy: null, reason: null });
    }
  });

  test('B07-102 the latest audit event per flag decides; flags are independent', async () => {
    await set('pilotS2', true);
    expect((await get()).pilotS2).toBe(true);
    await set('pilotS2', false, 'switched back off');
    await set('pathwayRelease', true, 'pathway pilot approved');
    const now = await get();
    expect(now.pilotS2).toBe(false);
    expect(now.pathwayRelease).toBe(true);
    expect(now.advancedEvidence).toBe(false);
    await set('pathwayRelease', false, 'reset for tests');
  });

  test('B07-103 an unrecognised stored value or a malformed event fails closed (OFF)', async () => {
    const db = await H.admin();
    await db.collection('audit_logs').insertOne(F.audit({ action_type: 'RELEASE_FLAG_CHANGED', target_entity: 'release_flag:developmentRelease', target_id: null, new_state: { flag: 'developmentRelease', value: 'yes' }, occurred_at: new Date(Date.now() + 5000) }));
    expect((await get()).developmentRelease).toBe(false);
    await db.collection('audit_logs').insertOne(F.audit({ action_type: 'RELEASE_FLAG_CHANGED', target_entity: 'release_flag:developmentRelease', target_id: null, new_state: { flag: 'pilotS2', value: true }, occurred_at: new Date(Date.now() + 6000) }));
    expect((await get()).developmentRelease).toBe(false); // an event that names another flag is not this flag's value
  });
});

describe('changing a switch', () => {
  test('B07-104 a reason of 3 to 300 characters is required; nothing changes without it', async () => {
    for (const reason of [null, '', 'ab', '  ', 'x'.repeat(301)]) { // (undefined would pick the helper's default)
      await expect(set('pilotS2', true, reason)).rejects.toMatchObject({ status: 400 });
    }
    expect((await get()).pilotS2).toBe(false);
  });

  test('B07-105 an unknown flag is 404 and a non-boolean value is 400', async () => {
    await expect(set('somethingElse', true)).rejects.toMatchObject({ status: 404 });
    await expect(set('pilotS2', 'true')).rejects.toMatchObject({ status: 400 });
  });

  test('B07-106 a change and its audit row are one transaction: a failing audit leaves the switch unchanged', async () => {
    await expect(store.withScope(sa(), (tx) => flags.setFlag(tx, 'advancedEvidence', true, 'valid reason', { adminUserId: 'not-a-uuid' }), { transaction: true })).rejects.toMatchObject({ code: 'AUDIT_UNAVAILABLE' });
    expect((await get()).advancedEvidence).toBe(false);
  });

  test('B07-107 the audit row records actor, previous and new state, reason and time, and no other data', async () => {
    await set('developmentRelease', true, 'development release approved');
    const [row] = await (await H.admin()).collection('audit_logs').find({ action_type: 'RELEASE_FLAG_CHANGED', target_entity: 'release_flag:developmentRelease', reason: 'development release approved' }).toArray();
    expect(row).toMatchObject({ actor_type: 'ADMIN', actor_id: admin.adminUserId, previous_state: { flag: 'developmentRelease', value: false }, new_state: { flag: 'developmentRelease', value: true } });
    expect(row.occurred_at).toBeInstanceOf(Date);
    await set('developmentRelease', false, 'reset for tests');
  });
});
