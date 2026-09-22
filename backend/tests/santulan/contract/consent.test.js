/*
 * HTTP contract tests for consent, assent and the verification gate (BUILD 04: T04-027, 028, 031, 032, 035 and the
 * service rules of §10-§13). Approved protocols come from a TEST fixture (identifiers and method codes only).
 */
const request = require('supertest');
const app = require('../../../src/app');
const { closeClient } = require('../../../src/modules/santulan/store/client');
const H = require('../helpers/mongoHarness');
const config = require('../../../src/config');
const f = require('../helpers/committed');
const { setWithdrawalHook, defaultHook } = require('../../../src/modules/santulan/consent/withdrawalHook');

const api = () => request(app);
const PROTO = 'TEST-PROTOCOL-1';
const INTERNAL = { 'X-Internal-Api-Key': 'test-internal-key' };
const key = () => `idem-${f.u()}-${f.u()}`;

afterAll(async () => { await f.cleanupFixtures(); await closeClient(); await H.closeAll(); });
const col = async (name) => (await f.db()).collection(name);

async function participant(age) {
  const res = await api().post('/api/v1/registrations/open').set('Idempotency-Key', key()).send({ age });
  expect(res.status).toBe(201);
  const pid = (await (await col('participants')).findOne({ santulan_id: res.body.santulanId }))._id;
  return { pid, token: f.participantToken(pid) };
}
const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const rows = async (pid) => (await col('consents')).countDocuments({ participant_id: pid });
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

    expect(await (await col('assessment_attempts')).countDocuments({ participant_id: p.pid })).toBe(0);                                                                            // consent is necessary, not sufficient
    const stored = (await (await col('consents')).find({ participant_id: p.pid }).sort({ consent_type: 1 }).toArray()).map((c) => ({ status: c.status, verification_method: c.verification_method }));
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
    const rows = async (pid) => (await col('consents')).countDocuments({ participant_id: pid });

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
      const row = await (await col('consents')).findOne({ _id: c.consentId });
      expect({ status: row.status, verification_method: row.verification_method }).toEqual({ status: 'GRANTED', verification_method: null });
    });

  test('audit rows carry ids and states only', async () => {
    const p = await participant(24);
    const c = (await create({ participantId: p.pid, consentType: 'ADULT_SELF_CONSENT', giverRelationship: 'SELF' })).body;
    await api().post(`/api/v1/consents/${c.consentId}/grant`).set(bearer(p.token)).send({});
    await verify(c.consentId, 'TEST_METHOD_A');
    const audits = (await (await col('audit_logs')).find({ target_id: c.consentId }).sort({ occurred_at: 1, action_type: 1 }).toArray()).map((a) => ({ action_type: a.action_type, actor_type: a.actor_type, s: JSON.stringify(a.new_state) }));
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
    const responsesBefore = await (await col('responses')).countDocuments({});
    const w = await api().post(`/api/v1/consents/${c.consentId}/withdraw`).set(bearer(p.token)).send({});
    expect(w.status).toBe(200);
    expect(w.body).toMatchObject({ status: 'WITHDRAWN', gateOpen: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ participantId: p.pid, consentId: c.consentId });
    expect((await gate(p)).body).toEqual({ open: false, missingTypes: ['ADULT_SELF_CONSENT'] });
    expect(await (await col('responses')).countDocuments({})).toBe(responsesBefore);

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
    const audits = await (await col('audit_logs')).find({ target_id: c.consentId }).sort({ occurred_at: 1, action_type: 1 }).toArray();
    expect(audits.map((a) => a.action_type).sort()).toEqual(['CONSENT_CREATED', 'CONSENT_WITHDRAWAL_WORKFLOW_PENDING', 'CONSENT_WITHDRAWN']);   // last two share one transaction
  });

  test('CR-006-13: one self-consent call creates, grants and verifies ADULT_SELF_CONSENT for an adult; re-calling is a safe no-op', async () => {
    const p = await participant(20);
    const first = await api().post('/api/v1/consents/self-consent').set(bearer(p.token)).send({});
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ consentType: 'ADULT_SELF_CONSENT', giverRelationship: 'SELF', status: 'VERIFIED' });
    expect((await gate(p)).body).toEqual({ open: true, missingTypes: [] });
    expect(await rows(p.pid)).toBe(1); // exactly one record, not one per step

    const again = await api().post('/api/v1/consents/self-consent').set(bearer(p.token)).send({});
    expect(again.status).toBe(201);
    expect(again.body.consentId).toBe(first.body.consentId); // the same record, still VERIFIED - not a duplicate
    expect(await rows(p.pid)).toBe(1);

    const row = await (await col('consents')).findOne({ _id: first.body.consentId });
    expect(row.verification_method).toBe('SELF_ATTESTED');
    const audits = (await (await col('audit_logs')).find({ target_id: first.body.consentId }).sort({ occurred_at: 1 }).toArray()).map((a) => a.action_type);
    expect(audits).toEqual(['CONSENT_CREATED', 'CONSENT_GRANTED', 'CONSENT_VERIFIED']); // the second call added nothing further
  });

  test('CR-006-13: a minor is refused self-consent outright; their parent/guardian + assent flow is unaffected', async () => {
    const minor = await participant(15);
    const res = await api().post('/api/v1/consents/self-consent').set(bearer(minor.token)).send({});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SELF_CONSENT_NOT_AVAILABLE');
    expect(await rows(minor.pid)).toBe(0);
    expect((await gate(minor)).body).toEqual({ open: false, missingTypes: ['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT'] });
    // the admin-mediated flow still works exactly as before for this same minor
    const assent = (await create({ participantId: minor.pid, consentType: 'STUDENT_ASSENT', giverRelationship: 'SELF' })).body;
    expect(assent.status).toBe('PENDING');
  });

  test('CR-006-13: no approved protocol configured -> fails closed, nothing created; no token -> 401', async () => {
    expect((await api().post('/api/v1/consents/self-consent').send({})).status).toBe(401);
    const p = await participant(21);
    const saved = config.consentProtocolsPath;
    try {
      config.consentProtocolsPath = '';
      const res = await api().post('/api/v1/consents/self-consent').set(bearer(p.token)).send({});
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('PROTOCOL_UNAPPROVED');
    } finally { config.consentProtocolsPath = saved; }
    expect(await rows(p.pid)).toBe(0);
  });

  test('CR-006-14: one minor-self-service call creates, grants and verifies STUDENT_ASSENT and PARENT_GUARDIAN_CONSENT for a minor; re-calling is a safe no-op', async () => {
    const minor = await participant(15);
    const first = await api().post('/api/v1/consents/minor-self-service').set(bearer(minor.token)).send({});
    expect(first.status).toBe(201);
    expect(first.body.assent).toMatchObject({ consentType: 'STUDENT_ASSENT', giverRelationship: 'SELF', status: 'VERIFIED' });
    expect(first.body.parentGuardianConsent).toMatchObject({ consentType: 'PARENT_GUARDIAN_CONSENT', giverRelationship: 'PARENT', status: 'VERIFIED' });
    expect((await gate(minor)).body).toEqual({ open: true, missingTypes: [] });
    expect(await rows(minor.pid)).toBe(2); // exactly one record per type, not one per step

    const assentRow = await (await col('consents')).findOne({ _id: first.body.assent.consentId });
    expect(assentRow.verification_method).toBe('SELF_ATTESTED');
    const parentRow = await (await col('consents')).findOne({ _id: first.body.parentGuardianConsent.consentId });
    expect(parentRow.verification_method).toBe('STUDENT_ATTESTED_FOR_PARENT'); // never confused with an actual parent action

    const again = await api().post('/api/v1/consents/minor-self-service').set(bearer(minor.token)).send({});
    expect(again.status).toBe(201);
    expect(again.body.assent.consentId).toBe(first.body.assent.consentId);
    expect(again.body.parentGuardianConsent.consentId).toBe(first.body.parentGuardianConsent.consentId);
    expect(await rows(minor.pid)).toBe(2);
  });

  test('CR-006-14: an adult is refused outright; their own self-consent is unaffected', async () => {
    const adult = await participant(20);
    const res = await api().post('/api/v1/consents/minor-self-service').set(bearer(adult.token)).send({});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PARENT_CONSENT_NOT_APPLICABLE');
    expect(await rows(adult.pid)).toBe(0);
    expect((await api().post('/api/v1/consents/self-consent').set(bearer(adult.token)).send({})).status).toBe(201);
  });

  test('CR-006-14: a real parent/guardian can still take over the ordinary way - withdraw the student-attested record, then the admin-mediated flow verifies a fresh one exactly as before', async () => {
    const minor = await participant(16);
    const first = (await api().post('/api/v1/consents/minor-self-service').set(bearer(minor.token)).send({})).body;
    const parentRow = await (await col('consents')).findOne({ _id: first.parentGuardianConsent.consentId });
    expect(parentRow.verification_method).toBe('STUDENT_ATTESTED_FOR_PARENT');
    // uq_consent_active_type_protocol (one active record per participant/type/protocol) means a second live record for the
    // same protocol version cannot coexist - withdrawing first is the real upgrade path, unchanged by CR-006-14.
    expect((await api().post(`/api/v1/consents/${first.parentGuardianConsent.consentId}/withdraw`).set(bearer(minor.token)).send({})).status).toBe(200);
    const realParent = (await create({ participantId: minor.pid, consentType: 'PARENT_GUARDIAN_CONSENT', giverRelationship: 'PARENT' })).body;
    await api().post(`/api/v1/consents/${realParent.consentId}/grant`).set(INTERNAL).send({});
    const verified = await verify(realParent.consentId);
    expect(verified.status).toBe(200);
    expect(verified.body.status).toBe('VERIFIED');
    const row = await (await col('consents')).findOne({ _id: realParent.consentId });
    expect(row.verification_method).toBe('TEST_METHOD_A'); // a genuinely different method from the student-attested one
  });

  test('CR-006-14: no approved protocol for PARENT_GUARDIAN_CONSENT -> fails closed on that step; the assent already completed stands', async () => {
    const minor = await participant(17);
    const saved = config.consentProtocolsPath;
    const withoutParent = require('path').join(require('os').tmpdir(), `santulan-${f.u()}-no-parent-protocol.json`);
    const full = JSON.parse(require('fs').readFileSync(saved, 'utf8'));
    require('fs').writeFileSync(withoutParent, JSON.stringify(full.filter((e) => e.consentType !== 'PARENT_GUARDIAN_CONSENT')));
    try {
      config.consentProtocolsPath = withoutParent;
      const res = await api().post('/api/v1/consents/minor-self-service').set(bearer(minor.token)).send({});
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('PROTOCOL_UNAPPROVED');
    } finally { config.consentProtocolsPath = saved; require('fs').rmSync(withoutParent, { force: true }); }
    const assentRow = await (await col('consents')).findOne({ participant_id: minor.pid, consent_type: 'STUDENT_ASSENT' });
    expect(assentRow.status).toBe('VERIFIED'); // the independent, already-approved step is not rolled back by the later failure
    expect(await (await col('consents')).countDocuments({ participant_id: minor.pid, consent_type: 'PARENT_GUARDIAN_CONSENT' })).toBe(0);
  });

  test('one participant cannot see or change another participant\'s consent', async () => {
    const a = await participant(19); const b = await participant(19);
    const c = (await create({ participantId: a.pid, consentType: 'ADULT_SELF_CONSENT', giverRelationship: 'SELF' })).body;
    expect((await api().post(`/api/v1/consents/${c.consentId}/grant`).set(bearer(b.token)).send({})).status).toBe(404);
    expect((await api().post(`/api/v1/consents/${c.consentId}/withdraw`).set(bearer(b.token)).send({})).status).toBe(404);
    expect((await api().get('/api/v1/consents/requirements').set(bearer(b.token))).body.consents).toEqual([]);
    expect((await api().post('/api/v1/consents/not-a-uuid/withdraw').set(bearer(b.token)).send({})).status).toBe(404);
    expect((await (await col('consents')).findOne({ _id: c.consentId })).status).toBe('PENDING');
  });
});
