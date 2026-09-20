/*
 * HTTP contract tests for consent, assent and the verification gate (BUILD 04: T04-027, 028, 031, 032, 035 and the
 * service rules of §10-§13). Approved protocols come from a TEST fixture (identifiers and method codes only).
 */
const request = require('supertest');
const app = require('../../../src/app');
const db = require('../../../src/shared/db');
const config = require('../../../src/config');
const f = require('../helpers/committed');
const { setWithdrawalHook, defaultHook } = require('../../../src/modules/santulan/consent/withdrawalHook');

const api = () => request(app);
const PROTO = 'TEST-PROTOCOL-1';
const INTERNAL = { 'X-Internal-Api-Key': 'test-internal-key' };
const key = () => `idem-${f.u()}-${f.u()}`;

afterAll(async () => { await db.pool.end(); });

async function participant(age) {
  const res = await api().post('/api/v1/registrations/open').set('Idempotency-Key', key()).send({ age });
  expect(res.status).toBe(201);
  const pid = (await f.query('SELECT participant_id FROM santulan.participants WHERE santulan_id = $1', [res.body.santulanId]))[0].participant_id;
  return { pid, token: f.participantToken(pid) };
}
const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const create = (body, headers = INTERNAL) => api().post('/api/v1/consents').set(headers).send({ protocolVersion: PROTO, ...body });
const gate = (p) => api().get('/api/v1/consents/gate').set(bearer(p.token));
const verify = (id, verificationMethod = 'TEST_METHOD_A', headers = INTERNAL) => api().post(`/api/v1/consents/${id}/verify`).set(headers).send({ verificationMethod });

describe('requirements and gate are derived from the stored age (T04-001…004, 027)', () => {
  test('a minor needs parent consent and student assent; an adult needs self-consent only; nothing is created', async () => {
    const minor = await participant(15); const adult = await participant(21);
    const m = await api().get('/api/v1/consents/requirements').set(bearer(minor.token));
    expect(m.body).toMatchObject({ isMinor: true, requiredTypes: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'], consents: [] });
    const a = await api().get('/api/v1/consents/requirements').set(bearer(adult.token));
    expect(a.body).toMatchObject({ isMinor: false, requiredTypes: ['ADULT_SELF_CONSENT'], consents: [] });
    expect((await gate(minor)).body).toEqual({ open: false, missingTypes: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'] });
    expect((await gate(adult)).body).toEqual({ open: false, missingTypes: ['ADULT_SELF_CONSENT'] });
    expect((await api().get('/api/v1/consents/gate')).status).toBe(401);
  });
});

describe('minor: both records VERIFIED open the gate, and the gate never creates an attempt (T04-018…022)', () => {
  test('full lifecycle with authorisation at every step', async () => {
    const p = await participant(16);
    const parent = (await create({ participantId: p.pid, consentType: 'PARENT_GUARDIAN_CONSENT', giverRelationship: 'PARENT' })).body;
    const assent = (await create({ participantId: p.pid, consentType: 'STUDENT_ASSENT', giverRelationship: 'SELF' })).body;
    expect([parent.status, assent.status]).toEqual(['PENDING', 'PENDING']);

    // T04-031: a participant token cannot create or verify
    expect((await create({ participantId: p.pid, consentType: 'STUDENT_ASSENT', giverRelationship: 'SELF' }, bearer(p.token))).status).toBe(403);
    expect((await verify(assent.consentId, 'TEST_METHOD_A', bearer(p.token))).status).toBe(403);
    expect((await verify(assent.consentId, 'TEST_METHOD_A', {})).status).toBe(401);
    expect((await verify(assent.consentId, 'TEST_METHOD_A', { 'X-Internal-Api-Key': 'wrong' })).status).toBe(403);

    // PENDING -> VERIFIED is refused; the row stays PENDING
    const skip = await verify(assent.consentId);
    expect(skip.status).toBe(409);
    expect(skip.body.error.code).toBe('CONSENT_TRANSITION_INVALID');

    // the participant grants their own assent but not the parent's consent
    const ownGrant = await api().post(`/api/v1/consents/${assent.consentId}/grant`).set(bearer(p.token)).send({});
    expect(ownGrant.status).toBe(200);
    expect(ownGrant.body.status).toBe('GRANTED');
    expect((await api().post(`/api/v1/consents/${parent.consentId}/grant`).set(bearer(p.token)).send({})).status).toBe(403);
    expect((await api().post(`/api/v1/consents/${assent.consentId}/grant`).set(bearer(p.token)).send({})).status).toBe(409);   // no double grant
    expect((await api().post(`/api/v1/consents/${parent.consentId}/grant`).set(INTERNAL).send({})).status).toBe(200);

    expect((await verify(assent.consentId)).body.status).toBe('VERIFIED');
    expect((await gate(p)).body).toEqual({ open: false, missingTypes: ['PARENT_GUARDIAN_CONSENT'] });       // assent alone is not enough
    expect((await verify(parent.consentId)).status).toBe(200);
    expect((await gate(p)).body).toEqual({ open: true, missingTypes: [] });

    const attempts = await f.query('SELECT count(*)::int AS n FROM santulan.assessment_attempts WHERE participant_id = $1', [p.pid]);
    expect(attempts[0].n).toBe(0);                                                                            // consent is necessary, not sufficient
    const stored = await f.query('SELECT status, verification_method FROM santulan.consents WHERE participant_id = $1 ORDER BY consent_type', [p.pid]);
    expect(stored).toEqual([{ status: 'VERIFIED', verification_method: 'TEST_METHOD_A' }, { status: 'VERIFIED', verification_method: 'TEST_METHOD_A' }]);
  });

  test('an adult needs only self-consent, granted then verified', async () => {
    const p = await participant(22);
    const c = (await create({ participantId: p.pid, consentType: 'ADULT_SELF_CONSENT', giverRelationship: 'SELF' })).body;
    await api().post(`/api/v1/consents/${c.consentId}/grant`).set(bearer(p.token)).send({});
    expect((await gate(p)).body.open).toBe(false);                                                            // GRANTED is not VERIFIED
    expect((await verify(c.consentId, 'TEST_METHOD_B')).status).toBe(200);
    expect((await gate(p)).body).toEqual({ open: true, missingTypes: [] });
  });
});

describe('creation rules (T04-005…010, 013, 028; §13)', () => {
  test('unapproved protocol, delegated giver, wrong type for age, wrong giver and duplicates are refused with no row created', async () => {
    const minor = await participant(14); const adult = await participant(19);
    const rows = async (pid) => (await f.query('SELECT count(*)::int AS n FROM santulan.consents WHERE participant_id = $1', [pid]))[0].n;

    const unapproved = await create({ participantId: minor.pid, consentType: 'STUDENT_ASSENT', giverRelationship: 'SELF', protocolVersion: 'NOT-APPROVED' });
    expect(unapproved.status).toBe(422); expect(unapproved.body.error.code).toBe('PROTOCOL_UNAPPROVED');
    expect((await create({ participantId: minor.pid, consentType: 'PARENT_GUARDIAN_CONSENT', giverRelationship: 'INSTITUTION_DELEGATED' })).status).toBe(422);
    expect((await create({ participantId: adult.pid, consentType: 'STUDENT_ASSENT', giverRelationship: 'SELF' })).status).toBe(422);          // adult cannot assent
    expect((await create({ participantId: minor.pid, consentType: 'ADULT_SELF_CONSENT', giverRelationship: 'SELF' })).status).toBe(422);       // minor cannot self-consent
    expect((await create({ participantId: minor.pid, consentType: 'PARENT_GUARDIAN_CONSENT', giverRelationship: 'SELF' })).status).toBe(422);  // parent consent from SELF
    expect((await create({ participantId: minor.pid, consentType: 'STUDENT_ASSENT', giverRelationship: 'PARENT' })).status).toBe(422);         // assent from a parent
    expect((await create({ participantId: minor.pid, consentType: 'STUDENT_ASSENT', giverRelationship: 'SELF', extra: 1 })).status).toBe(400);
    expect((await create({ participantId: '00000000-0000-4000-8000-000000000000', consentType: 'ADULT_SELF_CONSENT', giverRelationship: 'SELF' })).status).toBe(404);
    expect(await rows(minor.pid)).toBe(0);

    expect((await create({ participantId: minor.pid, consentType: 'STUDENT_ASSENT', giverRelationship: 'SELF' })).status).toBe(201);
    const dup = await create({ participantId: minor.pid, consentType: 'STUDENT_ASSENT', giverRelationship: 'SELF' });
    expect(dup.status).toBe(409); expect(dup.body.error.code).toBe('CONSENT_DUPLICATE');
    expect(await rows(minor.pid)).toBe(1);
  });

  test('with no approved protocols configured every creation and verification fails closed', async () => {
    const p = await participant(20);
    const c = (await create({ participantId: p.pid, consentType: 'ADULT_SELF_CONSENT', giverRelationship: 'SELF' })).body;
    await api().post(`/api/v1/consents/${c.consentId}/grant`).set(bearer(p.token)).send({});
    const saved = config.consentProtocolsPath;
    try {
      config.consentProtocolsPath = '';
      expect((await create({ participantId: p.pid, consentType: 'ADULT_SELF_CONSENT', giverRelationship: 'SELF', protocolVersion: 'ANY' })).body.error.code).toBe('PROTOCOL_UNAPPROVED');
      expect((await verify(c.consentId)).body.error.code).toBe('PROTOCOL_UNAPPROVED');
      config.consentProtocolsPath = '/no/such/file.json';
      expect((await verify(c.consentId)).status).toBe(422);
    } finally { config.consentProtocolsPath = saved; }
    expect((await gate(p)).body.open).toBe(false);
  });
});

describe('verification method is an approved code, never evidence (T04-023…026, 032, 035)', () => {
  test.each(['123456', 'guardian@example.com', '+91 98765 43210', 'NOT_AN_APPROVED_CODE', 'test method a', 'A'.repeat(70)])(
    '%s is refused and nothing is stored', async (method) => {
      const p = await participant(23);
      const c = (await create({ participantId: p.pid, consentType: 'ADULT_SELF_CONSENT', giverRelationship: 'SELF' })).body;
      await api().post(`/api/v1/consents/${c.consentId}/grant`).set(bearer(p.token)).send({});
      const res = await verify(c.consentId, method);
      expect(res.status).toBe(method.length > 64 ? 400 : 422);
      expect(JSON.stringify(res.body)).not.toContain(method);   // the value is never echoed back
      const row = (await f.query('SELECT status, verification_method FROM santulan.consents WHERE consent_id = $1', [c.consentId]))[0];
      expect(row).toEqual({ status: 'GRANTED', verification_method: null });
    });

  test('audit rows carry ids and states only', async () => {
    const p = await participant(24);
    const c = (await create({ participantId: p.pid, consentType: 'ADULT_SELF_CONSENT', giverRelationship: 'SELF' })).body;
    await api().post(`/api/v1/consents/${c.consentId}/grant`).set(bearer(p.token)).send({});
    await verify(c.consentId, 'TEST_METHOD_A');
    const audits = await f.query(`SELECT action_type, actor_type, new_state::text AS s FROM santulan.audit_logs WHERE target_id = $1 ORDER BY occurred_at, action_type`, [c.consentId]);
    expect(audits.map((a) => a.action_type)).toEqual(['CONSENT_CREATED', 'CONSENT_GRANTED', 'CONSENT_VERIFIED']);
    expect(audits.map((a) => a.actor_type)).toEqual(['SYSTEM', 'PARTICIPANT', 'SYSTEM']);
    expect(JSON.stringify(audits)).not.toMatch(/@|[0-9]{6}|token|otp/i);
  });
});

describe('withdrawal (T04-011…017, 021, 033, 034; §11)', () => {
  const setHook = (fn) => setWithdrawalHook(fn);
  afterEach(() => setWithdrawalHook(defaultHook));

  test('withdrawing closes the gate at once, is terminal, calls the workflow hook once, and rewrites no response', async () => {
    const p = await participant(18);
    const c = (await create({ participantId: p.pid, consentType: 'ADULT_SELF_CONSENT', giverRelationship: 'SELF' })).body;
    await api().post(`/api/v1/consents/${c.consentId}/grant`).set(bearer(p.token)).send({});
    await verify(c.consentId);
    expect((await gate(p)).body.open).toBe(true);

    const calls = [];
    setHook(async (tx, ctx) => { calls.push(ctx); });
    const responsesBefore = (await f.query('SELECT count(*)::int AS n FROM santulan.responses'))[0].n;
    const w = await api().post(`/api/v1/consents/${c.consentId}/withdraw`).set(bearer(p.token)).send({});
    expect(w.status).toBe(200);
    expect(w.body).toMatchObject({ status: 'WITHDRAWN', gateOpen: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ participantId: p.pid, consentId: c.consentId });
    expect((await gate(p)).body).toEqual({ open: false, missingTypes: ['ADULT_SELF_CONSENT'] });
    expect((await f.query('SELECT count(*)::int AS n FROM santulan.responses'))[0].n).toBe(responsesBefore);

    for (const path of ['grant', 'withdraw']) {
      const again = await api().post(`/api/v1/consents/${c.consentId}/${path}`).set(INTERNAL).send({});
      expect(again.status).toBe(409);
    }
    expect((await verify(c.consentId)).status).toBe(409);
    // re-consent is a NEW row under the approved protocol
    expect((await create({ participantId: p.pid, consentType: 'ADULT_SELF_CONSENT', giverRelationship: 'SELF' })).status).toBe(201);
  });

  test('the default workflow only records that the approved procedure is not configured', async () => {
    const p = await participant(17);
    const c = (await create({ participantId: p.pid, consentType: 'STUDENT_ASSENT', giverRelationship: 'SELF' })).body;
    expect((await api().post(`/api/v1/consents/${c.consentId}/withdraw`).set(bearer(p.token)).send({})).status).toBe(200);   // PENDING -> WITHDRAWN
    const audits = await f.query(`SELECT action_type FROM santulan.audit_logs WHERE target_id = $1 ORDER BY occurred_at, action_type`, [c.consentId]);
    expect(audits.map((a) => a.action_type).sort()).toEqual(['CONSENT_CREATED', 'CONSENT_WITHDRAWAL_WORKFLOW_PENDING', 'CONSENT_WITHDRAWN']);   // last two share one transaction
  });

  test('one participant cannot see or change another participant\'s consent', async () => {
    const a = await participant(19); const b = await participant(19);
    const c = (await create({ participantId: a.pid, consentType: 'ADULT_SELF_CONSENT', giverRelationship: 'SELF' })).body;
    expect((await api().post(`/api/v1/consents/${c.consentId}/grant`).set(bearer(b.token)).send({})).status).toBe(404);
    expect((await api().post(`/api/v1/consents/${c.consentId}/withdraw`).set(bearer(b.token)).send({})).status).toBe(404);
    expect((await api().get('/api/v1/consents/requirements').set(bearer(b.token))).body.consents).toEqual([]);
    expect((await api().post('/api/v1/consents/not-a-uuid/withdraw').set(bearer(b.token)).send({})).status).toBe(404);
    expect((await f.query('SELECT status FROM santulan.consents WHERE consent_id = $1', [c.consentId]))[0].status).toBe('PENDING');
  });
});
