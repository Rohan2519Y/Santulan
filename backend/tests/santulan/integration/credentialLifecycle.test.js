/*
 * T069 — institutional roster credential lifecycle over HTTP (AT-03, 04, 05, 08, 09, 27, SEC-17, SEC-29).
 * Commits REAL rows to the scratch database. Exercises the multipart import, the one-time credential export, the
 * temporary-credential login path, set-password activation, credential reset, all-or-nothing commits, the separated
 * login throttle boundary, and pv-based session revocation.
 * Ported to MongoDB (feature 006); the all-or-nothing commit is one transaction over participants, credentials and audit rows.
 */
const request = require('supertest');
const XLSX = require('xlsx');
const app = require('../../../src/app');
const f = require('../helpers/committed');
const H = require('../helpers/mongoHarness');
const { closeClient } = require('../../../src/modules/santulan/store/client');
const { canonical } = require('../../../db/schema');

afterAll(async () => { await closeClient(); await H.closeAll(); });
const col = async (name) => (await f.db()).collection(name);

const HEADER = ['Student\'s Name', 'Gender ', 'Age ', 'Nationality ', 'Current Grade', 'Section/ Course', 'Reg. Number', 'Institution Name', 'City', 'State', 'Institute Govt. ID/UDISE Code'];

function workbook(rows) {
  const aoa = [['Student Personal Details'], HEADER, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

const pupil = ({ name = 'A PUPIL', age = 15, grade = '9th-A', section = '', reg = 'REG-1' } = {}) => [name, 'Male', String(age), 'Indian', grade, section, reg, 'Test School', 'City', 'State', 'UDISE'];

const ROOKIE = [pupil({ name: 'ONE', reg: 'R-101', age: 15 }), pupil({ name: 'TWO', reg: 'R-102', age: 16 }), pupil({ name: 'THREE', reg: 'R-103', age: 18 })];

describe('T069-AT03 roster import + credential lifecycle (SEC-17, SEC-29)', () => {
  let admin;
  let inst;
  let cohort;
  let importId;
  let rows; // [{santulanId, temporaryPassword}] exported exactly once

  beforeAll(async () => {
    admin = await f.admin();
    inst = await f.institution();
    cohort = await f.cohort(inst);
  });

  const upload = (token, buf, mode) => request(app).post('/api/v1/cohorts/import')
    .set('Authorization', `Bearer ${token}`)
    .field('institutionId', inst)
    .field('cohortId', cohort)
    .field('mode', mode)
    .attach('roster', buf, 'roster.xlsx');

  const login = (subject, password) => request(app).post('/api/v1/auth/login').send({ subject, password });
  const exportCredentials = (token, id) => request(app).get(`/api/v1/admin/credentials/export/${id}`).set('Authorization', `Bearer ${token}`);

  describe('validate mode', () => {
    it('AT-08 validation reports the roster without committing anything', async () => {
      const res = await upload(admin.token, workbook(ROOKIE), 'validate');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ mode: 'validate', ok: true, rowCount: 3 });
      expect(res.body.errors).toEqual([]);
      expect(res.body.importId).toBeUndefined();
      expect(await (await col('participants')).countDocuments({ external_student_id: { $in: ['R-101', 'R-102', 'R-103'] }, institution_id: inst })).toBe(0);
    });

    it('SEC-17 institutional login is not behind the OPEN-registration throttle', async () => {
      for (let i = 0; i < 6; i += 1) {
        const res = await login(`unknown-device-${i}`, 'wrong-pass');
        expect(res.status).toBe(401); // authentication fails; the throttle must not 429 the login route
      }
    });
  });

  describe('commit mode', () => {
    it('AT-03 commit creates unique STN participants and one temporary credential each, audited', async () => {
      const res = await upload(admin.token, workbook(ROOKIE), 'commit');
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ mode: 'commit', status: 'COMMITTED', count: 3 });
      expect(res.body.importId).toBeTruthy();
      expect(res.body.credentialsPath).toBe(`/admin/credentials/export/${res.body.importId}`);
      expect(res.body.temporaryPassword).toBeUndefined();
      expect(res.body.rows).toBeUndefined();
      importId = res.body.importId;

      const created = await (await col('participants')).find({ external_student_id: { $in: ['R-101', 'R-102', 'R-103'] }, institution_id: inst }).sort({ external_student_id: 1 }).toArray();
      expect(created).toHaveLength(3);
      const ids = created.map((c) => c.santulan_id);
      expect(new Set(ids).size).toBe(3);
      ids.forEach((id) => expect(id).toMatch(/^STN-[0-9A-HJKMNP-TV-Z]{20}$/));

      const audit = await (await col('audit_logs')).find({ action_type: { $in: ['ROSTER_IMPORTED', 'CREDENTIAL_ISSUED'] }, target_entity: 'participants', target_id: { $in: created.map((c) => c._id) } }).toArray();
      expect(audit).toHaveLength(6);
    });

    it('AT-08/AT-27 the credential export contains IDs + temp passwords once and cannot be downloaded again', async () => {
      const first = await exportCredentials(admin.token, importId);
      expect(first.status).toBe(200);
      expect(first.type).toBe('text/csv');
      const lines = first.text.trim().split('\n');
      expect(lines[0]).toBe('santulan_id,temporary_password');
      expect(lines).toHaveLength(4);
      rows = lines.slice(1).map((l) => { const [santulanId, pw] = l.split(','); return { santulanId, pw }; });
      rows.forEach((r) => expect(r.pw.length).toBeGreaterThanOrEqual(10));

      const second = await exportCredentials(admin.token, importId);
      expect(second.status).toBe(404);
    });

    it('AT-04 temporary login returns mustSetPassword and no session', async () => {
      const res = await login(rows[0].santulanId, rows[0].pw);
      expect(res.status).toBe(200);
      expect(res.body.mustSetPassword).toBe(true);
      expect(typeof res.body.setPasswordToken).toBe('string');
      expect(res.body.accessToken).toBeUndefined();
    });

    let activatedToken;
    it('AT-05 set-password activates the account and invalidates the temporary credential', async () => {
      const first = await login(rows[0].santulanId, rows[0].pw);
      const fixed = 'New-Credential-9Qx';
      const res = await request(app).post('/api/v1/auth/set-password')
        .set('Authorization', `Bearer ${first.body.setPasswordToken}`)
        .send({ newPassword: fixed });
      expect(res.status).toBe(200);
      activatedToken = res.body.accessToken;
      expect(activatedToken).toBeTruthy();

      const tempReuse = await login(rows[0].santulanId, rows[0].pw);
      expect(tempReuse.status).toBe(401); // the temp credential is gone (AT-27 replay rejected)

      const fixedLogin = await login(rows[0].santulanId, fixed);
      expect(fixedLogin.status).toBe(200);
      expect(fixedLogin.body.mustSetPassword).toBeUndefined();
      expect(fixedLogin.body.accessToken).toBeTruthy();

      const state = await request(app).get('/api/v1/registration/state').set('Authorization', `Bearer ${activatedToken}`);
      expect(state.status).toBe(200);

      const tokenReplay = await request(app).post('/api/v1/auth/set-password')
        .set('Authorization', `Bearer ${first.body.setPasswordToken}`)
        .send({ newPassword: 'Replay-Attempt-9' });
      expect(tokenReplay.status).toBe(401);
    });

    it('AT-03 a commit including one ineligible row is all-or-nothing', async () => {
      const bad = workbook([pupil({ name: 'VALID', reg: 'R-201', age: 15 }), pupil({ name: 'TOO YOUNG', reg: 'R-202', age: 12 })]);
      const res = await upload(admin.token, bad, 'commit');
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.errors.some((e) => e.code === 'AGE_INELIGIBLE')).toBe(true);

      expect(await (await col('participants')).countDocuments({ external_student_id: 'R-201', institution_id: inst })).toBe(0);
    });

    it('AT-08 re-importing the same Reg. Number is refused and changes nothing', async () => {
      const res = await upload(admin.token, workbook(ROOKIE), 'commit');
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('ALREADY_IMPORTED');
      expect(await (await col('participants')).countDocuments({ external_student_id: { $in: ['R-101', 'R-102', 'R-103'] }, institution_id: inst })).toBe(3);
    });

    it('AT-09 credential reset issues a new temporary credential and the previous one fails immediately', async () => {
      const target = { participant_id: (await (await col('participants')).findOne({ external_student_id: 'R-101', institution_id: inst }))._id };
      const fixed = 'New-Credential-9Qx';
      const reset = await request(app).post(`/api/v1/admin/participants/${target.participant_id}/credential-reset`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(reset.status).toBe(200);
      expect(reset.body.santulanId).toBe(rows[0].santulanId);
      expect(reset.body.temporaryPassword.length).toBeGreaterThanOrEqual(10);

      const oldSecret = await login(rows[0].santulanId, fixed);
      expect(oldSecret.status).toBe(401); // previous credential (even the personal one) is dead

      const newTemp = await login(rows[0].santulanId, reset.body.temporaryPassword);
      expect(newTemp.status).toBe(200);
      expect(newTemp.body.mustSetPassword).toBe(true);
    });

    it('SEC-29 a token minted before the password reset is rejected (pv revocation)', async () => {
      const state = await request(app).get('/api/v1/registration/state').set('Authorization', `Bearer ${activatedToken}`);
      expect(state.status).toBe(403);
    });

    it('SEC-29 a suspended admin token is rejected', async () => {
      const suspended = await f.admin('SUSPENDED');
      const res = await exportCredentials(suspended.token, 'imp_none');
      expect(res.status).toBe(403);
    });
  });
});