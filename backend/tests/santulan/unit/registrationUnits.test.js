const { resolveAgeRoute } = require('../../../src/modules/santulan/registration/routing');
const { generateSantulanId, SANTULAN_ID_PATTERN } = require('../../../src/modules/santulan/registration/santulanId');
const { createRegistrationThrottle, MemoryThrottleStore } = require('../../../src/modules/santulan/security/throttle');
const { payloadHash } = require('../../../src/modules/santulan/shared/idempotency');
const { redact } = require('../../../src/modules/santulan/shared/http');

describe('age routing (T03-001…006, AT-B00-01/02/03)', () => {
  test.each([12, 26, 0, 99, -1])('T03-001/006 age %i is ineligible', (age) => {
    expect(resolveAgeRoute(age)).toMatchObject({ eligible: false, assessmentTrack: null, requiredConsents: [] });
  });
  test.each([13, 15, 17])('T03-002/003 age %i routes to ADOLESCENT, minor, parent consent + student assent', (age) => {
    expect(resolveAgeRoute(age)).toEqual({
      eligible: true, assessmentTrack: 'ADOLESCENT', isMinor: true, versionLabel: 'santulan-adolescent-pilot-v3.1',
      requiredConsents: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'],
    });
  });
  test.each([18, 21, 25])('T03-004/005 age %i routes to EMERGING_ADULT, adult, self-consent only', (age) => {
    expect(resolveAgeRoute(age)).toEqual({
      eligible: true, assessmentTrack: 'EMERGING_ADULT', isMinor: false, versionLabel: 'santulan-emergingadult-pilot-v3.1',
      requiredConsents: ['ADULT_SELF_CONSENT'],
    });
  });
  test('age 18 is never ADOLESCENT and a non-integer age is ineligible', () => {
    expect(resolveAgeRoute(18).assessmentTrack).not.toBe('ADOLESCENT');
    expect(resolveAgeRoute(17.5).eligible).toBe(false);
    expect(resolveAgeRoute('15').eligible).toBe(false);
  });
});

describe('Santulan ID (T03-014/015)', () => {
  test('format STN- + 20 Crockford Base32 characters; 20,000 ids are unique and carry no ambiguous letters', () => {
    const ids = new Set();
    for (let i = 0; i < 20000; i += 1) {
      const id = generateSantulanId();
      expect(id).toMatch(SANTULAN_ID_PATTERN);
      expect(id.slice(4)).not.toMatch(/[ILOU]/);
      ids.add(id);
    }
    expect(ids.size).toBe(20000);
  });
});

describe('registration throttle (AT-32, SEC-13/14/16/18)', () => {
  const run = (mw, { ip = '1.1.1.1', cookie } = {}) => {
    const req = { ip, headers: cookie ? { cookie } : {} };
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, append(k, v) { this.headers[k] = v; } };
    let error = null;
    mw(req, res, (e) => { error = e || null; });
    return { error, res };
  };

  test('per-IP limit blocks the (n+1)th request from one IP even across different devices', () => {
    const mw = createRegistrationThrottle({ windowSeconds: 60, maxPerIp: 3, maxPerDevice: 100 }, new MemoryThrottleStore());
    for (let i = 0; i < 3; i += 1) expect(run(mw, { cookie: `sn_device=${'a'.repeat(16)}${i}` }).error).toBeNull();
    const blocked = run(mw, { cookie: `sn_device=${'b'.repeat(20)}` });
    expect(blocked.error).toMatchObject({ status: 429, code: 'TOO_MANY_REQUESTS' });
    expect(blocked.res.headers['Retry-After']).toBe('60');
  });

  test('per-device limit blocks one device across different IPs', () => {
    const mw = createRegistrationThrottle({ windowSeconds: 60, maxPerIp: 100, maxPerDevice: 2 }, new MemoryThrottleStore());
    const cookie = `sn_device=${'c'.repeat(20)}`;
    expect(run(mw, { ip: '2.2.2.1', cookie }).error).toBeNull();
    expect(run(mw, { ip: '2.2.2.2', cookie }).error).toBeNull();
    expect(run(mw, { ip: '2.2.2.3', cookie }).error).toMatchObject({ status: 429 });
  });

  test('a normal registration is not locked out and a device cookie is issued', () => {
    const mw = createRegistrationThrottle({ windowSeconds: 60, maxPerIp: 20, maxPerDevice: 10 }, new MemoryThrottleStore());
    const { error, res } = run(mw, { ip: '3.3.3.3' });
    expect(error).toBeNull();
    expect(res.headers['Set-Cookie']).toMatch(/^sn_device=.+HttpOnly/);
  });

  test('the window slides: hits older than the window do not count', () => {
    const store = new MemoryThrottleStore();
    expect(store.hit('k', 1000, 0)).toBe(1);
    expect(store.hit('k', 1000, 500)).toBe(2);
    expect(store.hit('k', 1000, 1600)).toBe(1);
  });
});

describe('idempotency payload hash and log redaction (T03-022/023/024)', () => {
  test('the hash ignores key order and differs when any value differs', () => {
    expect(payloadHash({ a: 1, b: { x: 1, y: 2 } })).toBe(payloadHash({ b: { y: 2, x: 1 }, a: 1 }));
    expect(payloadHash({ age: 15 })).not.toBe(payloadHash({ age: 16 }));
  });
  test('redact hides auth subjects, external ids, OTPs, tokens, passwords', () => {
    expect(redact({ authProviderSubjectId: 's', external_student_id: 'e', otp: '123456', token: 't', password: 'p', keep: 1, nested: { code: 'c', ok: true } }))
      .toEqual({ authProviderSubjectId: '[REDACTED]', external_student_id: '[REDACTED]', otp: '[REDACTED]', token: '[REDACTED]', password: '[REDACTED]', keep: 1, nested: { code: '[REDACTED]', ok: true } });
  });
});
