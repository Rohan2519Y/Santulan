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

describe('Integration: pause/resume preserves progress (US2)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  test('answer some -> pause -> resume preserves saved answers, only unanswered remain', async () => {
    const token = await makeConsentCompleteMinor();
    const started = await request(app).post('/api/v1/assessments/attempts').set('Authorization', `Bearer ${token}`);
    const attemptId = started.body.attempt.id;
    const items = started.body.attempt.sections[0].items;

    await request(app)
      .post(`/api/v1/assessments/attempts/${attemptId}/responses`)
      .set('Authorization', `Bearer ${token}`)
      .send({ itemId: items[0].id, value: 4, idempotencyKey: `resume-${attemptId}-1` });

    await request(app).post(`/api/v1/assessments/attempts/${attemptId}/pause`).set('Authorization', `Bearer ${token}`);

    const resumed = await request(app).post(`/api/v1/assessments/attempts/${attemptId}/resume`).set('Authorization', `Bearer ${token}`);
    expect(resumed.status).toBe(200);
    expect(resumed.body.attempt.sessionCount).toBe(2);
    expect(resumed.body.attempt.savedAnswers).toEqual([{ itemId: items[0].id, value: 4, isCurrent: true }]);
    expect(resumed.body.attempt.progress.completed).toBe(1);

    const unansweredIds = resumed.body.attempt.sections.flatMap((s) => s.items.map((i) => i.id)).filter((id) => id !== items[0].id);
    expect(unansweredIds.length).toBe(resumed.body.attempt.progress.total - 1);
  });

  test('a second POST /attempts while active returns the existing attempt, not a new one', async () => {
    const token = await makeConsentCompleteMinor(17);
    const first = await request(app).post('/api/v1/assessments/attempts').set('Authorization', `Bearer ${token}`);
    const second = await request(app).post('/api/v1/assessments/attempts').set('Authorization', `Bearer ${token}`);
    expect(second.body.attempt.id).toBe(first.body.attempt.id);
    expect(second.body.attempt.sessionCount).toBe(1); // no new session opened just by re-POSTing while live
  });
});
