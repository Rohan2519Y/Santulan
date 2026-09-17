const request = require('supertest');
const app = require('../../../src/app');
const prisma = require('../../../src/shared/prisma');
const { createUserWithToken } = require('../../helpers/testUser');

async function makeConsentCompleteMinor(age = 16) {
  const { token } = await createUserWithToken('participant');
  await request(app).post('/api/v1/assessments/profile').set('Authorization', `Bearer ${token}`).send({ age, participationRoute: 'OPEN' });
  await request(app).post('/api/v1/assessments/consents').set('Authorization', `Bearer ${token}`).send({ consentType: 'PARENT_GUARDIAN_CONSENT', protocolVersion: 'v1', verificationMethod: 'otp' });
  await request(app).post('/api/v1/assessments/consents').set('Authorization', `Bearer ${token}`).send({ consentType: 'STUDENT_ASSENT', protocolVersion: 'v1' });
  return token;
}

describe('Contract: attempt session endpoints + states', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  test('pause -> resume cycle, 5th session rejected with SESSION_LIMIT, invalid transitions rejected', async () => {
    const token = await makeConsentCompleteMinor();
    const started = await request(app).post('/api/v1/assessments/attempts').set('Authorization', `Bearer ${token}`);
    const attemptId = started.body.attempt.id;
    expect(started.body.attempt.sessionCount).toBe(1);

    // double-pause is an invalid transition (already paused after 1st pause)
    const pause1 = await request(app).post(`/api/v1/assessments/attempts/${attemptId}/pause`).set('Authorization', `Bearer ${token}`);
    expect(pause1.status).toBe(200);
    expect(pause1.body.attempt.status).toBe('PAUSED');

    const pause2 = await request(app).post(`/api/v1/assessments/attempts/${attemptId}/pause`).set('Authorization', `Bearer ${token}`);
    expect(pause2.status).toBe(422);
    expect(pause2.body.error.code).toBe('INVALID_STATE');

    // sessions 2, 3, 4 via resume+pause
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const resumed = await request(app).post(`/api/v1/assessments/attempts/${attemptId}/resume`).set('Authorization', `Bearer ${token}`);
      expect(resumed.status).toBe(200);
      expect(resumed.body.attempt.sessionCount).toBe(2 + i);
      // eslint-disable-next-line no-await-in-loop
      await request(app).post(`/api/v1/assessments/attempts/${attemptId}/pause`).set('Authorization', `Bearer ${token}`);
    }

    // now sessionCount = 4; a 5th resume must be rejected
    const fifth = await request(app).post(`/api/v1/assessments/attempts/${attemptId}/resume`).set('Authorization', `Bearer ${token}`);
    expect(fifth.status).toBe(409);
    expect(fifth.body.error.code).toBe('SESSION_LIMIT');
  });
});
