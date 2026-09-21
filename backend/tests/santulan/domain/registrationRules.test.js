/* Registration rules (T03-007..013, T03-009, T03-021): cross-document rules enforced in the registering transaction. */
const store = require('../../../src/modules/santulan/store');
const rules = require('../../../src/modules/santulan/domain/registrationRules');
const identity = require('../../../src/modules/santulan/store/repositories/identity');
const { closeClient } = require('../../../src/modules/santulan/store/client');
const f = require('../helpers/committed');
const H = require('../helpers/mongoHarness');

afterAll(async () => { await f.cleanupFixtures(); await closeClient(); await H.closeAll(); });

const sys = () => store.systemScope();

describe('derived fields and age', () => {
  test('T03-009 age 12 and 26 are AGE_INELIGIBLE; 13 and 25 are eligible', () => {
    for (const age of [12, 26, 0, -1, 17.5, null]) expect(() => rules.assertEligibleAge(age)).toThrow(expect.objectContaining({ code: 'AGE_INELIGIBLE', status: 422 }));
    for (const age of [13, 17, 18, 25]) expect(() => rules.assertEligibleAge(age)).not.toThrow();
  });

  test('T03-010 derived fields follow the age (kept in step with the collection validator)', () => {
    const table = [[13, 'D1', 'ADOLESCENT', true], [15, 'D1', 'ADOLESCENT', true], [16, 'D2', 'ADOLESCENT', true], [17, 'D2', 'ADOLESCENT', true],
      [18, 'D3', 'EMERGING_ADULT', false], [20, 'D3', 'EMERGING_ADULT', false], [21, 'D4', 'EMERGING_ADULT', false], [25, 'D4', 'EMERGING_ADULT', false]];
    for (const [age, band, track, minor] of table) {
      expect(rules.deriveFields(age)).toEqual({ developmental_band: band, assessment_track: track, is_minor: minor });
    }
  });

  test('T03-021 the participant document is never built with a client-supplied Santulan ID', () => {
    const doc = rules.buildParticipant({ _id: 'x', route: 'OPEN', age: 15, santulanId: 'STN-CLIENTCHOSEN' });
    expect(doc.santulan_id).toMatch(/^STN-[0-9A-HJKMNP-TV-Z]{20}$/);
    expect(doc.santulan_id).not.toBe('STN-CLIENTCHOSEN');
    expect(doc.status).toBe('ACTIVE');
  });
});

describe('scope (cross-document, application-enforced)', () => {
  test('T03-011 an OPEN registration carries no institution scope', async () => {
    await store.withScope(sys(), async (tx) => {
      await expect(rules.assertScope(tx, { route: 'OPEN', institutionId: 'x' })).rejects.toMatchObject({ code: 'SCOPE_INVALID' });
      await expect(rules.assertScope(tx, { route: 'OPEN', externalStudentId: 'E1' })).rejects.toMatchObject({ code: 'SCOPE_INVALID' });
      await expect(rules.assertScope(tx, { route: 'OPEN' })).resolves.toBeNull();
    });
  });

  test('T03-012 INSTITUTIONAL needs an ACTIVE institution and ACTIVE cohort that belongs to it', async () => {
    const inst = await f.institution('ACTIVE');
    const coh = await f.cohort(inst, 'ACTIVE');
    const otherInst = await f.institution('ACTIVE');
    const inactiveInst = await f.institution('INACTIVE');
    const cohOfInactive = await f.cohort(inactiveInst, 'ACTIVE');
    const inactiveCoh = await f.cohort(inst, 'INACTIVE');
    await store.withScope(sys(), async (tx) => {
      await expect(rules.assertScope(tx, { route: 'INSTITUTIONAL', institutionId: inst, cohortId: coh })).resolves.toMatchObject({ institution: { institutionId: inst }, cohort: { cohortId: coh } });
      // a cohort of another institution, an inactive institution, an inactive cohort, and missing ids are all refused
      await expect(rules.assertScope(tx, { route: 'INSTITUTIONAL', institutionId: otherInst, cohortId: coh })).rejects.toMatchObject({ code: 'SCOPE_INVALID', status: 422 });
      await expect(rules.assertScope(tx, { route: 'INSTITUTIONAL', institutionId: inactiveInst, cohortId: cohOfInactive })).rejects.toMatchObject({ code: 'SCOPE_INVALID' });
      await expect(rules.assertScope(tx, { route: 'INSTITUTIONAL', institutionId: inst, cohortId: inactiveCoh })).rejects.toMatchObject({ code: 'SCOPE_INVALID' });
      await expect(rules.assertScope(tx, { route: 'INSTITUTIONAL', institutionId: inst })).rejects.toMatchObject({ code: 'SCOPE_INVALID' });
    });
  });

  test('T03-013 the external student id is unique per institution and reusable across institutions (store index)', async () => {
    const i1 = await f.institution();
    const i2 = await f.institution();
    const c1 = await f.cohort(i1);
    const c2 = await f.cohort(i2);
    const uuid = () => require('uuid').v4();
    const make = (i, c) => store.withScope(sys(), (tx) => identity.insertParticipant(tx, { ...rules.buildParticipant({ _id: uuid(), route: 'INSTITUTIONAL', age: 16, institutionId: i, cohortId: c, externalStudentId: 'REG-1' }), santulan_id: f.fxSantulanId() }), { transaction: true });
    const first = await make(i1, c1);
    expect(first.participationRoute).toBe('INSTITUTIONAL');
    await expect(make(i1, c1)).rejects.toMatchObject({ status: 409, code: 'DUPLICATE_IDENTITY' });
    await expect(make(i2, c2)).resolves.toMatchObject({ externalStudentId: 'REG-1' });
  });
});
