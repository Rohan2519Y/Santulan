/*
 * OPEN-registration abuse controls (T154; SEC-13, SEC-14, SEC-16, SEC-17, SEC-18, AT-32): the registration throttle protects the
 * OPEN flows per IP and per device and is a separate control from the OTP flow's throttle; institutional sign-in and roster
 * import are never throttled; a legitimate registration is not locked out; and a throttled request has no side effects.
 *
 * The limits are configuration values read at startup, so the small limits for these tests are set BEFORE the app is required.
 */
process.env.REGISTRATION_THROTTLE_WINDOW_SECONDS = '3600';
process.env.REGISTRATION_THROTTLE_MAX_PER_IP = '6';
process.env.REGISTRATION_THROTTLE_MAX_PER_DEVICE = '100000';

const request = require('supertest');
const app = require('../../../src/app');
const f = require('../helpers/committed');
const H = require('../helpers/mongoHarness');
const store = require('../../../src/models/db');
const { getProvider } = require('../../../src/services/identity');

const provider = getProvider();
const api = () => request(app);
let db;

let admin;
const createdIds = [];
const t0 = Date.now();

beforeAll(async () => {
  db = await H.admin();
  admin = await f.admin();
});

afterAll(async () => {
  await f.cleanupFixtures();
  if (createdIds.length) await db.collection('participants').deleteMany({ _id: { $in: createdIds } });
  await store.closeClient();
  await H.closeAll();
});

/** Counts participants this file created via the OPEN flows (synthetic, captured ids + those born since t0 without the FX prefix). */
async function recruitCount() {
  return db.collection('participants').countDocuments({ created_at: { $gte: new Date(t0) }, santulan_id: /^STN-/ });
}

describe('the per-IP registration throttle protects the OPEN flows (SEC-13, SEC-14, SEC-17, SEC-18, AT-32)', () => {
  test('SEC-14 a normal registration is not locked out while the flow is under its limits', async () => {
    const identity = `otp-${f.u()}@example.test`;
    const req1 = await api().post('/api/v1/auth/request-otp').send({ channel: 'email', identity });
    expect(req1.status).toBe(202);
    const { _code } = provider.requestOtp('email', identity);
    const ok = await api().post('/api/v1/auth/verify-otp').send({ channel: 'email', identity, code: _code });
    expect(ok.status).toBe(200);
    expect(ok.body.registered).toBe(false);
    const res = await api().post('/api/v1/participants/age-declaration')
      .set('Authorization', `Bearer ${ok.body.registrationToken}`)
      .set('Idempotency-Key', `abuse-sec14-${f.u()}-${f.u()}`)
      .send({ age: 15, language: 'en' });
    expect(res.status).toBe(201);
    if (res.body.participantId) createdIds.push(res.body.participantId);
  });

  test('SEC-13 rapid repeat registrations from one IP are throttled after the configured limit', async () => {
    const statuses = [];
    for (let i = 0; i < 5; i += 1) statuses.push((await api().post('/api/v1/registrations/open').send({})).status);
    expect(statuses).toEqual([400, 400, 400, 400, 400]); // inside the limit: validated, rejected for missing fields
    const blocked = await api().post('/api/v1/registrations/open').send({});
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('TOO_MANY_REQUESTS');
    expect(String(blocked.headers['retry-after'])).toBe(String(3600));
  });

  test('SEC-18 the OTP flow throttle is a distinct control: it is unaffected when the registration throttle is exhausted', async () => {
    const otp = await api().post('/api/v1/auth/request-otp').send({});
    expect(otp.status).not.toBe(429); // its own instance still has headroom
    const shared = await api().post('/api/v1/participants/age-declaration').send({ age: 16, language: 'en' });
    expect(shared.status).toBe(429); // registration throttle is shared across OPEN registration + age declaration
  });

  test('SEC-17 /auth/login and /cohorts/import are never subject to the OPEN-registration throttle', async () => {
    const login = await api().post('/api/v1/auth/login').send({ subject: 'nobody', password: 'wrong' });
    expect(login.status).not.toBe(429);
    expect([400, 401].includes(login.status)).toBe(true);
    const roster = await api().post('/api/v1/cohorts/import').set({ Authorization: `Bearer ${admin.token}` }).send({});
    expect(roster.status).not.toBe(429);
  });

  test('AT-32 a throttled registration completes nothing: no participant is created by the blocked request', async () => {
    const before = await recruitCount();
    const blocked = await api().post('/api/v1/registrations/open').send({ age: 15, language: 'en' });
    expect(blocked.status).toBe(429);
    expect(await recruitCount()).toBe(before);
  });
});

describe('the per-device registration throttle, configured independently (SEC-16)', () => {
  let app2;
  let store2;
  beforeAll(() => {
    jest.resetModules();
    process.env.REGISTRATION_THROTTLE_WINDOW_SECONDS = '60';
    process.env.REGISTRATION_THROTTLE_MAX_PER_IP = '1000';
    process.env.REGISTRATION_THROTTLE_MAX_PER_DEVICE = '3';
    // eslint-disable-next-line global-require
    app2 = require('../../../src/app');
    // eslint-disable-next-line global-require
    store2 = require('../../../src/models/db');
  });

  afterAll(() => {
    process.env.REGISTRATION_THROTTLE_WINDOW_SECONDS = '3600';
    process.env.REGISTRATION_THROTTLE_MAX_PER_IP = '6';
    process.env.REGISTRATION_THROTTLE_MAX_PER_DEVICE = '100000';
    return store2.closeClient().catch(() => {});
  });

  test('SEC-16 one device is throttled after its own limit while other devices on the same IP are not', async () => {
    const sameDevice = request.agent(app2);
    const otherDevice = request.agent(app2);
    const statuses = [];
    for (let i = 0; i < 3; i += 1) statuses.push((await sameDevice.post('/api/v1/participants/age-declaration').send({})).status);
    expect(statuses).toEqual([400, 400, 400]);
    expect((await sameDevice.post('/api/v1/participants/age-declaration').send({})).status).toBe(429);
    const fresh = await otherDevice.post('/api/v1/participants/age-declaration').send({});
    expect(fresh.status).toBe(400); // a different device on the same IP is not hit by the device cap
  });
});