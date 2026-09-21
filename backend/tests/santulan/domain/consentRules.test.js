/* Consent rules (T04-005..026): the machine, type/giver/age compatibility, the gate, and compare-and-set concurrency. */
const store = require('../../../src/modules/santulan/store');
const rules = require('../../../src/modules/santulan/domain/consentRules');
const consents = require('../../../src/modules/santulan/store/repositories/consents');
const { closeClient } = require('../../../src/modules/santulan/store/client');
const f = require('../helpers/committed');
const H = require('../helpers/mongoHarness');

afterAll(async () => { await f.cleanupFixtures(); await closeClient(); await H.closeAll(); });

const sys = () => store.systemScope();

describe('the consent machine', () => {
  test('T04-005 PENDING -> GRANTED -> VERIFIED -> WITHDRAWN; backwards and skipping steps are refused; WITHDRAWN is terminal', () => {
    const ok = [['PENDING', 'GRANTED'], ['PENDING', 'WITHDRAWN'], ['GRANTED', 'VERIFIED'], ['GRANTED', 'WITHDRAWN'], ['VERIFIED', 'WITHDRAWN']];
    for (const [a, b] of ok) expect(rules.canTransition(a, b)).toBe(true);
    const bad = [['PENDING', 'VERIFIED'], ['GRANTED', 'PENDING'], ['VERIFIED', 'GRANTED'], ['VERIFIED', 'PENDING'], ['WITHDRAWN', 'PENDING'], ['WITHDRAWN', 'GRANTED'], ['WITHDRAWN', 'VERIFIED'], ['WITHDRAWN', 'WITHDRAWN'], ['PENDING', 'PENDING']];
    for (const [a, b] of bad) {
      expect(rules.canTransition(a, b)).toBe(false);
      expect(() => rules.assertTransition(a, b)).toThrow(expect.objectContaining({ code: 'CONSENT_TRANSITION_INVALID', status: 409 }));
    }
  });
});

describe('type, giver and age compatibility', () => {
  test('T04-010 a minor cannot hold ADULT_SELF_CONSENT; an adult cannot hold STUDENT_ASSENT or PARENT_GUARDIAN_CONSENT', () => {
    expect(() => rules.assertTypeForAge('ADULT_SELF_CONSENT', true)).toThrow(expect.objectContaining({ status: 422 }));
    expect(() => rules.assertTypeForAge('STUDENT_ASSENT', false)).toThrow(expect.objectContaining({ status: 422 }));
    expect(() => rules.assertTypeForAge('PARENT_GUARDIAN_CONSENT', false)).toThrow(expect.objectContaining({ status: 422 }));
    for (const t of ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT']) expect(() => rules.assertTypeForAge(t, true)).not.toThrow();
    expect(() => rules.assertTypeForAge('ADULT_SELF_CONSENT', false)).not.toThrow();
  });

  test('T04-011 giver relationships per type; INSTITUTION_DELEGATED is refused', () => {
    expect(() => rules.assertGiver('PARENT_GUARDIAN_CONSENT', 'SELF')).toThrow();
    expect(() => rules.assertGiver('STUDENT_ASSENT', 'PARENT')).toThrow();
    expect(() => rules.assertGiver('ADULT_SELF_CONSENT', 'GUARDIAN')).toThrow();
    expect(() => rules.assertGiver('STUDENT_ASSENT', 'INSTITUTION_DELEGATED')).toThrow(expect.objectContaining({ status: 422 }));
    for (const g of ['PARENT', 'GUARDIAN']) expect(() => rules.assertGiver('PARENT_GUARDIAN_CONSENT', g)).not.toThrow();
    expect(() => rules.assertGiver('STUDENT_ASSENT', 'SELF')).not.toThrow();
  });
});

describe('the participation gate', () => {
  const c = (type, status, withdrawnAt = null) => ({ consentType: type, status, withdrawnAt });
  test('T04-015 a minor needs VERIFIED parent/guardian consent AND student assent; GRANTED is not enough', () => {
    const minor = { isMinor: true };
    expect(rules.evaluateGate(minor, []).open).toBe(false);
    expect(rules.evaluateGate(minor, [c('PARENT_GUARDIAN_CONSENT', 'VERIFIED')])).toMatchObject({ open: false, missingTypes: ['STUDENT_ASSENT'] });
    expect(rules.evaluateGate(minor, [c('PARENT_GUARDIAN_CONSENT', 'VERIFIED'), c('STUDENT_ASSENT', 'GRANTED')]).open).toBe(false);
    expect(rules.evaluateGate(minor, [c('PARENT_GUARDIAN_CONSENT', 'VERIFIED'), c('STUDENT_ASSENT', 'VERIFIED')])).toMatchObject({ open: true, missingTypes: [], requiredTypes: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'] });
  });
  test('T04-016 an adult needs VERIFIED adult self-consent; a withdrawn consent never counts', () => {
    const adult = { isMinor: false };
    expect(rules.evaluateGate(adult, [c('ADULT_SELF_CONSENT', 'VERIFIED')]).open).toBe(true);
    expect(rules.evaluateGate(adult, [c('ADULT_SELF_CONSENT', 'GRANTED')]).open).toBe(false);
    expect(rules.evaluateGate(adult, [c('ADULT_SELF_CONSENT', 'WITHDRAWN', new Date())]).open).toBe(false);
    expect(rules.evaluateGate(adult, [c('ADULT_SELF_CONSENT', 'VERIFIED', new Date())]).open).toBe(false);
  });
});

describe('compare-and-set on the consent row', () => {
  test('T04-025 two concurrent verifications make exactly one transition', async () => {
    const p = await f.participant(20, { consents: false });
    const consent = await store.withScope(sys(), (tx) => consents.createConsent(tx, { participantId: p.participantId, consentType: 'ADULT_SELF_CONSENT', giverRelationship: 'SELF', protocolVersion: 'TEST-PROTOCOL-1' }), { transaction: true });
    await store.withScope(sys(), (tx) => consents.transitionConsent(tx, consent.consentId, 'PENDING', 'GRANTED'), { transaction: true });
    const verify = () => store.withScope(sys(), (tx) => consents.transitionConsent(tx, consent.consentId, 'GRANTED', 'VERIFIED', { verification_method: 'TEST_METHOD_A' }), { transaction: true });
    const results = await Promise.all([verify(), verify(), verify()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const stored = (await (await H.admin()).collection('consents').findOne({ _id: consent.consentId }));
    expect(stored.status).toBe('VERIFIED');
    expect(stored.verification_method).toBe('TEST_METHOD_A');
  });

  test('T04-026 a stale from-state changes nothing', async () => {
    const p = await f.participant(20, { consents: false });
    const consent = await store.withScope(sys(), (tx) => consents.createConsent(tx, { participantId: p.participantId, consentType: 'ADULT_SELF_CONSENT', giverRelationship: 'SELF', protocolVersion: 'TEST-PROTOCOL-1' }), { transaction: true });
    const r = await store.withScope(sys(), (tx) => consents.transitionConsent(tx, consent.consentId, 'GRANTED', 'VERIFIED', { verification_method: 'X' }), { transaction: true });
    expect(r).toBeNull();
    expect((await (await H.admin()).collection('consents').findOne({ _id: consent.consentId })).status).toBe('PENDING');
  });
});
