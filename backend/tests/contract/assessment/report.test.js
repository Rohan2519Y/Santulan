const request = require('supertest');
const app = require('../../../src/app');
const prisma = require('../../../src/shared/prisma');
const { createUserWithToken, getAdminToken } = require('../../helpers/testUser');

async function makeConsentCompleteMinor(age = 16) {
  const { token } = await createUserWithToken('participant');
  await request(app).post('/api/v1/assessments/profile').set('Authorization', `Bearer ${token}`).send({ age, participationRoute: 'OPEN' });
  await request(app).post('/api/v1/assessments/consents').set('Authorization', `Bearer ${token}`).send({ consentType: 'PARENT_GUARDIAN_CONSENT', protocolVersion: 'v1', verificationMethod: 'otp' });
  await request(app).post('/api/v1/assessments/consents').set('Authorization', `Bearer ${token}`).send({ consentType: 'STUDENT_ASSENT', protocolVersion: 'v1' });
  return token;
}

async function completeAttempt(token) {
  const started = await request(app).post('/api/v1/assessments/attempts').set('Authorization', `Bearer ${token}`);
  const attemptId = started.body.attempt.id;
  for (const section of started.body.attempt.sections) {
    for (const item of section.items) {
      // eslint-disable-next-line no-await-in-loop
      await request(app)
        .post(`/api/v1/assessments/attempts/${attemptId}/responses`)
        .set('Authorization', `Bearer ${token}`)
        .send({ itemId: item.id, value: 4, idempotencyKey: `report-${attemptId}-${item.id}` });
    }
  }
  const submitted = await request(app).post(`/api/v1/assessments/attempts/${attemptId}/submit`).set('Authorization', `Bearer ${token}`);
  return { attemptId, reportId: submitted.body.report.id };
}

describe('Contract: report + admin-results endpoints', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  test('GET report: 404 before ready, 200 with released sections only after submit', async () => {
    const token = await makeConsentCompleteMinor();
    const started = await request(app).post('/api/v1/assessments/attempts').set('Authorization', `Bearer ${token}`);
    const attemptId = started.body.attempt.id;

    const notReady = await request(app).get('/api/v1/assessments/reports/does-not-exist-yet').set('Authorization', `Bearer ${token}`);
    expect(notReady.status).toBe(404);
    expect(notReady.body.error.code).toBe('REPORT_NOT_READY');

    for (const section of started.body.attempt.sections) {
      for (const item of section.items) {
        // eslint-disable-next-line no-await-in-loop
        await request(app)
          .post(`/api/v1/assessments/attempts/${attemptId}/responses`)
          .set('Authorization', `Bearer ${token}`)
          .send({ itemId: item.id, value: 4, idempotencyKey: `c-${attemptId}-${item.id}` });
      }
    }
    const submitted = await request(app).post(`/api/v1/assessments/attempts/${attemptId}/submit`).set('Authorization', `Bearer ${token}`);
    const reportId = submitted.body.report.id;

    const ready = await request(app).get(`/api/v1/assessments/reports/${reportId}`).set('Authorization', `Bearer ${token}`);
    expect(ready.status).toBe(200);
    expect(ready.body.releasedSections.length).toBe(7); // 7 T01_DOMAIN_RESULT sections, T05_PRIORITIES withheld
    expect(ready.body.releasedSections.every((s) => s.sectionType === 'T01_DOMAIN_RESULT')).toBe(true);
  }, 30000);

  test('retry: 409 when report is already REPORT_READY', async () => {
    const token = await makeConsentCompleteMinor(17);
    const { reportId } = await completeAttempt(token);
    const retry = await request(app).post(`/api/v1/assessments/reports/${reportId}/retry`).set('Authorization', `Bearer ${token}`);
    expect(retry.status).toBe(409);
    expect(retry.body.error.code).toBe('REPORT_RETRY_NOT_ALLOWED');
  }, 30000);

  test('admin: submissions list + detail', async () => {
    const token = await makeConsentCompleteMinor(15);
    const { attemptId } = await completeAttempt(token);
    const { token: adminToken } = await getAdminToken();

    const list = await request(app).get('/api/v1/admin/assessments/submissions').set('Authorization', `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.submissions.some((s) => s.attemptId === attemptId)).toBe(true);

    const detail = await request(app).get(`/api/v1/admin/assessments/submissions/${attemptId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.scores).toHaveLength(7);
  }, 30000);

  test('admin: quality-flag disposition review', async () => {
    const token = await makeConsentCompleteMinor(16);
    const { attemptId } = await completeAttempt(token);
    const flag = await prisma.qualityFlag.create({ data: { attemptId, flagCode: 'Q01', severity: 'review' } });
    const { token: adminToken } = await getAdminToken();

    const patched = await request(app)
      .patch(`/api/v1/admin/assessments/quality-flags/${flag.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ disposition: 'reviewed, no action needed' });
    expect(patched.status).toBe(200);
    expect(patched.body.qualityFlag.disposition).toBe('reviewed, no action needed');
  }, 30000);
});
