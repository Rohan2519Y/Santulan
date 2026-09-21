/*
 * Growth rules (B07-037, 038, 040, 041, 046, 048..051; PG-01..PG-10): the application half of what the SQL guards used to enforce.
 * Pure rules: no database. The service and HTTP behaviour is covered by contract/growth.test.js.
 */
const rules = require('../../../src/modules/santulan/domain/growthRules');

const score = (state, raw = 3) => ({ rawScore: raw, scoreStatus: state });
const action = (over = {}) => ({ action_code: 'DAL-001', library_version: 'DRM-v1.1', domain_code: 'C1', subdomain_code: 'C1.1', active: true, evidence_status: 'Foundation ready', control_flags: { control: 'Standard' }, ...over });

describe('a priority comes only from a reportable domain of a scored attempt (PG-01, B07-037/038)', () => {
  test.each(['S2', 'S3', 'S4', 'S5'])('%s with a score on a SCORED or REPORT_READY attempt is eligible', (state) => {
    for (const status of ['SCORED', 'REPORT_READY']) {
      expect(rules.isEligibleDomain(status, score(state))).toBe(true);
      expect(() => rules.assertPriorityEligible(status, score(state))).not.toThrow();
    }
  });

  test.each(['S0', 'S1', 'SH'])('%s is never eligible (insufficient, research-only and held domains)', (state) => {
    expect(rules.isEligibleDomain('SCORED', score(state))).toBe(false);
    expect(() => rules.assertPriorityEligible('SCORED', score(state))).toThrow(expect.objectContaining({ status: 422, code: 'PRIORITY_NOT_ELIGIBLE' }));
  });

  test('a missing score, a null score and a non-scored attempt are refused', () => {
    expect(rules.isEligibleDomain('SCORED', null)).toBe(false);
    expect(rules.isEligibleDomain('SCORED', { rawScore: null, scoreStatus: 'S2' })).toBe(false);
    for (const status of ['SUBMITTED', 'QUALITY_HOLD', 'INVALID', 'IN_PROGRESS', 'CREATED']) expect(rules.isEligibleDomain(status, score('S2'))).toBe(false);
  });
});

describe('participant choice (PG-05, B07-040/041)', () => {
  test('at most three priorities can be selected', () => {
    expect(rules.MAX_SELECTED).toBe(3);
    for (const n of [0, 1, 2]) expect(() => rules.assertCanSelect(n)).not.toThrow();
    for (const n of [3, 4]) expect(() => rules.assertCanSelect(n)).toThrow(expect.objectContaining({ code: 'PRIORITY_NOT_ELIGIBLE' }));
  });

  test('a goal comes only from a selected priority', () => {
    expect(() => rules.assertGoalFromSelected({ participantSelected: true })).not.toThrow();
    expect(() => rules.assertGoalFromSelected({ participantSelected: false })).toThrow(expect.objectContaining({ code: 'PRIORITY_NOT_ELIGIBLE' }));
  });
});

describe('observable goals (PG-06)', () => {
  test('behaviours are accepted', () => {
    for (const text of ['Ask one clarifying question in each group discussion', 'Write down three things I noticed after class', 'Take a five minute walk before I study']) expect(() => rules.assertObservableGoal(text)).not.toThrow();
  });

  test('trait, feeling and one-or-two-word goals are refused as VALIDATION_ERROR (400)', () => {
    for (const text of ['Be confident', 'become more confident at school', 'I want to feel happy', 'Get better', 'Stay motivated', 'Try', 'be calm']) {
      expect(() => rules.assertObservableGoal(text)).toThrow(expect.objectContaining({ status: 400, code: 'VALIDATION_ERROR' }));
    }
  });
});

describe('a selected action (PG-07..PG-09, B07-046, 048..051)', () => {
  test('an ACTIVE action of the priority\'s domain is selectable', () => {
    expect(() => rules.assertActionSelectable('C1', action(), null)).not.toThrow();
  });

  test('an unknown, inactive or other-domain action is refused', () => {
    for (const bad of [null, undefined, action({ active: false }), action({ domain_code: 'C2' })]) {
      expect(() => rules.assertActionSelectable('C1', bad, null)).toThrow(expect.objectContaining({ code: 'PRIORITY_NOT_ELIGIBLE' }));
    }
  });

  test('B07-049 / B07-050 held-interpretation actions (Self-Worth C4.2, Savoring C2.10, a reporting hold or an interpretation-hold control) are never selectable', () => {
    const held = [
      action({ domain_code: 'C4', subdomain_code: 'C4.2' }), action({ domain_code: 'C2', subdomain_code: 'C2.10' }),
      action({ evidence_status: 'REPORTING HOLD - pilot only' }), action({ control_flags: { control: 'Interpretation hold' } }),
    ];
    for (const a of held) expect(() => rules.assertActionSelectable(a.domain_code, a, 'a fallback plan')).toThrow(expect.objectContaining({ code: 'PRIORITY_NOT_ELIGIBLE' }));
  });

  test('B07-048 an action whose library control starts "Safety/context" needs a fallback / support plan on the goal', () => {
    const a = action({ domain_code: 'C3', control_flags: { control: 'Safety/context - relational risk' } });
    expect(() => rules.assertActionSelectable('C3', a, undefined)).toThrow(expect.objectContaining({ code: 'PRIORITY_NOT_ELIGIBLE' }));
    expect(() => rules.assertActionSelectable('C3', a, 'If it feels unsafe I will stop and ask a trusted adult')).not.toThrow();
  });

  test('B07-051 a resilience (C6) action with an anti-stoicism control is an ordinary selectable action', () => {
    expect(() => rules.assertActionSelectable('C6', action({ domain_code: 'C6', control_flags: { control: 'Anti-stoicism' } }), null)).not.toThrow();
  });
});
