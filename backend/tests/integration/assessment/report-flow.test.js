const { randomUUID } = require('crypto');
const request = require('supertest');
const app = require('../../../src/app');
const db = require('../../../src/shared/db');
const { createUserWithToken } = require('../../helpers/testUser');

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
        .send({ itemId: item.id, value: 2, idempotencyKey: `flow-${attemptId}-${item.id}` });
    }
  }
  const submitted = await request(app).post(`/api/v1/assessments/attempts/${attemptId}/submit`).set('Authorization', `Bearer ${token}`);
  return { attemptId, reportId: submitted.body.report.id };
}

describe('Integration: report assembly + release gating (US4)', () => {
  afterAll(async () => {
    await db.pool.end();
  });

  test('held construct (C4, SH) produces no operational rawScore in the report or scores view', async () => {
    const token = await makeConsentCompleteMinor(16);
    const { attemptId, reportId } = await completeAttempt(token);

    const scores = await request(app).get(`/api/v1/assessments/attempts/${attemptId}/scores`).set('Authorization', `Bearer ${token}`);
    const c4 = scores.body.scores.find((s) => s.domainCode === 'C4');
    expect(c4.scoreStatus).toBe('SH');
    expect(c4.rawScore).toBeNull();

    const report = await request(app).get(`/api/v1/assessments/reports/${reportId}`).set('Authorization', `Bearer ${token}`);
    const c4Section = report.body.releasedSections.find((s) => s.domainCode === 'C4');
    expect(c4Section.content.rawScore).toBeNull();
    expect(c4Section.content.scoreStatus).toBe('SH');
  }, 30000);

  test('release flag flip reveals the prescriptive section without redeploy (FR-018)', async () => {
    const token = await makeConsentCompleteMinor(15);
    const { reportId } = await completeAttempt(token);

    const before = await request(app).get(`/api/v1/assessments/reports/${reportId}`).set('Authorization', `Bearer ${token}`);
    expect(before.body.releasedSections.some((s) => s.sectionType === 'T05_PRIORITIES')).toBe(false);

    await db.query("UPDATE report_sections SET is_released_to_participant = true WHERE report_id = $1 AND section_type = 'T05_PRIORITIES'", [reportId]);

    const after = await request(app).get(`/api/v1/assessments/reports/${reportId}`).set('Authorization', `Bearer ${token}`);
    expect(after.body.releasedSections.some((s) => s.sectionType === 'T05_PRIORITIES')).toBe(true);
  }, 30000);

  test('retry from FAILED_RETRYABLE regenerates identical content from frozen inputs (FR-011, SC-003)', async () => {
    const token = await makeConsentCompleteMinor(17);
    const { reportId } = await completeAttempt(token);

    const { rows: originalSections } = await db.query('SELECT * FROM report_sections WHERE report_id = $1 ORDER BY display_order ASC', [reportId]);
    await db.query("UPDATE reports SET generation_status = 'FAILED_RETRYABLE' WHERE id = $1", [reportId]);

    const retried = await request(app).post(`/api/v1/assessments/reports/${reportId}/retry`).set('Authorization', `Bearer ${token}`);
    expect(retried.status).toBe(200);
    expect(retried.body.report.generationStatus).toBe('REPORT_READY');
    expect(retried.body.report.retryCount).toBe(1);

    const { rows: regeneratedSections } = await db.query('SELECT * FROM report_sections WHERE report_id = $1 ORDER BY display_order ASC', [reportId]);
    expect(regeneratedSections.map((s) => s.contentSnapshot)).toEqual(originalSections.map((s) => s.contentSnapshot));
  }, 30000);

  test('a QUALITY_HOLD attempt (Q09) shows only the single neutral message, never scored', async () => {
    const token = await makeConsentCompleteMinor(16);
    const started = await request(app).post('/api/v1/assessments/attempts').set('Authorization', `Bearer ${token}`);
    const attemptId = started.body.attempt.id;
    await db.query('INSERT INTO quality_flags (id, attempt_id, flag_code, severity) VALUES ($1, $2, $3, $4)', [
      randomUUID(),
      attemptId,
      'Q09',
      'critical',
    ]);

    const submitted = await request(app).post(`/api/v1/assessments/attempts/${attemptId}/submit`).set('Authorization', `Bearer ${token}`);
    expect(submitted.status).toBe(200);
    expect(submitted.body.attempt.status).toBe('QUALITY_HOLD');

    const { rows: scoreRows } = await db.query('SELECT * FROM score_results WHERE attempt_id = $1', [attemptId]);
    expect(scoreRows.length).toBe(0); // never scored (FR-014)

    const report = await request(app).get(`/api/v1/assessments/reports/${submitted.body.report.id}`).set('Authorization', `Bearer ${token}`);
    expect(report.body.releasedSections).toHaveLength(1);
    expect(report.body.releasedSections[0].sectionType).toBe('T11_HOLD_NEUTRAL');
  });
});
