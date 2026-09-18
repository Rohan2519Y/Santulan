const request = require('supertest');
const app = require('../../../src/app');
const db = require('../../../src/shared/db');
const { createUserWithToken } = require('../../helpers/testUser');

describe('Contract: participant assessment endpoints', () => {
  afterAll(async () => {
    await db.pool.end();
  });

  test('profile: 404 before declaration, then declare + fetch', async () => {
    const { token } = await createUserWithToken('participant');

    const before = await request(app).get('/api/v1/assessments/profile').set('Authorization', `Bearer ${token}`);
    expect(before.status).toBe(404);
    expect(before.body.error.code).toBe('PROFILE_NOT_DECLARED');

    const declared = await request(app)
      .post('/api/v1/assessments/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ age: 15, participationRoute: 'OPEN' });
    expect(declared.status).toBe(201);
    expect(declared.body.profile).toMatchObject({ ageBand: 'D2', isMinor: true, context: 'GENERAL', route: 'OPEN' });

    const after = await request(app).get('/api/v1/assessments/profile').set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(200);
    expect(after.body.profile.id).toBe(declared.body.profile.id);
  });

  test('consents: 403 on attempt start until the minor gate is met', async () => {
    const { token } = await createUserWithToken('participant');
    await request(app)
      .post('/api/v1/assessments/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ age: 15, participationRoute: 'OPEN' });

    const blocked = await request(app).post('/api/v1/assessments/attempts').set('Authorization', `Bearer ${token}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('CONSENT_INCOMPLETE');

    const parentConsent = await request(app)
      .post('/api/v1/assessments/consents')
      .set('Authorization', `Bearer ${token}`)
      .send({ consentType: 'PARENT_GUARDIAN_CONSENT', protocolVersion: 'v1', verificationMethod: 'otp-to-parent-contact' });
    expect(parentConsent.status).toBe(201);
    expect(parentConsent.body.consent.status).toBe('VERIFIED');

    const assent = await request(app)
      .post('/api/v1/assessments/consents')
      .set('Authorization', `Bearer ${token}`)
      .send({ consentType: 'STUDENT_ASSENT', protocolVersion: 'v1' });
    expect(assent.status).toBe(201);

    const started = await request(app).post('/api/v1/assessments/attempts').set('Authorization', `Bearer ${token}`);
    expect(started.status).toBe(201);
    expect(started.body.attempt.status).toBe('IN_PROGRESS');
    expect(started.body.attempt.scale).toEqual({ points: 5, anchors: { 1: 'Almost never', 2: 'Rarely', 3: 'Sometimes', 4: 'Often', 5: 'Almost always' } });
    expect(started.body.attempt.sections.length).toBeGreaterThan(0);
  });

  test('responses: save, edit (new version), reject after submit', async () => {
    const { token } = await createUserWithToken('participant');
    await request(app).post('/api/v1/assessments/profile').set('Authorization', `Bearer ${token}`).send({ age: 20, participationRoute: 'OPEN' });
    // age 20 -> D3/emerging-adult tool band, but seeded active version is adolescent;
    // use an adolescent-band participant instead for a real eligible-items flow
    const { token: adoToken } = await createUserWithToken('participant');
    await request(app).post('/api/v1/assessments/profile').set('Authorization', `Bearer ${adoToken}`).send({ age: 16, participationRoute: 'OPEN' });
    await request(app).post('/api/v1/assessments/consents').set('Authorization', `Bearer ${adoToken}`).send({ consentType: 'PARENT_GUARDIAN_CONSENT', protocolVersion: 'v1', verificationMethod: 'otp' });
    await request(app).post('/api/v1/assessments/consents').set('Authorization', `Bearer ${adoToken}`).send({ consentType: 'STUDENT_ASSENT', protocolVersion: 'v1' });

    const started = await request(app).post('/api/v1/assessments/attempts').set('Authorization', `Bearer ${adoToken}`);
    const attemptId = started.body.attempt.id;
    const itemId = started.body.attempt.sections[0].items[0].id;

    const saved = await request(app)
      .post(`/api/v1/assessments/attempts/${attemptId}/responses`)
      .set('Authorization', `Bearer ${adoToken}`)
      .send({ itemId, value: 3, idempotencyKey: `k1-${attemptId}` });
    expect(saved.status).toBe(201);
    expect(saved.body.response).toMatchObject({ itemId, value: 3, responseVersion: 1, isCurrent: true });

    const edited = await request(app)
      .post(`/api/v1/assessments/attempts/${attemptId}/responses`)
      .set('Authorization', `Bearer ${adoToken}`)
      .send({ itemId, value: 5, idempotencyKey: `k2-${attemptId}` });
    expect(edited.status).toBe(201);
    expect(edited.body.response).toMatchObject({ itemId, value: 5, responseVersion: 2, isCurrent: true });

    const replay = await request(app)
      .post(`/api/v1/assessments/attempts/${attemptId}/responses`)
      .set('Authorization', `Bearer ${adoToken}`)
      .send({ itemId, value: 5, idempotencyKey: `k2-${attemptId}` });
    expect(replay.status).toBe(201);
    expect(replay.body.response.responseVersion).toBe(2); // same key => original row returned, no 3rd version

    const submitted = await request(app).post(`/api/v1/assessments/attempts/${attemptId}/submit`).set('Authorization', `Bearer ${adoToken}`);
    expect(submitted.status).toBe(200);
    expect(submitted.body.attempt.status).toBe('REPORT_READY');
    expect(submitted.body.report.generationStatus).toBe('REPORT_READY');

    const rejected = await request(app)
      .post(`/api/v1/assessments/attempts/${attemptId}/responses`)
      .set('Authorization', `Bearer ${adoToken}`)
      .send({ itemId, value: 4, idempotencyKey: `k3-${attemptId}` });
    expect(rejected.status).toBe(422);
    expect(rejected.body.error.code).toBe('INVALID_STATE');

    const scores = await request(app).get(`/api/v1/assessments/attempts/${attemptId}/scores`).set('Authorization', `Bearer ${adoToken}`);
    expect(scores.status).toBe(200);
    expect(scores.body.scores.length).toBe(7);
  });
});
