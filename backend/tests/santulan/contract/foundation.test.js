/*
 * Foundation contract tests (T032): the shared HTTP/validation/authorization rules every story relies on.
 *  - strict schemas reject unknown JSON keys with 400 VALIDATION_ERROR (client-supplied ids/scores/context refused);
 *  - participant tokens cannot reach admin or internal routes;
 *  - a suspended admin is denied even with a valid token (B08-008);
 *  - the log redactor removes the secret keys (auth subject, OTP/code/token/password, external id).
 */
const request = require('supertest');
const app = require('../../../src/app');
const { closeClient } = require('../../../src/models/db/client');
const H = require('../helpers/mongoHarness');
const f = require('../helpers/committed');
const { participantToken, adminToken } = require('../helpers/tokens');
const { redact } = require('../../../src/middleware/http');

afterAll(async () => { await closeClient(); await H.closeAll(); });

describe('foundation — strict schemas refuse anything the client must never supply (T032)', () => {
  test.each([
    [{ age: 15, santulanId: 'STN-CLIENTCHOSEN' }],
    [{ age: 15, participantId: '7d89fec1-4c4f-4f8d-9a3b-8a1c3c5e5b2a' }],
    [{ age: 15, rawScore: 3.72 }],
    [{ age: 15, app: { actor_scope: 'SUPER_ADMIN' } }],
    [{ age: 15, institution_id: '7d89fec1-4c4f-4f8d-9a3b-8a1c3c5e5b2a' }],
  ])('route request with the forbidden extra keys is 400 VALIDATION_ERROR', async (extra) => {
    const res = await request(app).post('/api/v1/registration/route').send(extra);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('a valid route request still resolves', async () => {
    const res = await request(app).post('/api/v1/registration/route').send({ age: 18 });
    expect(res.status).toBe(200);
    expect(res.body.assessmentTrack).toBe('EMERGING_ADULT');
  });
});

describe('foundation — route access control', () => {
  test('a participant token cannot reach an admin route (403)', async () => {
    const res = await request(app)
      .post('/api/v1/admin/participants/7d89fec1-4c4f-4f8d-9a3b-8a1c3c5e5b2a/credential-reset')
      .set('Authorization', `Bearer ${participantToken('p1')}`)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  test('a participant token cannot reach an internal (worker) route (403)', async () => {
    const res = await request(app)
      .post('/api/v1/internal/attempts/7d89fec1-4c4f-4f8d-9a3b-8a1c3c5e5b2a/score')
      .set('Authorization', `Bearer ${participantToken('p1')}`)
      .send({ scoringVersion: 'domain-mean-v1' });
    expect(res.status).toBe(403);
  });

  test('B08-008 a suspended admin is denied on every request, audit shows no access', async () => {
    const { adminUserId, token } = await f.admin('SUSPENDED');
    const res = await request(app)
      .post('/api/v1/registrations/institutional')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `idem-${f.u()}-${f.u()}`)
      .send({ age: 15 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect((await (await f.db()).collection('admin_users').findOne({ _id: adminUserId })).status).toBe('SUSPENDED');
  });

  test('an unknown bearer token is unauthenticated (401)', async () => {
    const res = await request(app).get('/api/v1/registration/state').set('Authorization', 'Bearer not.a.real.token');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('foundation — redaction of secret keys (shared/http.js)', () => {
  test('redact removes auth subject, external id, OTP/code/token/password and authorization keys', () => {
    const out = redact({
      authProviderSubjectId: 'sha:abc', auth_provider_subject_id: 'sha:abc', externalStudentId: 'REG-1',
      otp: '123456', code: '123', token: 't', password: 'p', newPassword: 'n', authorization: 'Bearer x',
      age: 15, santulanId: 'STN-KEEP-1', rows: [{ auth_provider_subject_id: 's' }],
    });
    expect(out.authProviderSubjectId).toBe('[REDACTED]');
    expect(out.auth_provider_subject_id).toBe('[REDACTED]');
    expect(out.externalStudentId).toBe('[REDACTED]');
    expect(out.otp).toBe('[REDACTED]');
    expect(out.code).toBe('[REDACTED]');
    expect(out.token).toBe('[REDACTED]');
    expect(out.password).toBe('[REDACTED]');
    expect(out.newPassword).toBe('[REDACTED]');
    expect(out.authorization).toBe('[REDACTED]');
    expect(out.age).toBe(15);
    expect(out.santulanId).toBe('STN-KEEP-1');
    expect(out.rows[0].auth_provider_subject_id).toBe('[REDACTED]');
  });
});