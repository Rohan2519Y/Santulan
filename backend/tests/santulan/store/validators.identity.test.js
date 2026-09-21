/* Identity collections, runtime credential (G-01, G-02, G-03, G-07; T03-007..013, T03-028, T04-005..017, B08-009/010). */
const H = require('../helpers/mongoHarness');
const F = require('../helpers/fixtures');

const fx = H.withFixtures('identity');
afterAll(async () => { await fx.cleanup(); await H.closeAll(); });

const ok = (coll, doc) => H.accepts(coll, doc);

describe('G-01 undeclared fields and types', () => {
  test('G-01 an undeclared field is refused on every identity collection', async () => {
    const i = F.institution();
    expect(await ok('institutions', { ...i, extra: 1 })).toBe(false);
    expect(await ok('institutions', i)).toBe(true);
    expect(await ok('participants', { ...F.participant(), full_name: 'x' })).toBe(false);
    expect(await ok('consents', { ...F.consent(F.participant()._id), note: 'x' })).toBe(false);
    expect(await ok('admin_users', { ...F.admin(), email: 'x@y.z' })).toBe(false);
  });
  test('G-01 a wrong type is refused', async () => {
    expect(await ok('participants', { ...F.participant(), age_years_at_registration: '16' })).toBe(false);
    expect(await ok('institutions', { ...F.institution(), created_at: '2026-01-01' })).toBe(false);
  });
});

describe('institutions', () => {
  test('T03-007 institution_type must be SCHOOL, COLLEGE or UNIVERSITY', async () => {
    expect(await ok('institutions', F.institution({ institution_type: 'COLLEGE' }))).toBe(true);
    expect(await ok('institutions', F.institution({ institution_type: 'CLINIC' }))).toBe(false);
  });
  test('T03-008 an institution cannot be its own parent', async () => {
    const id = F.institution()._id;
    expect(await ok('institutions', F.institution({ _id: id, parent_institution_id: id }))).toBe(false);
    expect(await ok('institutions', F.institution({ parent_institution_id: F.institution()._id }))).toBe(true);
  });
});

describe('G-02 participants', () => {
  test('T03-009 age must be 13 to 25', async () => {
    for (const age of [12, 26]) {
      expect(await ok('participants', F.participant({ age_years_at_registration: age }))).toBe(false);
    }
    for (const age of [13, 25]) expect(await ok('participants', F.participant({ age_years_at_registration: age }))).toBe(true);
  });

  test('T03-010 developmental_band, assessment_track and is_minor must match the age', async () => {
    const cases = [[13, 'D1'], [15, 'D1'], [16, 'D2'], [17, 'D2'], [18, 'D3'], [20, 'D3'], [21, 'D4'], [25, 'D4']];
    for (const [age, band] of cases) {
      expect(await ok('participants', F.participant({ age_years_at_registration: age }))).toBe(true);
      const wrong = band === 'D1' ? 'D2' : 'D1';
      expect(await ok('participants', F.participant({ age_years_at_registration: age, developmental_band: wrong }))).toBe(false);
    }
    expect(await ok('participants', F.participant({ age_years_at_registration: 17, assessment_track: 'EMERGING_ADULT' }))).toBe(false);
    expect(await ok('participants', F.participant({ age_years_at_registration: 18, assessment_track: 'ADOLESCENT' }))).toBe(false);
    expect(await ok('participants', F.participant({ age_years_at_registration: 17, is_minor: false }))).toBe(false);
    expect(await ok('participants', F.participant({ age_years_at_registration: 18, is_minor: true }))).toBe(false);
  });

  test('T03-011 derived fields stay consistent on UPDATE (age cannot change alone)', async () => {
    const p = await fx.insertRuntime('participants', F.participant({ age_years_at_registration: 16 }));
    const db = await H.runtime();
    await H.expectRefused(db.collection('participants').updateOne({ _id: p._id }, { $set: { age_years_at_registration: 19 } }), 121);
    await H.expectRefused(db.collection('participants').updateOne({ _id: p._id }, { $set: { is_minor: false } }), 121);
    const r = await db.collection('participants').updateOne({ _id: p._id }, { $set: { status: 'SUSPENDED' } });
    expect(r.modifiedCount).toBe(1);
  });

  test('T03-012 OPEN route carries no institution, cohort or external id', async () => {
    const inst = F.institution();
    const coh = F.cohort(inst._id);
    expect(await ok('participants', F.participant({ institution_id: inst._id }))).toBe(false);
    expect(await ok('participants', F.participant({ cohort_id: coh._id }))).toBe(false);
    expect(await ok('participants', F.participant({ external_student_id: 'X1' }))).toBe(false);
  });

  test('T03-013 INSTITUTIONAL route needs institution and cohort', async () => {
    const inst = F.institution();
    const coh = F.cohort(inst._id);
    expect(await ok('participants', F.participant({ participation_route: 'INSTITUTIONAL', institution_id: inst._id, cohort_id: coh._id }))).toBe(true);
    expect(await ok('participants', F.participant({ participation_route: 'INSTITUTIONAL', institution_id: inst._id }))).toBe(false);
    expect(await ok('participants', F.participant({ participation_route: 'INSTITUTIONAL' }))).toBe(false);
  });

  test('T03-028 auth provider and subject are both set or both null', async () => {
    expect(await ok('participants', F.participant({ auth_provider: 'fx', auth_provider_subject_id: 'S1' }))).toBe(true);
    expect(await ok('participants', F.participant({ auth_provider: 'fx' }))).toBe(false);
    expect(await ok('participants', F.participant({ auth_provider_subject_id: 'S1' }))).toBe(false);
  });

  test('G-02 santulan_id must have the STN- format', async () => {
    expect(await ok('participants', F.participant({ santulan_id: 'STN-123' }))).toBe(false);
  });
});

describe('G-03 consents', () => {
  const pid = F.participant()._id;
  test('T04-005 type and giver combinations', async () => {
    expect(await ok('consents', F.consent(pid, { consent_type: 'ADULT_SELF_CONSENT', giver_relationship: 'SELF' }))).toBe(true);
    expect(await ok('consents', F.consent(pid, { consent_type: 'STUDENT_ASSENT', giver_relationship: 'SELF' }))).toBe(true);
    expect(await ok('consents', F.consent(pid, { consent_type: 'STUDENT_ASSENT', giver_relationship: 'PARENT' }))).toBe(false);
    expect(await ok('consents', F.consent(pid, { consent_type: 'ADULT_SELF_CONSENT', giver_relationship: 'GUARDIAN' }))).toBe(false);
    for (const g of ['PARENT', 'GUARDIAN']) expect(await ok('consents', F.consent(pid, { consent_type: 'PARENT_GUARDIAN_CONSENT', giver_relationship: g }))).toBe(true);
    expect(await ok('consents', F.consent(pid, { consent_type: 'PARENT_GUARDIAN_CONSENT', giver_relationship: 'SELF' }))).toBe(false);
  });
  test('T04-006 protocol_version must not be blank', async () => {
    expect(await ok('consents', F.consent(pid, { protocol_version: '' }))).toBe(false);
    expect(await ok('consents', F.consent(pid, { protocol_version: '   ' }))).toBe(false);
  });
  test('T04-007 VERIFIED needs verified_at and a non-blank verification method', async () => {
    expect(await ok('consents', F.verifiedConsent(pid))).toBe(true);
    expect(await ok('consents', F.verifiedConsent(pid, { verified_at: null }))).toBe(false);
    expect(await ok('consents', F.verifiedConsent(pid, { verification_method: null }))).toBe(false);
    expect(await ok('consents', F.verifiedConsent(pid, { verification_method: '  ' }))).toBe(false);
  });
  test('T04-008 timestamps must be ordered', async () => {
    const t = new Date();
    expect(await ok('consents', F.consent(pid, { created_at: t, granted_at: new Date(t.getTime() - 5000) }))).toBe(false);
    expect(await ok('consents', F.consent(pid, { created_at: t, verified_at: new Date(t.getTime() + 5000) }))).toBe(false);
    expect(await ok('consents', F.consent(pid, { created_at: t, withdrawn_at: new Date(t.getTime() - 5000) }))).toBe(false);
  });
});

describe('G-07 admin_users', () => {
  test('B08-009 only a SUPER_ADMIN can be ACTIVE', async () => {
    expect(await ok('admin_users', F.admin({ role: 'SUPER_ADMIN', status: 'ACTIVE' }))).toBe(true);
    expect(await ok('admin_users', F.admin({ role: 'INSTITUTION_ADMIN', status: 'ACTIVE' }))).toBe(false);
    expect(await ok('admin_users', F.admin({ role: 'RESEARCH_OPERATOR', status: 'ACTIVE' }))).toBe(false);
  });
  test('B08-010 non-super roles are allowed only while not ACTIVE', async () => {
    expect(await ok('admin_users', F.admin({ role: 'INSTITUTION_ADMIN', status: 'INACTIVE' }))).toBe(true);
    const a = await fx.insertRuntime('admin_users', F.admin({ role: 'RESEARCH_OPERATOR', status: 'SUSPENDED' }));
    const db = await H.runtime();
    await H.expectRefused(db.collection('admin_users').updateOne({ _id: a._id }, { $set: { status: 'ACTIVE' } }), 121);
  });
});
