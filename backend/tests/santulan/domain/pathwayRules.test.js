/*
 * Pathway rules (B07-052, 056..065, 071, 080; BUILD 07 sections 13-16): precedence P5 > P4 > P3 > P2 > P1, the P0 blocks, the human
 * support basis, the minor consent gate. The P5 hook is exercised against the SCRATCH database at the end (idempotent, pauses only ACTIVE
 * plans, audit without trigger content, never consults a release switch). HTTP behaviour: contract/pathways.test.js.
 */
const { v4: uuidv4 } = require('uuid');
const rules = require('../../../src/modules/santulan/domain/pathwayRules');
const store = require('../../../src/modules/santulan/store');
const { firePathwayP5 } = require('../../../src/modules/santulan/pathways/p5Hook');
const p = require('../helpers/contractPipeline');
const { closeClient } = require('../../../src/modules/santulan/store/client');

const { f, F, H, P, scoredAttempt } = p;
const body = (pathwayCode, over = {}) => ({ pathwayCode, triggerCode: 'PARTICIPANT_REQUEST', decisionSource: 'PARTICIPANT', ...over });
const ctx = (over = {}) => ({ attemptStatus: 'SCORED', isMinor: false, gateOpen: true, domainScore: null, hasSelectedPriority: false, ...over });
const blocked = expect.objectContaining({ status: 422, code: 'PATHWAY_NOT_ALLOWED' });

describe('precedence (B07-065)', () => {
  test('P5 > P4 > P3 > P2 > P1; no route when none', () => {
    expect(rules.PRECEDENCE).toEqual(['P5', 'P4', 'P3', 'P2', 'P1']);
    expect(rules.effectiveRoute(['P1', 'P2'])).toBe('P2');
    expect(rules.effectiveRoute(['P2', 'P5', 'P3'])).toBe('P5');
    expect(rules.effectiveRoute(['P1', 'P4', 'P3'])).toBe('P4');
    expect(rules.effectiveRoute([])).toBeNull();
  });
});

describe('P0 blocks (M08-M11; B07-062, 063)', () => {
  test('nothing ordinary comes from a QUALITY_HOLD or INVALID attempt', () => {
    for (const attemptStatus of ['QUALITY_HOLD', 'INVALID']) for (const code of ['P1', 'P2', 'P3', 'P4']) {
      expect(() => rules.assertOrdinaryAllowed(body(code, { decisionSource: 'HUMAN_REVIEW' }), ctx({ attemptStatus }))).toThrow(blocked);
    }
  });

  test('no automated pathway comes from a held-interpretation construct (C4.2, C2.10)', () => {
    for (const subdomainCode of ['C4.2', 'C2.10']) expect(() => rules.assertOrdinaryAllowed(body('P2', { subdomainCode }), ctx())).toThrow(blocked);
  });

  test('a developmental route (P1 / P2) needs a reportable domain result; S0, S1 and SH domains and a missing result are refused', () => {
    for (const state of ['S0', 'S1', 'SH']) for (const code of ['P1', 'P2']) {
      expect(() => rules.assertOrdinaryAllowed(body(code, { domainCode: 'C3' }), ctx({ domainScore: { scoreStatus: state }, hasSelectedPriority: true }))).toThrow(blocked);
    }
    expect(() => rules.assertOrdinaryAllowed(body('P2', { domainCode: 'C3' }), ctx({ domainScore: null }))).toThrow(blocked);
    expect(rules.assertOrdinaryAllowed(body('P2', { domainCode: 'C3' }), ctx({ domainScore: { scoreStatus: 'S2' } }))).toBe('S2'); // the evidence state is derived, not supplied
    expect(rules.assertOrdinaryAllowed(body('P2'), ctx())).toBe('S0'); // no domain: no capability interpretation is relied upon
  });

  test('P1 needs a domain and a participant-selected priority in it (M11 -> P0)', () => {
    const p1 = body('P1', { triggerCode: 'SELECTED_PRIORITY', decisionSource: 'SYSTEM', domainCode: 'C1' });
    const score = { scoreStatus: 'S2' };
    expect(() => rules.assertOrdinaryAllowed({ ...p1, domainCode: undefined }, ctx({ hasSelectedPriority: true }))).toThrow(blocked);
    expect(() => rules.assertOrdinaryAllowed(p1, ctx({ domainScore: score, hasSelectedPriority: false }))).toThrow(blocked);
    expect(rules.assertOrdinaryAllowed(p1, ctx({ domainScore: score, hasSelectedPriority: true }))).toBe('S2');
  });
});

describe('human-support routes (P3 / P4; B07-052, 056, 057, 071)', () => {
  test('a score alone never creates P3 or P4, whatever the source', () => {
    for (const code of ['P3', 'P4']) for (const triggerCode of ['SCORE_ONLY', 'LOW_SCORE']) for (const decisionSource of ['SYSTEM', 'PARTICIPANT', 'HUMAN_REVIEW']) {
      expect(() => rules.assertOrdinaryAllowed(body(code, { triggerCode, decisionSource }), ctx())).toThrow(blocked);
    }
  });

  test('an automated system cannot create P3 or P4 at all', () => {
    for (const code of ['P3', 'P4']) expect(() => rules.assertOrdinaryAllowed(body(code, { decisionSource: 'SYSTEM' }), ctx())).toThrow(blocked);
  });

  test('P3 needs a participant request or a human decision; P4 needs an authorised professional judgement (HUMAN_REVIEW)', () => {
    expect(rules.assertOrdinaryAllowed(body('P3', { decisionSource: 'PARTICIPANT' }), ctx())).toBe('S0');
    expect(rules.assertOrdinaryAllowed(body('P3', { decisionSource: 'HUMAN_REVIEW' }), ctx())).toBe('S0');
    expect(rules.assertOrdinaryAllowed(body('P4', { decisionSource: 'HUMAN_REVIEW', triggerCode: 'AUTHORISED_REFERRAL' }), ctx())).toBe('S0');
    expect(() => rules.assertOrdinaryAllowed(body('P4', { decisionSource: 'PARTICIPANT' }), ctx())).toThrow(blocked);
  });

  test('a minor\'s handoff needs the verified consent / assent gate; an adult\'s does not; structured development is not a handoff', () => {
    for (const code of ['P3', 'P4']) expect(() => rules.assertOrdinaryAllowed(body(code, { decisionSource: 'HUMAN_REVIEW' }), ctx({ isMinor: true, gateOpen: false }))).toThrow(blocked);
    expect(rules.assertOrdinaryAllowed(body('P3'), ctx({ isMinor: true, gateOpen: true }))).toBe('S0');
    expect(rules.assertOrdinaryAllowed(body('P3'), ctx({ isMinor: false, gateOpen: false }))).toBe('S0');
    expect(rules.assertOrdinaryAllowed(body('P2'), ctx({ isMinor: true, gateOpen: false }))).toBe('S0');
  });
});

describe('P5 triggers (B07-058, 061)', () => {
  test('only Q09, safeguarding and crisis triggers (any case) fire P5; a score, request or selection never does', () => {
    for (const t of ['Q09', 'q09', 'SAFEGUARDING', 'crisis', ' CRISIS ']) expect(rules.isP5Trigger(t)).toBe(true);
    for (const t of ['LOW_SCORE', 'SCORE_ONLY', 'PARTICIPANT_REQUEST', 'SELECTED_PRIORITY', '', null, undefined]) expect(rules.isP5Trigger(t)).toBe(false);
    expect(() => rules.assertP5Trigger('LOW_SCORE')).toThrow(blocked);
    expect(() => rules.assertP5Trigger('Q09')).not.toThrow();
  });
});

describe('the P5 hook (B07-058..061, 080)', () => {
  beforeAll(async () => { await p.openAdolescentSet(); });
  afterEach(() => p.resetSwitches());
  afterAll(async () => { await f.closeOpenSets(); await f.cleanupFixtures(); await closeClient(); await H.closeAll(); });

  const fire = (attemptId, opts = {}) => store.withScope(store.systemScope(), (tx) => firePathwayP5(tx, { attemptId, ...opts }), { transaction: true });

  test('it is idempotent per attempt and trigger: one S7 / ESCALATED decision, one audit row without trigger content, no release switch consulted', async () => {
    const a = await scoredAttempt({ s2: true }); // every switch is OFF while the hook runs (the helper resets them)
    const first = await fire(a.id, { triggerCode: 'Q09', correlationId: 'p5-1' });
    const second = await fire(a.id, { triggerCode: 'q09' });
    expect(second).toBe(first);
    const db = await H.admin();
    const decisions = await db.collection('pathway_decisions').find({ source_attempt_id: a.id }).toArray();
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ pathway_code: 'P5', status: 'S7', evidence_state: 'S0', trigger_code: 'Q09', domain_code: null });
    const audit = await db.collection('audit_logs').find({ action_type: 'P5_FIRED', target_id: first }).toArray();
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0].new_state)).not.toMatch(/safeguard|crisis|note|disclosure/i);
  });

  test('it pauses only ACTIVE growth plans of that participant', async () => {
    const a = await scoredAttempt({ s2: true });
    const other = await scoredAttempt({ s2: true });
    const attempt = await P.attemptOf(a.id);
    const otherAttempt = await P.attemptOf(other.id);
    const db = await H.admin();
    const mk = (att, status) => F.growthPlan(att.participant_id, att._id, att.assessment_version_id, { _id: uuidv4(), status });
    const plans = [mk(attempt, 'ACTIVE'), mk(attempt, 'ACTIVE'), mk(attempt, 'DRAFT'), mk(attempt, 'COMPLETED'), mk(otherAttempt, 'ACTIVE')];
    await db.collection('growth_plans').insertMany(plans);
    await fire(a.id, { triggerCode: 'SAFEGUARDING' });
    const after = Object.fromEntries((await db.collection('growth_plans').find({ _id: { $in: plans.map((x) => x._id) } }).toArray()).map((r) => [r._id, r.status]));
    expect(plans.map((x) => after[x._id])).toEqual(['PAUSED', 'PAUSED', 'DRAFT', 'COMPLETED', 'ACTIVE']);
  });

  test('it works from any attempt state (a held attempt) and refuses a non-P5 trigger; an unknown attempt is 404', async () => {
    const a = await scoredAttempt({ s2: true });
    await (await H.admin()).collection('assessment_attempts').updateOne({ _id: a.id }, { $set: { status: 'QUALITY_HOLD' } });
    expect(await fire(a.id, { triggerCode: 'CRISIS' })).toBeTruthy();
    await expect(fire(a.id, { triggerCode: 'LOW_SCORE' })).rejects.toMatchObject({ status: 422, code: 'PATHWAY_NOT_ALLOWED' });
    await expect(fire('00000000-0000-4000-8000-000000000000', { triggerCode: 'Q09' })).rejects.toMatchObject({ status: 404 });
  });
});
