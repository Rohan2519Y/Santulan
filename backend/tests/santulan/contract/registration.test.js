/*
 * HTTP contract tests for registration (T03-*, contracts/api.md section 2), on MongoDB. They run against the SCRATCH database
 * through the real app, the runtime credential and the scoped access layer.
 */
const request = require('supertest');
const app = require('../../../src/app');
const { closeClient } = require('../../../src/modules/santulan/store/client');
const f = require('../helpers/committed');
const H = require('../helpers/mongoHarness');
const { SANTULAN_ID_PATTERN } = require('../../../src/modules/santulan/registration/santulanId');

const key = () => `idem-${f.u()}-${f.u()}`;
const open = (body, k = key()) => request(app).post('/api/v1/registrations/open').set('Idempotency-Key', k).send(body);
const stored = async (santulanId) => (await f.db()).collection('participants').findOne({ santulan_id: santulanId });

afterAll(async () => { await closeClient(); await H.closeAll(); });

describe('registration - validation and routing (T03-001..006, T03-014, T03-016)', () => {
  test.each([12, 26])('T03-001/006 age %i is refused with 422 AGE_INELIGIBLE and nothing is created', async (age) => {
    const before = await (await f.db()).collection('participants').countDocuments({});
    const res = await open({ age });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('AGE_INELIGIBLE');
    expect(await (await f.db()).collection('participants').countDocuments({})).toBe(before);
  });

  test.each([
    [13, 'ADOLESCENT', true, ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT']],
    [17, 'ADOLESCENT', true, ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT']],
    [18, 'EMERGING_ADULT', false, ['ADULT_SELF_CONSENT']],
    [25, 'EMERGING_ADULT', false, ['ADULT_SELF_CONSENT']],
  ])('T03-002..005 age %i registers as %s (minor=%s) and returns the required consents, never an attempt', async (age, track, minor, consents) => {
    const res = await open({ age, language: 'en' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ santulanId: expect.stringMatching(SANTULAN_ID_PATTERN), participationRoute: 'OPEN', assessmentTrack: track, isMinor: minor, requiredConsents: consents });
    // the response never claims consent or eligibility to start, and exposes no internal identifiers
    expect(Object.keys(res.body).sort()).toEqual(['assessmentTrack', 'isMinor', 'participationRoute', 'requiredConsents', 'santulanId']);
    const p = await stored(res.body.santulanId);
    expect([p.institution_id, p.cohort_id, p.external_student_id]).toEqual([null, null, null]);
    const db = await f.db();
    expect(await db.collection('assessment_attempts').countDocuments({ participant_id: p._id })).toBe(0); // RC-04, T03-016
    expect(await db.collection('consents').countDocuments({ participant_id: p._id })).toBe(0);
  });

  test('T03-014 a client-supplied santulanId (or any unknown key) is rejected', async () => {
    for (const extra of [{ santulanId: 'STN-CLIENTCHOSEN' }, { participantId: '1' }, { score: 5 }, { app: { actor_scope: 'SUPER_ADMIN' } }]) {
      const res = await open({ age: 15, ...extra });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  test('POST /registration/route resolves the route and creates nothing', async () => {
    const db = await f.db();
    const before = await db.collection('participants').countDocuments({});
    const res = await request(app).post('/api/v1/registration/route').send({ age: 18 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ eligible: true, assessmentTrack: 'EMERGING_ADULT', isMinor: false, requiredConsents: ['ADULT_SELF_CONSENT'] });
    expect(await db.collection('participants').countDocuments({})).toBe(before);
    expect((await request(app).post('/api/v1/registration/route').send({ age: 12 })).status).toBe(422);
  });
});

describe('registration - idempotency (T03-022, T03-023)', () => {
  test('same key + same payload replays (200, same participant); different payload is 409; one participant only', async () => {
    const k = key();
    const first = await open({ age: 15, language: 'en' }, k);
    expect(first.status).toBe(201);
    const replay = await open({ language: 'en', age: 15 }, k); // key order must not matter
    expect(replay.status).toBe(200);
    expect(replay.body.santulanId).toBe(first.body.santulanId);
    const conflict = await open({ age: 16 }, k);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(await (await f.db()).collection('participants').countDocuments({ santulan_id: first.body.santulanId })).toBe(1);
  });

  test('concurrent requests with the same key create exactly one participant', async () => {
    const k = key();
    const results = await Promise.all([1, 2, 3, 4].map(() => open({ age: 20 }, k)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 201]);
    expect(new Set(results.map((r) => r.body.santulanId)).size).toBe(1);
    expect(await (await f.db()).collection('participants').countDocuments({ santulan_id: results[0].body.santulanId })).toBe(1);
  });

  test.each([[undefined], ['short'], ['x'.repeat(129)]])('an Idempotency-Key of invalid length (%s) is a 400', async (k) => {
    const req = request(app).post('/api/v1/registrations/open');
    if (k !== undefined) req.set('Idempotency-Key', k);
    const res = await req.send({ age: 15 });
    expect(res.status).toBe(400);
  });

  test('T03-024 the audit trail stores only a payload hash - no key, subject id or personal data', async () => {
    const res = await open({ age: 19 });
    const p = await stored(res.body.santulanId);
    const rows = await (await f.db()).collection('audit_logs').find({ target_id: p._id }).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].action_type).toBe('REGISTRATION_CREATED');
    expect(Object.keys(rows[0].new_state).sort()).toEqual(['payload_hash', 'request_correlation_id', 'route', 'track']);
    expect(rows[0].correlation_id).toMatch(/^idem:[0-9a-f]{64}$/);
  });
});

describe('institutional registration (T03-008..013, T03-025, T03-027)', () => {
  test('requires an ACTIVE SUPER_ADMIN: no token 401, participant token 403, suspended admin 403, institution admin 403', async () => {
    const inst = await f.institution();
    const co = await f.cohort(inst);
    const post = (token) => {
      const r = request(app).post('/api/v1/registrations/institutional').set('Idempotency-Key', key());
      if (token) r.set('Authorization', `Bearer ${token}`);
      return r.send({ age: 15, institutionId: inst, cohortId: co });
    };
    expect((await post(null)).status).toBe(401);
    const p = await open({ age: 15 });
    const row = await stored(p.body.santulanId);
    expect((await post(f.participantToken(row._id))).status).toBe(403);
    expect((await post((await f.admin('SUSPENDED')).token)).status).toBe(403); // B08-008
    expect((await post((await f.admin('INACTIVE', 'INSTITUTION_ADMIN')).token)).status).toBe(403); // reserved role
    expect((await post((await f.admin()).token)).status).toBe(201);
  });

  test('valid institution + cohort registers INSTITUTIONAL; inactive/mismatched scope is 422; external id unique per institution', async () => {
    const adm = await f.admin();
    const inst = await f.institution(); const co = await f.cohort(inst);
    const other = await f.institution(); const otherCo = await f.cohort(other);
    const post = (body, k = key()) => request(app).post('/api/v1/registrations/institutional').set('Authorization', `Bearer ${adm.token}`).set('Idempotency-Key', k).send(body);

    const ok = await post({ age: 14, institutionId: inst, cohortId: co, externalStudentId: 'REG-1' });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ participationRoute: 'INSTITUTIONAL', assessmentTrack: 'ADOLESCENT', isMinor: true });
    const s = await stored(ok.body.santulanId);
    expect({ institution_id: s.institution_id, cohort_id: s.cohort_id, external_student_id: s.external_student_id }).toEqual({ institution_id: inst, cohort_id: co, external_student_id: 'REG-1' });

    expect((await post({ age: 14, institutionId: inst, cohortId: otherCo })).status).toBe(422); // T03-009 cohort of another institution
    expect((await post({ age: 14, institutionId: await f.institution('INACTIVE'), cohortId: co })).body.error.code).toBe('SCOPE_INVALID');
    const inactiveCohort = await f.cohort(inst, 'INACTIVE');
    expect((await post({ age: 14, institutionId: inst, cohortId: inactiveCohort })).body.error.code).toBe('SCOPE_INVALID');
    const dup = await post({ age: 15, institutionId: inst, cohortId: co, externalStudentId: 'REG-1' }); // T03-012
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_IDENTITY');
    expect((await post({ age: 15, institutionId: other, cohortId: otherCo, externalStudentId: 'REG-1' })).status).toBe(201); // T03-013
    expect((await post({ age: 12, institutionId: inst, cohortId: co })).status).toBe(422);
    expect((await post({ age: 15, institutionId: 'not-a-uuid', cohortId: co })).status).toBe(400);
  });
});

describe('OTP-verified age declaration and registration state (T03-011, T03-026)', () => {
  test('the auth pair comes from the purpose token, binds once, and a second binding is a 409; the session token reads only its own state', async () => {
    const subject = `sub-${f.u()}`;
    const t1 = f.purposeToken('age-declaration', { authProvider: 'santulan-dev-otp', authProviderSubjectId: subject });
    const post = (token, k = key()) => request(app).post('/api/v1/participants/age-declaration').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', k).send({ age: 16 });

    const res = await post(t1);
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    const bound = await stored(res.body.santulanId);
    expect({ auth_provider: bound.auth_provider, auth_provider_subject_id: bound.auth_provider_subject_id }).toEqual({ auth_provider: 'santulan-dev-otp', auth_provider_subject_id: subject });
    const second = await post(f.purposeToken('age-declaration', { authProvider: 'santulan-dev-otp', authProviderSubjectId: subject }));
    expect(second.status).toBe(409); // T03-011
    expect(second.body.error.code).toBe('DUPLICATE_IDENTITY');
    expect((await post('not-a-token')).status).toBe(401);
    expect((await post(f.participantToken('11111111-1111-1111-1111-111111111111'))).status).toBe(401); // a normal session is not a registration token

    const state = await request(app).get('/api/v1/registration/state').set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(state.status).toBe(200);
    expect(state.body).toEqual({ santulanId: res.body.santulanId, participationRoute: 'OPEN', assessmentTrack: 'ADOLESCENT', isMinor: true, requiredConsents: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'], attempt: null });
    expect(JSON.stringify(state.body)).not.toContain(subject);
    expect((await request(app).get('/api/v1/registration/state')).status).toBe(401);
  });
});

describe('platform behaviour', () => {
  test('unknown route is a JSON 404; malformed JSON is a 400; every response carries a correlation id', async () => {
    const nf = await request(app).get('/api/v1/nope');
    expect(nf.status).toBe(404);
    const bad = await request(app).post('/api/v1/registration/route').set('Content-Type', 'application/json').send('{"age":');
    expect(bad.status).toBe(400);
    const ok = await request(app).post('/api/v1/registration/route').set('X-Correlation-Id', 'abcdef123456').send({ age: 15 });
    expect(ok.headers['x-correlation-id']).toBe('abcdef123456');
    expect((await request(app).post('/api/v1/registration/route').send({ age: 15 })).headers['x-correlation-id']).toBeTruthy();
  });

  test('tokens with a purpose are not sessions', async () => {
    const res = await request(app).get('/api/v1/registration/state').set('Authorization', `Bearer ${f.purposeToken('set-password', {})}`);
    expect(res.status).toBe(401);
  });

  test('B08-060 the store health endpoint reports ok and never leaks a reason', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ store: 'ok' });
  });
});
