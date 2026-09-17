const path = require('path');
const request = require('supertest');
const app = require('../../../src/app');
const prisma = require('../../../src/shared/prisma');
const { createUserWithToken, getAdminToken } = require('../../helpers/testUser');
const { setAdminBypass } = require('../../../src/shared/utils/rls');

const EMERGING_ADULT_XLSX = path.join(__dirname, '..', '..', '..', '..', 'docs', 'Santulan_EmergingAdult_Items_TECH_READY.xlsx');
const ADOLESCENT_XLSX = path.join(__dirname, '..', '..', '..', '..', 'docs', 'Santulan_Adolescent_Items_TECH_READY.xlsx');

describe('Integration: admin import + participation control (US3)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  test('import flips the active version; a prior completed attempt still renders its original frozen content', async () => {
    const { token: adminToken } = await getAdminToken();
    try {
      await runImportSwitchScenario(adminToken);
    } finally {
      // restore adolescent as active for other test files that assume it, even if an assertion above failed
      await request(app).post('/api/v1/admin/assessments/import').set('Authorization', `Bearer ${adminToken}`).attach('file', ADOLESCENT_XLSX);
    }
  }, 40000);

  async function runImportSwitchScenario(adminToken) {
    // Complete an attempt under whichever version is active BEFORE the import.
    const before = await prisma.assessmentVersion.findFirst({ where: { isActive: true } });
    const { token: participantToken } = await createUserWithToken('participant');
    await request(app).post('/api/v1/assessments/profile').set('Authorization', `Bearer ${participantToken}`).send({ age: 16, participationRoute: 'INSTITUTIONAL' });
    await request(app).post('/api/v1/assessments/consents').set('Authorization', `Bearer ${participantToken}`).send({ consentType: 'PARENT_GUARDIAN_CONSENT', protocolVersion: 'v1', verificationMethod: 'otp' });
    await request(app).post('/api/v1/assessments/consents').set('Authorization', `Bearer ${participantToken}`).send({ consentType: 'STUDENT_ASSENT', protocolVersion: 'v1' });
    const started = await request(app).post('/api/v1/assessments/attempts').set('Authorization', `Bearer ${participantToken}`);
    const attemptId = started.body.attempt.id;
    for (const section of started.body.attempt.sections) {
      for (const item of section.items) {
        // eslint-disable-next-line no-await-in-loop
        await request(app)
          .post(`/api/v1/assessments/attempts/${attemptId}/responses`)
          .set('Authorization', `Bearer ${participantToken}`)
          .send({ itemId: item.id, value: 3, idempotencyKey: `admin-import-${attemptId}-${item.id}` });
      }
    }
    await request(app).post(`/api/v1/assessments/attempts/${attemptId}/submit`).set('Authorization', `Bearer ${participantToken}`);

    // Import the OTHER pool - it becomes the new active version.
    const imported = await request(app)
      .post('/api/v1/admin/assessments/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', EMERGING_ADULT_XLSX);
    expect(imported.status).toBe(201);
    expect(imported.body.version.active).toBe(true);

    const nowActive = await prisma.assessmentVersion.findFirst({ where: { isActive: true } });
    expect(nowActive.versionLabel).toBe('santulan-emergingadult-pilot-v1.0');

    const oldVersion = await prisma.assessmentVersion.findUnique({ where: { id: before.id } });
    expect(oldVersion.isActive).toBe(false);
    expect(oldVersion.status).toBe('RETIRED');

    // The completed attempt's own snapshot (version, responses, scores) is untouched.
    const attempt = await prisma.assessmentAttempt.findUnique({ where: { id: attemptId } });
    expect(attempt.assessmentVersionId).toBe(before.id);
    const responseCount = await prisma.$transaction(async (tx) => {
      await setAdminBypass(tx);
      return tx.response.count({ where: { attemptId, isCurrent: true } });
    });
    expect(responseCount).toBeGreaterThan(0);
    const scoresRes = await request(app).get(`/api/v1/assessments/attempts/${attemptId}/scores`).set('Authorization', `Bearer ${participantToken}`);
    expect(scoresRes.status).toBe(200);
    expect(scoresRes.body.scores).toHaveLength(7);
  }

  test('PAUSE then REOPEN appear in the audit log with actor + timestamp', async () => {
    const { token: adminToken, user: admin } = await getAdminToken();
    const paused = await request(app).post('/api/v1/admin/assessments/control').set('Authorization', `Bearer ${adminToken}`).send({ action: 'PAUSE', reason: 'test' });
    expect(paused.status).toBe(201);

    const { token: participantToken } = await createUserWithToken('participant');
    await request(app).post('/api/v1/assessments/profile').set('Authorization', `Bearer ${participantToken}`).send({ age: 16, participationRoute: 'OPEN' });
    await request(app).post('/api/v1/assessments/consents').set('Authorization', `Bearer ${participantToken}`).send({ consentType: 'PARENT_GUARDIAN_CONSENT', protocolVersion: 'v1', verificationMethod: 'otp' });
    await request(app).post('/api/v1/assessments/consents').set('Authorization', `Bearer ${participantToken}`).send({ consentType: 'STUDENT_ASSENT', protocolVersion: 'v1' });
    const blocked = await request(app).post('/api/v1/assessments/attempts').set('Authorization', `Bearer ${participantToken}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('ATTEMPT_UNAVAILABLE');

    const reopened = await request(app).post('/api/v1/admin/assessments/control').set('Authorization', `Bearer ${adminToken}`).send({ action: 'REOPEN' });
    expect(reopened.status).toBe(201);

    const allowed = await request(app).post('/api/v1/assessments/attempts').set('Authorization', `Bearer ${participantToken}`);
    expect(allowed.status).toBe(201);

    const auditRows = await prisma.participationControl.findMany({ where: { actorId: admin.id }, orderBy: { createdAt: 'desc' }, take: 2 });
    expect(auditRows.map((r) => r.action)).toEqual(['REOPEN', 'PAUSE']);
    expect(auditRows.every((r) => r.actorId === admin.id && r.createdAt)).toBe(true);
  });
});
