/* Attempt rules (B05-001..018, 023, 024, 027, 028, 031..035, T03-017..020): the state machine, the create gate, the sessions. */
const rules = require('../../../src/modules/santulan/domain/attemptRules');
const delivery = require('../../../src/modules/santulan/store/repositories/delivery');
const store = require('../../../src/modules/santulan/store');
const { closeClient } = require('../../../src/modules/santulan/store/client');
const f = require('../helpers/committed');
const F = require('../helpers/fixtures');
const H = require('../helpers/mongoHarness');

afterAll(async () => { await f.cleanupFixtures(); await closeClient(); await H.closeAll(); });

const att = (status, sessionCount = 0) => ({ attemptId: 'a1', status, sessionCount, assessmentVersionId: 'v1' });

describe('the state machine (B05-006)', () => {
  test('B05-006 legal moves', () => {
    const ok = [['CREATED', 'STARTED'], ['STARTED', 'IN_PROGRESS'], ['IN_PROGRESS', 'PAUSED'], ['PAUSED', 'IN_PROGRESS'], ['IN_PROGRESS', 'SUBMITTED'], ['PAUSED', 'SUBMITTED'],
      ['SUBMITTED', 'SCORING'], ['SCORING', 'SCORED'], ['SCORED', 'REPORT_READY'], ['QUALITY_HOLD', 'SCORED'], ['SUBMITTED', 'QUALITY_HOLD']];
    for (const [a, b] of ok) expect(rules.canTransition(a, b)).toBe(true);
  });
  test('B05-007 illegal moves: backwards, skipping, and out of a terminal state', () => {
    const bad = [['SUBMITTED', 'IN_PROGRESS'], ['SUBMITTED', 'PAUSED'], ['CREATED', 'SUBMITTED'], ['SCORED', 'IN_PROGRESS'], ['REPORT_READY', 'SCORED'], ['INVALID', 'CREATED'], ['EXPIRED', 'IN_PROGRESS'], ['PAUSED', 'CREATED']];
    for (const [a, b] of bad) expect(rules.canTransition(a, b)).toBe(false);
  });
  test('B05-008 the non-terminal set is exactly the one the store index uses', () => {
    expect([...rules.NONTERMINAL].sort()).toEqual(['CREATED', 'IN_PROGRESS', 'PAUSED', 'QUALITY_HOLD', 'SCORED', 'SCORING', 'STARTED', 'SUBMITTED']);
    expect(require('../../../db/schema').indexes.find((i) => i.name === 'uq_one_nonterminal_attempt_per_participant').partial.status.$in.sort()).toEqual([...rules.NONTERMINAL].sort());
  });
});

describe('sessions (B05-009..018)', () => {
  test('B05-009 session 1 starts from CREATED: count becomes 1, IN_PROGRESS, SESSION_START(1)', () => {
    const p = rules.planBeginOrResume(att('CREATED'));
    expect(p.patch).toMatchObject({ status: 'IN_PROGRESS', session_count: 1 });
    expect(p.event).toMatchObject({ event_type: 'SESSION_START', session_number: 1 });
  });
  test('B05-010 a reconnect while IN_PROGRESS keeps the count and writes no SESSION_START', () => {
    const p = rules.planBeginOrResume(att('IN_PROGRESS', 2));
    expect(p.patch.session_count).toBeUndefined();
    expect(p.event.event_type).toBe('RESUME');
    expect(p.sessionCount).toBe(2);
  });
  test('B05-011 resuming a PAUSED attempt starts session 2, 3 and 4 - once each', () => {
    for (const n of [1, 2, 3]) {
      const p = rules.planBeginOrResume(att('PAUSED', n));
      expect(p.patch).toMatchObject({ status: 'IN_PROGRESS', session_count: n + 1 });
      expect(p.event).toMatchObject({ event_type: 'SESSION_START', session_number: n + 1 });
    }
  });
  test('B05-012 the fifth session is refused (SESSION_LIMIT)', () => {
    expect(() => rules.planBeginOrResume(att('PAUSED', 4))).toThrow(expect.objectContaining({ status: 409, code: 'SESSION_LIMIT' }));
  });
  test('B05-013 a submitted or terminal attempt cannot start a session (ATTEMPT_LOCKED)', () => {
    for (const s of ['SUBMITTED', 'SCORED', 'INVALID', 'REPORT_READY']) expect(() => rules.planBeginOrResume(att(s, 1))).toThrow(expect.objectContaining({ code: 'ATTEMPT_LOCKED' }));
  });
  test('B05-014 only IN_PROGRESS can pause; a pause writes PAUSE and SESSION_END without changing the count', () => {
    const p = rules.planPause(att('IN_PROGRESS', 2), 'LOGOUT');
    expect(p.events.map((e) => e.event_type)).toEqual(['PAUSE', 'SESSION_END']);
    expect(p.events.every((e) => e.session_number === 2 && e.metadata.reason === 'LOGOUT')).toBe(true);
    expect(p.patch.session_count).toBeUndefined();
    for (const s of ['CREATED', 'PAUSED', 'SUBMITTED']) expect(() => rules.planPause(att(s, 1), 'X')).toThrow(expect.objectContaining({ code: 'INVALID_STATE' }));
  });
  test('B05-015 submit closes an active session first, then records SUBMIT with the key', () => {
    const p = rules.planSubmit(att('IN_PROGRESS', 1), 'KEY-1234567890123456');
    expect(p.events.map((e) => e.event_type)).toEqual(['SESSION_END', 'SUBMIT']);
    expect(p.events[1].metadata.idempotency_key).toBe('KEY-1234567890123456');
    expect(p.patch.status).toBe('SUBMITTED');
    const paused = rules.planSubmit(att('PAUSED', 2), 'KEY-1234567890123456');
    expect(paused.events.map((e) => e.event_type)).toEqual(['SUBMIT']);
  });
  test('B05-016 submit needs a key and a submittable state', () => {
    expect(() => rules.planSubmit(att('IN_PROGRESS', 1), '')).toThrow(expect.objectContaining({ status: 422 }));
    for (const s of ['CREATED', 'SUBMITTED', 'SCORED']) expect(() => rules.planSubmit(att(s, 1), 'KEY-1234567890123456')).toThrow(expect.objectContaining({ code: 'INVALID_STATE' }));
  });
  test('B05-018 an event session number can never exceed the attempt session count', () => {
    expect(() => rules.assertEventSession(att('IN_PROGRESS', 1), { session_number: 2 })).toThrow(expect.objectContaining({ status: 422 }));
    expect(() => rules.assertEventSession(att('IN_PROGRESS', 2), { session_number: 2 })).not.toThrow();
    expect(() => rules.assertEventSession(att('CREATED', 0), { session_number: null })).not.toThrow();
  });
});

describe('the create gate (T03-017..020, B05-031..035)', () => {
  const set = (o = {}) => ({ status: 'FROZEN', participation_state: 'OPEN', participant_min_age: 13, participant_max_age: 17, ...o });
  const p = (o = {}) => ({ status: 'ACTIVE', ageYearsAtRegistration: 15, ...o });
  const tx = () => store.withScope(store.systemScope(), async (t) => t);

  test('T03-017 a suspended participant is refused', async () => {
    await store.withScope(store.systemScope(), async (t) => {
      await expect(rules.assertCanStart(t, { participant: p({ status: 'SUSPENDED' }), set: set(), gate: { open: true } })).rejects.toMatchObject({ status: 403 });
    });
  });
  test('T03-018 an unverified consent gate refuses (CONSENT_GATE_CLOSED)', async () => {
    await store.withScope(store.systemScope(), async (t) => {
      await expect(rules.assertCanStart(t, { participant: p(), set: set(), gate: { open: false } })).rejects.toMatchObject({ status: 403, code: 'CONSENT_GATE_CLOSED' });
    });
  });
  test('T03-019 the set must be FROZEN and OPEN; a draft or closed set is ASSESSMENT_NOT_OPEN', async () => {
    await store.withScope(store.systemScope(), async (t) => {
      for (const s of [set({ status: 'DRAFT' }), set({ participation_state: 'CLOSED' }), set({ participation_state: 'PAUSED' }), null]) {
        await expect(rules.assertCanStart(t, { participant: p(), set: s, gate: { open: true } })).rejects.toMatchObject({ status: 409, code: 'ASSESSMENT_NOT_OPEN' });
      }
    });
  });
  test('T03-020 the age must be inside the set range: 18 is never on the adolescent set, 17 never on the adult set', async () => {
    await store.withScope(store.systemScope(), async (t) => {
      await expect(rules.assertCanStart(t, { participant: p({ ageYearsAtRegistration: 18 }), set: set(), gate: { open: true } })).rejects.toMatchObject({ status: 422 });
      await expect(rules.assertCanStart(t, { participant: p({ ageYearsAtRegistration: 17 }), set: set({ participant_min_age: 18, participant_max_age: 25 }), gate: { open: true } })).rejects.toMatchObject({ status: 422 });
      await expect(rules.assertCanStart(t, { participant: p({ ageYearsAtRegistration: 17 }), set: set(), gate: { open: true } })).resolves.toBeUndefined();
      await expect(rules.assertCanStart(t, { participant: p({ ageYearsAtRegistration: 25 }), set: set({ participant_min_age: 18, participant_max_age: 25 }), gate: { open: true } })).resolves.toBeUndefined();
    });
    expect(tx).toBeDefined();
  });
  test('T03-020 the control plane STOPPED refuses even an open set (fail closed)', async () => {
    await f.controlEvent('STOPPED');
    try {
      await store.withScope(store.systemScope(), async (t) => {
        await expect(rules.assertCanStart(t, { participant: p(), set: set(), gate: { open: true } })).rejects.toMatchObject({ code: 'ASSESSMENT_NOT_OPEN' });
      });
      await f.controlEvent('SOMETHING_UNRECOGNISED');
      await store.withScope(store.systemScope(), async (t) => {
        await expect(rules.assertCanStart(t, { participant: p(), set: set(), gate: { open: true } })).rejects.toMatchObject({ code: 'ASSESSMENT_NOT_OPEN' });
      });
    } finally { await f.controlEvent('OPEN'); }
    await store.withScope(store.systemScope(), async (t) => {
      await expect(rules.assertCanStart(t, { participant: p(), set: set(), gate: { open: true } })).resolves.toBeUndefined();
    });
  });
});

describe('store guarantees behind the rules (B05-001, B05-023)', () => {
  test('B05-001 a second non-terminal attempt is refused by the store; a terminal one does not count', async () => {
    const pt = await f.participant(15);
    const version = F.versionDoc()._id;
    const sys = store.systemScope();
    const make = () => store.withScope(sys, (t) => delivery.insertAttempt(t, { participantId: pt.participantId, assessmentVersionId: version, ageYears: 15 }), { transaction: true });
    const first = await make();
    await expect(make()).rejects.toMatchObject({ status: 409 });
    await (await f.db()).collection('assessment_attempts').updateOne({ _id: first.attemptId }, { $set: { status: 'INVALID' } });
    await expect(make()).resolves.toBeTruthy();
  });
  test('B05-023 an attempt move is compare-and-set: a stale from-state changes nothing', async () => {
    const pt = await f.participant(15);
    const sys = store.systemScope();
    const a = await store.withScope(sys, (t) => delivery.insertAttempt(t, { participantId: pt.participantId, assessmentVersionId: F.versionDoc()._id, ageYears: 15 }), { transaction: true });
    const moved = await store.withScope(sys, (t) => delivery.moveAttempt(t, a.attemptId, 'PAUSED', { status: 'IN_PROGRESS' }), { transaction: true });
    expect(moved).toBe(false);
    expect((await (await f.db()).collection('assessment_attempts').findOne({ _id: a.attemptId })).status).toBe('CREATED');
    await expect(store.withScope(sys, (t) => delivery.moveAttempt(t, a.attemptId, 'CREATED', { status: 'SCORED' }), { transaction: true })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
  test('B05-024 participant, question set and age are not in the update path at all', async () => {
    const pt = await f.participant(15);
    const sys = store.systemScope();
    const a = await store.withScope(sys, (t) => delivery.insertAttempt(t, { participantId: pt.participantId, assessmentVersionId: F.versionDoc()._id, ageYears: 15 }), { transaction: true });
    await store.withScope(sys, async (t) => {
      for (const field of ['participant_id', 'assessment_version_id', 'age_years_at_attempt']) {
        await expect(t.c.assessment_attempts.updateOne({ _id: a.attemptId }, { $set: { [field]: 'x' } })).rejects.toMatchObject({ status: 403 });
      }
    });
  });
});
