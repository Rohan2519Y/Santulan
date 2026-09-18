const path = require('path');
const request = require('supertest');
const app = require('../../../src/app');
const db = require('../../../src/shared/db');
const { createUserWithToken, getAdminToken } = require('../../helpers/testUser');
const { setAdminBypass } = require('../../../src/shared/utils/rls');

const EMERGING_ADULT_XLSX = path.join(__dirname, '..', '..', '..', '..', 'docs', 'Santulan_EmergingAdult_Items_TECH_READY.xlsx');
const ADOLESCENT_XLSX = path.join(__dirname, '..', '..', '..', '..', 'docs', 'Santulan_Adolescent_Items_TECH_READY.xlsx');

describe('Integration: admin import + participation control (US3)', () => {
  afterAll(async () => {
    await db.pool.end();
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
    const { rows: beforeRows } = await db.query('SELECT * FROM assessment_versions WHERE is_active = true LIMIT 1');
    const before = beforeRows[0];
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

    const { rows: nowActiveRows } = await db.query('SELECT * FROM assessment_versions WHERE is_active = true LIMIT 1');
    const nowActive = nowActiveRows[0];
    expect(nowActive.versionLabel).toBe('santulan-emergingadult-pilot-v1.0');

    const { rows: oldVersionRows } = await db.query('SELECT * FROM assessment_versions WHERE id = $1', [before.id]);
    const oldVersion = oldVersionRows[0];
    expect(oldVersion.isActive).toBe(false);
    expect(oldVersion.status).toBe('RETIRED');

    // The completed attempt's own snapshot (version, responses, scores) is untouched.
    const { rows: attemptRows } = await db.query('SELECT * FROM assessment_attempts WHERE id = $1', [attemptId]);
    const attempt = attemptRows[0];
    expect(attempt.assessmentVersionId).toBe(before.id);
    const responseCount = await db.withTransaction(async (tx) => {
      await setAdminBypass(tx);
      const { rows } = await tx.query('SELECT * FROM responses WHERE attempt_id = $1 AND is_current = true', [attemptId]);
      return rows.length;
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

    const { rows: auditRows } = await db.query(
      'SELECT * FROM participation_controls WHERE actor_id = $1 ORDER BY created_at DESC LIMIT 2',
      [admin.id]
    );
    expect(auditRows.map((r) => r.action)).toEqual(['REOPEN', 'PAUSE']);
    expect(auditRows.every((r) => r.actorId === admin.id && r.createdAt)).toBe(true);
  });
});
