const path = require('path');
const request = require('supertest');
const app = require('../../../src/app');
const db = require('../../../src/shared/db');
const { createUserWithToken, getAdminToken } = require('../../helpers/testUser');

const ADOLESCENT_XLSX = path.join(__dirname, '..', '..', '..', '..', 'docs', 'Santulan_Adolescent_Items_TECH_READY.xlsx');

describe('Contract: admin endpoints', () => {
  afterAll(async () => {
    await db.pool.end();
  });

  test('participant token is forbidden from admin routes', async () => {
    const { token } = await createUserWithToken('participant');
    const res = await request(app).post('/api/v1/admin/assessments/control').set('Authorization', `Bearer ${token}`).send({ action: 'PAUSE' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  test('import: valid xlsx is accepted', async () => {
    const { token } = await getAdminToken();
    const res = await request(app)
      .post('/api/v1/admin/assessments/import')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', ADOLESCENT_XLSX);
    expect(res.status).toBe(201);
    expect(res.body.version.versionLabel).toBe('santulan-adolescent-pilot-v1.0');
    expect(res.body.version.itemCount).toBe(175);
    expect(res.body.version.active).toBe(true);
  });

  test('import: non-xlsx file rejected as INVALID_FILE_TYPE', async () => {
    const { token } = await getAdminToken();
    const res = await request(app)
      .post('/api/v1/admin/assessments/import')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('not an xlsx'), 'not-an-item-pool.txt');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('INVALID_FILE_TYPE');
  });

  test('control: pause/reopen recorded', async () => {
    const { token } = await getAdminToken();
    const paused = await request(app).post('/api/v1/admin/assessments/control').set('Authorization', `Bearer ${token}`).send({ action: 'PAUSE', reason: 'maintenance' });
    expect(paused.status).toBe(201);
    expect(paused.body.control.action).toBe('PAUSE');

    const reopened = await request(app).post('/api/v1/admin/assessments/control').set('Authorization', `Bearer ${token}`).send({ action: 'REOPEN' });
    expect(reopened.status).toBe(201);
  });
});
