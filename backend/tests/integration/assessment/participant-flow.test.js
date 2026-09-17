const request = require('supertest');
const app = require('../../../src/app');
const prisma = require('../../../src/shared/prisma');
const { createUserWithToken } = require('../../helpers/testUser');

async function makeConsentCompleteMinor(age = 16) {
  const { token } = await createUserWithToken('participant');
  await request(app).post('/api/v1/assessments/profile').set('Authorization', `Bearer ${token}`).send({ age, participationRoute: 'INSTITUTIONAL' });
  await request(app)
    .post('/api/v1/assessments/consents')
    .set('Authorization', `Bearer ${token}`)
    .send({ consentType: 'PARENT_GUARDIAN_CONSENT', protocolVersion: 'v1', verificationMethod: 'otp' });
  await request(app).post('/api/v1/assessments/consents').set('Authorization', `Bearer ${token}`).send({ consentType: 'STUDENT_ASSENT', protocolVersion: 'v1' });
  return token;
}

describe('Integration: full participant journey (US1)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  test('start -> answer every eligible item -> submit -> 7 domain scores within seconds', async () => {
    const token = await makeConsentCompleteMinor(16);

    const started = await request(app).post('/api/v1/assessments/attempts').set('Authorization', `Bearer ${token}`);
    expect(started.status).toBe(201);
    const { id: attemptId, sections } = started.body.attempt;

    const totalItems = sections.reduce((sum, s) => sum + s.items.length, 0);
    expect(totalItems).toBeGreaterThan(0);

    const c7 = sections.find((s) => s.domainCode === 'C7');
    expect(c7.items.length).toBe(59); // research.md §6 A07: SCHOOL-eligible adolescent C7 = 58 General + 1 School

    let key = 0;
    for (const section of sections) {
      for (const item of section.items) {
        key += 1;
        // eslint-disable-next-line no-await-in-loop
        const res = await request(app)
          .post(`/api/v1/assessments/attempts/${attemptId}/responses`)
          .set('Authorization', `Bearer ${token}`)
          .send({ itemId: item.id, value: (key % 5) + 1, idempotencyKey: `int-${attemptId}-${key}` });
        expect(res.status).toBe(201);
      }
    }

    const start = Date.now();
    const submitted = await request(app).post(`/api/v1/assessments/attempts/${attemptId}/submit`).set('Authorization', `Bearer ${token}`);
    const elapsedMs = Date.now() - start;

    expect(submitted.status).toBe(200);
    expect(submitted.body.attempt.status).toBe('REPORT_READY');
    expect(elapsedMs).toBeLessThan(10000); // SC-001

    const scoresRes = await request(app).get(`/api/v1/assessments/attempts/${attemptId}/scores`).set('Authorization', `Bearer ${token}`);
    expect(scoresRes.status).toBe(200);
    expect(scoresRes.body.scores).toHaveLength(7);
    for (const score of scoresRes.body.scores) {
      expect(score.completenessRate).toBe(1);
      if (score.scoreStatus === 'SH') {
        expect(score.rawScore).toBeNull(); // C4 held construct - never an operational score
      } else {
        expect(score.rawScore).toBeGreaterThanOrEqual(1);
        expect(score.rawScore).toBeLessThanOrEqual(5);
        expect(score.scoreStatus).toBe('S2'); // 100% complete => the best pilot-era reportable state
      }
    }
  }, 40000);

  test('a second attempt-create while one is active returns the SAME attempt (FR-006)', async () => {
    const token = await makeConsentCompleteMinor(15);
    const first = await request(app).post('/api/v1/assessments/attempts').set('Authorization', `Bearer ${token}`);
    const second = await request(app).post('/api/v1/assessments/attempts').set('Authorization', `Bearer ${token}`);
    expect(second.body.attempt.id).toBe(first.body.attempt.id);
  });
});
