/*
 * HTTP contract tests for the dev identity adapter (D-17): OTP sign-in for OPEN participants, Santulan ID + temporary
 * password for institutional participants, forced set-password, credential reset (AT-27), and no secrets at rest.
 */
const request = require('supertest');
const app = require('../../../src/app');
const db = require('../../../src/shared/db');
const f = require('../helpers/committed');
const { getProvider } = require('../../../src/modules/santulan/identity');
const { createDevProvider } = require('../../../src/modules/santulan/identity/devProvider');

const api = () => request(app);
const key = () => `idem-${f.u()}-${f.u()}`;
const provider = getProvider();

afterAll(async () => { await db.pool.end(); });

async function institutionalParticipant() {
  const adm = await f.admin();
  const inst = await f.institution(); const co = await f.cohort(inst);
  const res = await api().post('/api/v1/registrations/institutional').set('Authorization', `Bearer ${adm.token}`).set('Idempotency-Key', key())
    .send({ age: 16, institutionId: inst, cohortId: co, externalStudentId: `AUTH-${f.u()}` });
  expect(res.status).toBe(201);
  return { adm, ...res.body };
}

describe('institutional sign-in: temporary password then forced change (AT-27)', () => {
  test('registration issues a one-time temporary password; login is gated until a permanent password is set', async () => {
    const p = await institutionalParticipant();
    expect(p.temporaryPassword).toEqual(expect.any(String));

    const bad = await api().post('/api/v1/auth/login').send({ subject: p.santulanId, password: 'wrong-password-1' });
    expect(bad.status).toBe(401);
    const unknown = await api().post('/api/v1/auth/login').send({ subject: 'STN-00000000000000000000', password: 'wrong-password-1' });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.message).toBe(bad.body.error.message);   // no account enumeration

    const login = await api().post('/api/v1/auth/login').send({ subject: p.santulanId, password: p.temporaryPassword });
    expect(login.status).toBe(200);
    expect(login.body).toMatchObject({ mustSetPassword: true });
    expect(login.body.accessToken).toBeUndefined();                    // no session until the password is changed

    // the set-password token is not a session
    const asSession = await api().get('/api/v1/registration/state').set('Authorization', `Bearer ${login.body.setPasswordToken}`);
    expect(asSession.status).toBe(401);

    const weak = await api().post('/api/v1/auth/set-password').set('Authorization', `Bearer ${login.body.setPasswordToken}`).send({ newPassword: 'short1' });
    expect(weak.status).toBe(400);

    const set = await api().post('/api/v1/auth/set-password').set('Authorization', `Bearer ${login.body.setPasswordToken}`).send({ newPassword: 'Permanent-pass-42' });
    expect(set.status).toBe(200);
    const state = await api().get('/api/v1/registration/state').set('Authorization', `Bearer ${set.body.accessToken}`);
    expect(state.status).toBe(200);

    // the temporary credential is dead; the token cannot be replayed; the new password works without a forced change
    expect((await api().post('/api/v1/auth/login').send({ subject: p.santulanId, password: p.temporaryPassword })).status).toBe(401);
    expect((await api().post('/api/v1/auth/set-password').set('Authorization', `Bearer ${login.body.setPasswordToken}`).send({ newPassword: 'Another-pass-43' })).status).toBe(401);
    const again = await api().post('/api/v1/auth/login').send({ subject: p.santulanId, password: 'Permanent-pass-42' });
    expect(again.status).toBe(200);
    expect(again.body.accessToken).toEqual(expect.any(String));
  });

  test('a replayed registration does not return the temporary password again', async () => {
    const adm = await f.admin(); const inst = await f.institution(); const co = await f.cohort(inst);
    const k = key(); const body = { age: 20, institutionId: inst, cohortId: co, externalStudentId: `RP-${f.u()}` };
    const post = () => api().post('/api/v1/registrations/institutional').set('Authorization', `Bearer ${adm.token}`).set('Idempotency-Key', k).send(body);
    const first = await post(); const replay = await post();
    expect(first.status).toBe(201); expect(replay.status).toBe(200);
    expect(replay.body.santulanId).toBe(first.body.santulanId);
    expect(replay.body.temporaryPassword).toBeUndefined();
  });

  test('credential reset: SUPER_ADMIN only, previous secret invalid at once, audited without the secret', async () => {
    const p = await institutionalParticipant();
    const set = async (pw) => {
      const l = await api().post('/api/v1/auth/login').send({ subject: p.santulanId, password: pw });
      return api().post('/api/v1/auth/set-password').set('Authorization', `Bearer ${l.body.setPasswordToken}`).send({ newPassword: 'Permanent-pass-42' });
    };
    expect((await set(p.temporaryPassword)).status).toBe(200);

    const pid = (await f.query('SELECT participant_id FROM santulan.participants WHERE santulan_id = $1', [p.santulanId]))[0].participant_id;
    const url = `/api/v1/admin/participants/${pid}/credential-reset`;
    expect((await api().post(url)).status).toBe(401);
    expect((await api().post(url).set('Authorization', `Bearer ${f.participantToken(pid)}`)).status).toBe(403);
    expect((await api().post(url).set('Authorization', `Bearer ${(await f.admin('ACTIVE', 'INSTITUTION_ADMIN')).token}`)).status).toBe(403);

    const reset = await api().post(url).set('Authorization', `Bearer ${p.adm.token}`);
    expect(reset.status).toBe(200);
    expect(reset.body.santulanId).toBe(p.santulanId);
    expect((await api().post('/api/v1/auth/login').send({ subject: p.santulanId, password: 'Permanent-pass-42' })).status).toBe(401);
    expect((await api().post('/api/v1/auth/login').send({ subject: p.santulanId, password: reset.body.temporaryPassword })).body.mustSetPassword).toBe(true);

    const audits = await f.query(`SELECT new_state::text AS s FROM santulan.audit_logs WHERE action_type = 'CREDENTIAL_RESET' AND target_id = $1`, [pid]);
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toContain(reset.body.temporaryPassword);
    expect((await api().post(`/api/v1/admin/participants/00000000-0000-4000-8000-000000000000/credential-reset`).set('Authorization', `Bearer ${p.adm.token}`)).status).toBe(404);
  });

  test('a suspended participant cannot sign in even with the right password', async () => {
    const p = await institutionalParticipant();
    await f.query(`UPDATE santulan.participants SET status = 'SUSPENDED' WHERE santulan_id = $1`, [p.santulanId]);
    expect((await api().post('/api/v1/auth/login').send({ subject: p.santulanId, password: p.temporaryPassword })).status).toBe(401);
  });

  test('no password or hash is stored in the canonical schema; the credential store is bcrypt only', async () => {
    const p = await institutionalParticipant();
    const canonical = await f.query(`SELECT count(*)::int AS n FROM santulan.participants WHERE row_to_json(participants)::text LIKE '%' || $1 || '%'`, [p.temporaryPassword]);
    expect(canonical[0].n).toBe(0);
    const stored = await f.query(`SELECT secret_hash FROM dev_identity.credentials ORDER BY created_at DESC LIMIT 1`);
    expect(stored[0].secret_hash).toMatch(/^\$2[aby]\$/);
    const cols = await f.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'santulan' AND column_name ~* '(password|otp|secret)'`);
    expect(cols).toEqual([]);
  });
});

describe('OTP sign-in for OPEN participants', () => {
  test('request → verify → age declaration → session; the same identity later signs straight in; codes are single use', async () => {
    const identity = `otp-${f.u()}@example.test`;
    const req1 = await api().post('/api/v1/auth/request-otp').send({ channel: 'email', identity });
    expect(req1.status).toBe(202);
    expect(JSON.stringify(req1.body)).not.toMatch(/[0-9]{6}/);       // the code is never in the response

    expect((await api().post('/api/v1/auth/verify-otp').send({ channel: 'email', identity, code: '000000' })).status).toBe(401);
    // the dev provider is in-process, so the test can request through it to read the code without a mailer
    const { _code } = provider.requestOtp('email', identity);
    const ok = await api().post('/api/v1/auth/verify-otp').send({ channel: 'email', identity: identity.toUpperCase(), code: _code });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ registered: false });
    expect((await api().post('/api/v1/auth/verify-otp').send({ channel: 'email', identity, code: _code })).status).toBe(401);   // replay

    const reg = await api().post('/api/v1/participants/age-declaration').set('Authorization', `Bearer ${ok.body.registrationToken}`).set('Idempotency-Key', key()).send({ age: 19 });
    expect(reg.status).toBe(201);
    expect(reg.body.accessToken).toEqual(expect.any(String));

    const again = provider.requestOtp('email', identity);
    const back = await api().post('/api/v1/auth/verify-otp').send({ channel: 'email', identity, code: again._code });
    expect(back.body.registered).toBe(true);
    expect(back.body.accessToken).toEqual(expect.any(String));
  });

  test('bad shapes are 400 and unknown keys are rejected', async () => {
    expect((await api().post('/api/v1/auth/request-otp').send({ channel: 'fax', identity: 'x@y.z' })).status).toBe(400);
    expect((await api().post('/api/v1/auth/verify-otp').send({ channel: 'email', identity: 'a@b.c', code: '12' })).status).toBe(400);
    expect((await api().post('/api/v1/auth/login').send({ subject: 'a', password: 'b', admin: true })).status).toBe(400);
  });
});

describe('dev provider unit behaviour (no HTTP)', () => {
  const makeProvider = (over = {}) => createDevProvider({ db: { query: async () => ({ rows: [], rowCount: 0 }) }, ...over });

  test('codes expire, are attempt-limited, and requests are rate-limited per identity', () => {
    let t = 1_000_000;
    const p = makeProvider({ now: () => t, otpTtlMs: 1000, otpMaxAttempts: 3, otpMaxRequestsPerHour: 3 });
    const a = p.requestOtp('mobile', '+91 98765 43210');
    t += 1001;
    expect(p.verifyOtp('mobile', '+919876543210', a._code).ok).toBe(false);        // expired (and identity normalised)

    const b = p.requestOtp('mobile', '+919876543210');
    for (let i = 0; i < 3; i += 1) expect(p.verifyOtp('mobile', '+919876543210', '999999').ok).toBe(false);
    expect(p.verifyOtp('mobile', '+919876543210', b._code).ok).toBe(false);         // locked out after too many attempts

    expect(p.requestOtp('mobile', '+919876543210').rateLimited).toBe(false);
    expect(p.requestOtp('mobile', '+919876543210').rateLimited).toBe(true);         // 4th request within the hour
  });

  test('password policy', () => {
    expect(makeProvider().passwordProblem('short1')).toBeTruthy();
    expect(makeProvider().passwordProblem('onlyletterspassword')).toBeTruthy();
    expect(makeProvider().passwordProblem('Long-enough-pass-1')).toBeNull();
  });
});
