/* Store guarantees observed through the identity flows (G-18, G-19, G-21, G-22). */
const request = require('supertest');
const app = require('../../../src/app');
const store = require('../../../src/models/db');
const consents = require('../../../src/models/repositories/consents');
const { writeAudit } = require('../../../src/services/audit/auditService');
const { closeClient } = require('../../../src/models/db/client');
const f = require('../helpers/committed');
const H = require('../helpers/mongoHarness');

afterAll(async () => { await f.cleanupFixtures(); await closeClient(); await H.closeAll(); });

const key = () => `idem-${f.u()}-${f.u()}`;
const sys = () => store.systemScope();

describe('G-18 a consent verification and its audit row commit together', () => {
  test('G-18 when the audit insert fails the consent stays unchanged', async () => {
    const p = await f.participant(20, { consents: false });
    const consent = await store.withScope(sys(), (tx) => consents.createConsent(tx, { participantId: p.participantId, consentType: 'ADULT_SELF_CONSENT', giverRelationship: 'SELF', protocolVersion: 'TEST-PROTOCOL-1' }), { transaction: true });
    await store.withScope(sys(), (tx) => consents.transitionConsent(tx, consent.consentId, 'PENDING', 'GRANTED'), { transaction: true });

    await expect(store.withScope(sys(), async (tx) => {
      await consents.transitionConsent(tx, consent.consentId, 'GRANTED', 'VERIFIED', { verification_method: 'TEST_METHOD_A' });
      await writeAudit(tx, { actorType: 'NOT_AN_ACTOR', actionType: 'CONSENT_VERIFIED', targetEntity: 'consents', targetId: consent.consentId }); // store refuses -> AUDIT_UNAVAILABLE
    }, { transaction: true })).rejects.toMatchObject({ status: 503, code: 'AUDIT_UNAVAILABLE' });

    const stored = await (await f.db()).collection('consents').findOne({ _id: consent.consentId });
    expect(stored.status).toBe('GRANTED');
    expect(stored.verification_method).toBeNull();
  });

  test('G-18 when both writes succeed the consent and its audit row exist together', async () => {
    const p = await f.participant(20, { consents: false });
    const consent = await store.withScope(sys(), (tx) => consents.createConsent(tx, { participantId: p.participantId, consentType: 'ADULT_SELF_CONSENT', giverRelationship: 'SELF', protocolVersion: 'TEST-PROTOCOL-1' }), { transaction: true });
    await store.withScope(sys(), async (tx) => {
      await consents.transitionConsent(tx, consent.consentId, 'PENDING', 'GRANTED');
      await writeAudit(tx, { actorType: 'SYSTEM', actionType: 'CONSENT_GRANTED', targetEntity: 'consents', targetId: consent.consentId });
    }, { transaction: true });
    const db = await f.db();
    expect((await db.collection('consents').findOne({ _id: consent.consentId })).status).toBe('GRANTED');
    expect(await db.collection('audit_logs').countDocuments({ target_id: consent.consentId, action_type: 'CONSENT_GRANTED' })).toBe(1);
  });
});

describe('G-19 simultaneous registrations with one Idempotency-Key', () => {
  test('G-19 produce exactly one participant', async () => {
    const k = key();
    const post = () => request(app).post('/api/v1/registrations/open').set('Idempotency-Key', k).send({ age: 22 });
    const results = await Promise.all(Array.from({ length: 6 }, post));
    expect(results.every((r) => [200, 201].includes(r.status))).toBe(true);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const ids = new Set(results.map((r) => r.body.santulanId));
    expect(ids.size).toBe(1);
    expect(await (await f.db()).collection('participants').countDocuments({ santulan_id: [...ids][0] })).toBe(1);
  });
});

describe('G-21/G-22 isolation through the API and the store', () => {
  test('G-22 an OPEN participant token cannot read another participant\'s consents', async () => {
    const a = await f.participant(19);
    const b = await f.participant(19);
    const own = await request(app).get('/api/v1/consents/requirements').set('Authorization', `Bearer ${a.token}`);
    expect(own.status).toBe(200);
    expect(own.body.consents).toHaveLength(1);
    // through the store: b's scope cannot read a's consents even when it names a's participant id
    await store.withScope(store.participantScope(b.participantId), async (tx) => {
      expect(await tx.c.consents.find({ participant_id: a.participantId })).toEqual([]);
    });
  });

  test('G-21 an attempt to update or delete an audit row through the access layer is refused', async () => {
    const a = await (async () => {
      const audit = require('../helpers/fixtures').audit();
      await (await f.db()).collection('audit_logs').insertOne(audit);
      return audit;
    })();
    await store.withScope(sys(), async (tx) => {
      await expect(tx.c.audit_logs.updateOne({ _id: a._id }, { $set: { reason: 'edited' } })).rejects.toMatchObject({ status: 403 });
      expect(tx.c.audit_logs.deleteOne).toBeUndefined();
      expect(tx.c.audit_logs.remove).toBeUndefined();
    });
    // and the credential itself refuses, independent of the access layer
    await H.expectRefused((await H.runtime()).collection('audit_logs').updateOne({ _id: a._id }, { $set: { reason: 'edited' } }), 13);
    await H.expectRefused((await H.runtime()).collection('audit_logs').deleteOne({ _id: a._id }), 13);
    await (await f.db()).collection('audit_logs').deleteOne({ _id: a._id });
  });
});
