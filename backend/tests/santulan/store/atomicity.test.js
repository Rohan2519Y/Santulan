/* Atomicity and concurrency (G-18, G-19, G-20; B05-025/026, B07-076). Through the store, with the runtime credential. */
const H = require('../helpers/mongoHarness');
const F = require('../helpers/fixtures');
const store = require('../../../src/models/db');
const { withTransaction, transition } = require('../../../src/models/db/transactions');
const { getDb, closeClient } = require('../../../src/models/db/client');

const fx = H.withFixtures('atomicity');
afterAll(async () => { await fx.cleanup(); await closeClient(); await H.closeAll(); });

const sys = store.systemScope();

describe('G-18 a multi-step action commits fully or leaves no trace', () => {
  test('G-18 two collections commit together', async () => {
    const inst = F.institution();
    const audit = F.audit({ target_id: inst._id });
    fx.track('institutions', inst._id); fx.track('audit_logs', audit._id);
    await store.withScope(sys, async (tx) => {
      await tx.c.institutions.insertOne(inst);
      await tx.c.audit_logs.insertOne(audit);
    }, { transaction: true });
    await store.withScope(sys, async (tx) => {
      expect(await tx.c.institutions.exists(inst._id)).toBe(true);
      expect(await tx.c.audit_logs.exists(audit._id)).toBe(true);
    });
  });

  test('B05-025 a validator failure part-way leaves nothing (earlier writes are not leaked)', async () => {
    const inst = F.institution();
    fx.track('institutions', inst._id);
    await expect(store.withScope(sys, async (tx) => {
      await tx.c.institutions.insertOne(inst);
      await tx.c.institutions.insertOne({ ...F.institution(), institution_type: 'CLINIC' }); // fails validation
    }, { transaction: true })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    await store.withScope(sys, async (tx) => { expect(await tx.c.institutions.exists(inst._id)).toBe(false); });
  });

  test('B05-026 a unique-index failure part-way leaves nothing', async () => {
    const base = await fx.insertAdmin('institutions', F.institution());
    const fresh = F.institution();
    fx.track('institutions', fresh._id);
    await expect(store.withScope(sys, async (tx) => {
      await tx.c.institutions.insertOne(fresh);
      await tx.c.institutions.insertOne(F.institution({ institution_code: base.institution_code }));
    }, { transaction: true })).rejects.toMatchObject({ status: 409 });
    await store.withScope(sys, async (tx) => { expect(await tx.c.institutions.exists(fresh._id)).toBe(false); });
  });

  test('B07-076 when the audit insert fails the whole action aborts', async () => {
    const { writeAudit } = require('../../../src/models/repositories/audit');
    const inst = F.institution();
    fx.track('institutions', inst._id);
    await expect(store.withScope(sys, async (tx) => {
      await tx.c.institutions.insertOne(inst);
      await writeAudit(tx, { actorType: 'ROBOT', actionType: 'X', targetEntity: 'institution' }); // invalid actor type => store refuses => AUDIT_UNAVAILABLE
    }, { transaction: true })).rejects.toMatchObject({ status: 503, code: 'AUDIT_UNAVAILABLE' });
    await store.withScope(sys, async (tx) => { expect(await tx.c.institutions.exists(inst._id)).toBe(false); });
  });
});

describe('G-20 every transition is compare-and-set', () => {
  test('G-20 a stale from-state changes nothing and reports false', async () => {
    const p = await fx.insertAdmin('participants', F.participant());
    await store.withScope(sys, async (tx) => {
      expect(await tx.c.participants.transition(p._id, { status: 'SUSPENDED' }, { status: 'WITHDRAWN' })).toBe(false); // wrong from
      expect((await tx.c.participants.findOne({ _id: p._id })).status).toBe('ACTIVE');
      expect(await tx.c.participants.transition(p._id, { status: 'ACTIVE' }, { status: 'SUSPENDED' })).toBe(true);
      expect(await tx.c.participants.transition(p._id, { status: 'ACTIVE' }, { status: 'SUSPENDED' })).toBe(false); // already moved
    });
  });

  test('G-19 two concurrent transitions from the same state make exactly one win', async () => {
    const p = await fx.insertAdmin('participants', F.participant());
    const attempt = () => store.withScope(sys, (tx) => tx.c.participants.transition(p._id, { status: 'ACTIVE' }, { status: 'SUSPENDED' }), { transaction: true });
    const results = await Promise.all([attempt(), attempt(), attempt(), attempt()]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  test('G-20 the raw transition helper only matches the stated state', async () => {
    const db = await getDb();
    const p = await fx.insertAdmin('participants', F.participant());
    expect(await transition(db.collection('participants'), p._id, { status: 'WITHDRAWN' }, { status: 'SUSPENDED' })).toBe(false);
    expect(await transition(db.collection('participants'), p._id, { status: 'ACTIVE' }, { status: 'SUSPENDED' })).toBe(true);
  });
});

describe('G-19 concurrency converges', () => {
  test('G-19 concurrent inserts of the same unique key: exactly one commits, the others are refused', async () => {
    const code = `FX-CONC-${Date.now()}`;
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => {
      const inst = F.institution({ institution_code: code });
      fx.track('institutions', inst._id);
      return store.withScope(sys, (tx) => tx.c.institutions.insertOne(inst), { transaction: true });
    }));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((x) => x.status === 'rejected')) expect(r.reason.status).toBe(409);
  });

  test('G-19 concurrent writers to one document are serialised by the transaction retry', async () => {
    const att = await fx.insertAdmin('assessment_attempts', F.attempt(F.participant()._id, F.versionDoc()._id, { status: 'IN_PROGRESS', session_count: 1 }));
    await Promise.all(Array.from({ length: 3 }, () => store.withScope(sys, async (tx) => {
      const cur = await tx.c.assessment_attempts.findOne({ _id: att._id });
      await tx.c.assessment_attempts.updateOne({ _id: att._id }, { $set: { lock_version: cur.lock_version + 1 } });
    }, { transaction: true })));
    const db = await H.admin();
    expect((await db.collection('assessment_attempts').findOne({ _id: att._id })).lock_version).toBe(3);
  });

  test('withTransaction returns the callback result', async () => {
    expect(await withTransaction(async () => 42)).toBe(42);
  });
});
