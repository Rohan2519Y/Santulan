const request = require('supertest');
const app = require('../../../src/app');
const db = require('../../../src/shared/db');
const { createUserWithToken } = require('../../helpers/testUser');
const { setParticipantScope } = require('../../../src/shared/utils/rls');

async function makeConsentCompleteMinor(age = 16) {
  const { token, user } = await createUserWithToken('participant');
  await request(app).post('/api/v1/assessments/profile').set('Authorization', `Bearer ${token}`).send({ age, participationRoute: 'OPEN' });
  await request(app).post('/api/v1/assessments/consents').set('Authorization', `Bearer ${token}`).send({ consentType: 'PARENT_GUARDIAN_CONSENT', protocolVersion: 'v1', verificationMethod: 'otp' });
  await request(app).post('/api/v1/assessments/consents').set('Authorization', `Bearer ${token}`).send({ consentType: 'STUDENT_ASSENT', protocolVersion: 'v1' });
  const { profile } = (await request(app).get('/api/v1/assessments/profile').set('Authorization', `Bearer ${token}`)).body;
  return { token, user, profile };
}

describe('T053: responses row-level security actually isolates participants at the DB layer', () => {
  afterAll(async () => {
    await db.pool.end();
  });

  test('a connection scoped to participant A cannot read participant B\'s responses, even with a direct query', async () => {
    const a = await makeConsentCompleteMinor(16);
    const b = await makeConsentCompleteMinor(15);

    const startedA = await request(app).post('/api/v1/assessments/attempts').set('Authorization', `Bearer ${a.token}`);
    const itemA = startedA.body.attempt.sections[0].items[0];
    await request(app)
      .post(`/api/v1/assessments/attempts/${startedA.body.attempt.id}/responses`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ itemId: itemA.id, value: 3, idempotencyKey: `iso-a-${startedA.body.attempt.id}` });

    const startedB = await request(app).post('/api/v1/assessments/attempts').set('Authorization', `Bearer ${b.token}`);
    const itemB = startedB.body.attempt.sections[0].items[0];
    await request(app)
      .post(`/api/v1/assessments/attempts/${startedB.body.attempt.id}/responses`)
      .set('Authorization', `Bearer ${b.token}`)
      .send({ itemId: itemB.id, value: 5, idempotencyKey: `iso-b-${startedB.body.attempt.id}` });

    // Scope the connection to A and try to read ALL responses directly - B's row must not appear.
    const visibleToA = await db.withTransaction(async (tx) => {
      await setParticipantScope(tx, a.profile.id);
      const { rows } = await tx.query('SELECT * FROM responses');
      return rows;
    });
    expect(visibleToA.length).toBeGreaterThan(0);
    expect(visibleToA.every((r) => r.participantProfileId === a.profile.id)).toBe(true);

    // No scope at all (GUC unset) - fails closed to zero rows, not "everything".
    const visibleToNoOne = await db.withTransaction(async (tx) => {
      const { rows } = await tx.query('SELECT * FROM responses');
      return rows;
    });
    expect(visibleToNoOne).toHaveLength(0);
  });
});
