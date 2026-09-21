/*
 * Growth Plan Engine API (BUILD 07 sections 11-12: B07-038, 040, 041, 046, 048..051; PG-05..PG-10) on MongoDB. Through the real app
 * and the runtime credential on the SCRATCH database. The plan is invisible until the prescriptive release (developmentRelease switch
 * ON + a PRIORITY section on the report), so every scenario switches the release on first.
 */
const { v4: uuidv4 } = require('uuid');
const p = require('../helpers/contractPipeline');
const store = require('../../../src/modules/santulan/store');
const { closeClient } = require('../../../src/modules/santulan/store/client');

const { f, H, P, F, api, get, post, internal, scoredAttempt, approveRules, clearRules, activateActions, generate, growthPlanOf, ZERO_ID } = p;
const plan = (id, who) => get(`/growth-plans/${id}`, who);
const priorities = (id, who, body) => post(`/growth-plans/${id}/priorities`, who, body);
const goals = (id, who, body) => post(`/growth-plans/${id}/goals`, who, body);
const GOAL = { goalText: 'Ask one clarifying question in each group discussion', cue: 'When a group discussion starts', response: 'I will ask one clarifying question' };
const count = async (coll, filter) => (await H.admin()).collection(coll).countDocuments(filter);

beforeAll(async () => { await p.openAdolescentSet(); });
beforeEach(() => P.approveWording(p.currentSet().setId));
afterEach(async () => { await clearRules(); await p.resetSwitches(); });
afterAll(async () => { await f.closeOpenSets(); await f.cleanupFixtures(); await closeClient(); await H.closeAll(); });

/** A released plan: approved PRIORITY rules for C1-C4, an S2 attempt, the report generated, the development release ON. */
async function releasedPlan({ hold = [] } = {}) {
  await approveRules(['C1', 'C2', 'C3', 'C4'].map((d) => ({ domain: d, layer: 'PRIORITY', text: `A capability I may want to strengthen (${d}).` })));
  const a = await scoredAttempt({ s2: true, hold });
  const made = await generate(a.id);
  expect(made.body.state).toBe('REPORT_READY');
  const row = await growthPlanOf(a.id);
  await p.setSwitch('developmentRelease', true);
  const view = (await plan(row._id, a.p)).body;
  return { a, planId: row._id, view, by: (domain) => view.priorities.find((x) => x.domain === domain) };
}

/** Adds a priority row for a domain to a plan (as the migrator; a fixture for the ceiling / replace scenarios). */
async function addPriority(planId, domain) {
  const doc = { _id: uuidv4(), plan_id: planId, domain_code: domain, candidate_rank: null, participant_selected: false, priority_text: 'A capability I may want to strengthen.', created_at: new Date() };
  await (await H.admin()).collection('growth_priorities').insertOne(doc);
  return doc._id;
}

describe('generation and the participant view (PG-01..PG-05)', () => {
  test('candidates come only from approved PRIORITY rules for reportable domains, ranked, at most three, with no score or evidence data', async () => {
    const { a, view } = await releasedPlan();
    expect(view.status).toBe('DRAFT');
    expect(view.priorities.map((x) => [x.domain, x.rank, x.selected])).toEqual([['C1', 1, false], ['C2', 2, false], ['C3', 3, false]]); // 4 approved rules, top 3 shown (PG-05)
    expect(view.priorities[0].text).toBe('A capability I may want to strengthen (C1).'); // verbatim approved text
    expect(view.priorities.every((x) => x.goal === null)).toBe(true);
    expect(JSON.stringify(view)).not.toMatch(/score|evidence|S[0-5]\b|rawScore|completeness|pathway|P5|safeguard/i);
    expect((await get(`/growth-plans/${ZERO_ID}`, a.p)).status).toBe(404);
    expect((await get('/growth-plans/not-a-uuid', a.p)).status).toBe(404);
  });

  test('B07-038 a held interpretation (C1, C4 = SH) never becomes a candidate, and a participant credential cannot add one', async () => {
    const { a, planId, view } = await releasedPlan({ hold: ['C1', 'C4'] });
    expect(view.priorities.map((x) => x.domain)).toEqual(['C2', 'C3']);
    const doc = { _id: uuidv4(), plan_id: planId, domain_code: 'C4', candidate_rank: null, participant_selected: true, priority_text: 'x', created_at: new Date() };
    await expect(store.withScope(store.participantScope(a.p.participantId), (tx) => tx.c.growth_priorities.insertOne(doc), { transaction: true })).rejects.toBeTruthy();
    expect(await count('growth_priorities', { _id: doc._id })).toBe(0);
  });

  test('no approved PRIORITY rule means no plan at all (the engine never writes its own prose)', async () => {
    const a = await scoredAttempt({ s2: true });
    const made = await generate(a.id);
    expect(made.body.state).toBe('REPORT_READY');
    expect(await growthPlanOf(a.id)).toBeNull();
  });

  test('the plan is invisible (404) until the development release switch is ON', async () => {
    const { a, planId } = await releasedPlan();
    expect((await plan(planId, a.p)).status).toBe(200);
    await p.setSwitch('developmentRelease', false);
    expect((await plan(planId, a.p)).status).toBe(404);
    expect((await priorities(planId, a.p, { priorityId: ZERO_ID, selected: true })).status).toBe(404);
  });

  test('access: participant token only; another participant and an admin cannot see the plan', async () => {
    const { planId } = await releasedPlan();
    const other = await scoredAttempt({ s2: true });
    const admin = await f.admin();
    expect((await plan(planId, other.p)).status).toBe(404);
    expect((await plan(planId, admin)).status).toBe(403);
    expect((await api().get(`/api/v1/growth-plans/${planId}`)).status).toBe(401);
    expect((await priorities(planId, other.p, { priorityId: ZERO_ID, selected: true })).status).toBe(404);
  });

  test('generation is idempotent: a second run for the same attempt changes nothing', async () => {
    const { a, planId } = await releasedPlan();
    const { generatePlan } = require('../../../src/modules/santulan/growth/growthService');
    expect(await generatePlan(a.id)).toMatchObject({ planId, created: false });
    expect(await count('growth_plans', { source_attempt_id: a.id })).toBe(1);
    expect(await count('growth_priorities', { plan_id: planId })).toBe(3);
  });
});

describe('participant choice (PG-05, B07-040, B07-041)', () => {
  test('the participant selects, rejects, replaces and edits; a fourth selection is refused (PRIORITY_NOT_ELIGIBLE)', async () => {
    const { a, planId, by } = await releasedPlan();
    for (const d of ['C1', 'C2', 'C3']) expect((await priorities(planId, a.p, { priorityId: by(d).id, selected: true })).status).toBe(200);
    const fourth = await addPriority(planId, 'C4');
    const refused = await priorities(planId, a.p, { priorityId: fourth, selected: true });
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('PRIORITY_NOT_ELIGIBLE');

    expect((await priorities(planId, a.p, { priorityId: by('C3').id, selected: false })).status).toBe(200); // reject
    const replaced = await priorities(planId, a.p, { priorityId: by('C2').id, replaceWithPriorityId: fourth }); // replace
    expect(replaced.status).toBe(200);
    expect(replaced.body.priorities.filter((x) => x.selected).map((x) => x.domain).sort()).toEqual(['C1', 'C4']);
    const edited = await priorities(planId, a.p, { priorityId: by('C1').id, priorityText: 'In my own words: notice my energy' }); // edit
    expect(edited.body.priorities.find((x) => x.domain === 'C1').text).toBe('In my own words: notice my energy');

    expect((await priorities(planId, a.p, { priorityId: by('C1').id })).status).toBe(400); // nothing to change
    expect((await priorities(planId, a.p, { priorityId: by('C1').id, selected: true, domain: 'C5' })).status).toBe(400); // strict: no re-pointing
    expect((await priorities(planId, a.p, { priorityId: ZERO_ID, selected: true })).status).toBe(404);
    const c2 = await (await H.admin()).collection('growth_priorities').findOne({ plan_id: planId, domain_code: 'C2' });
    expect(c2.priority_text).toBe('A capability I may want to strengthen (C2).'); // the unchosen candidate is untouched
  });

  test('two simultaneous selections never exceed three chosen priorities', async () => {
    const { a, planId, by } = await releasedPlan();
    await priorities(planId, a.p, { priorityId: by('C1').id, selected: true });
    await priorities(planId, a.p, { priorityId: by('C2').id, selected: true });
    const extra = await addPriority(planId, 'C4');
    const results = await Promise.all([priorities(planId, a.p, { priorityId: by('C3').id, selected: true }), priorities(planId, a.p, { priorityId: extra, selected: true })]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status !== 200).every((r) => [409, 422, 503].includes(r.status))).toBe(true);
    expect(await count('growth_priorities', { plan_id: planId, participant_selected: true })).toBe(3);
  });
});

describe('goals, If-Then plans and actions (PG-06..PG-09, B07-046, 048..051)', () => {
  test('a goal needs a selected priority and observable wording; it can be edited and never duplicates; the plan becomes ACTIVE', async () => {
    const { a, planId, by } = await releasedPlan();
    const c1 = by('C1').id;
    expect((await goals(planId, a.p, { priorityId: c1, ...GOAL })).status).toBe(422); // not selected yet
    await priorities(planId, a.p, { priorityId: c1, selected: true });
    for (const goalText of ['Be more confident', 'feel happy about school', 'become calm', 'Try']) {
      const res = await goals(planId, a.p, { priorityId: c1, ...GOAL, goalText });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect((await goals(planId, a.p, { priorityId: c1, goalText: GOAL.goalText })).status).toBe(400); // If-Then (cue + response) is required
    const saved = await goals(planId, a.p, { priorityId: c1, ...GOAL, frequency: 'Twice a week', reviewDate: '2030-01-31' });
    expect(saved.status).toBe(200);
    expect(saved.body.status).toBe('ACTIVE');
    expect(saved.body.priorities.find((x) => x.domain === 'C1').goal).toMatchObject({ goalText: GOAL.goalText, cue: GOAL.cue, response: GOAL.response, frequency: 'Twice a week', reviewDate: '2030-01-31', status: 'PLANNED', actions: [] });
    const edited = await goals(planId, a.p, { priorityId: c1, ...GOAL, response: 'I will ask a clarifying question at least once' });
    expect(edited.body.priorities.find((x) => x.domain === 'C1').goal.response).toBe('I will ask a clarifying question at least once');
    expect(await count('growth_goals', { priority_id: c1 })).toBe(1);
  });

  test('B07-046 a selected action stores the source action code + version and the participant\'s own wording; the library text is untouched', async () => {
    const { a, planId, by } = await releasedPlan();
    const [action] = await activateActions('C1');
    await priorities(planId, a.p, { priorityId: by('C1').id, selected: true });
    const own = `${action.action_text} (after lunch, in the library)`;
    const res = await goals(planId, a.p, { priorityId: by('C1').id, ...GOAL, action: { code: action.action_code, version: action.library_version, text: own } });
    expect(res.status).toBe(200);
    expect(res.body.priorities.find((x) => x.domain === 'C1').goal.actions).toEqual([{ code: action.action_code, version: action.library_version, text: own }]);
    await goals(planId, a.p, { priorityId: by('C1').id, ...GOAL, action: { code: action.action_code, version: action.library_version, text: own } }); // saving again does not duplicate
    const goal = await (await H.admin()).collection('growth_goals').findOne({ priority_id: by('C1').id });
    expect(await count('growth_actions', { goal_id: goal._id })).toBe(1);
    expect((await (await H.admin()).collection('development_actions').findOne({ action_code: action.action_code, library_version: action.library_version })).action_text).toBe(action.action_text);
  });

  test('an inactive action, an unknown action or one from another domain is refused', async () => {
    const { a, planId, by } = await releasedPlan();
    const [c1] = await activateActions('C1');
    const inactive = await (await H.admin()).collection('development_actions').findOne({ domain_code: 'C2', active: false });
    await priorities(planId, a.p, { priorityId: by('C2').id, selected: true });
    const body = (action) => ({ priorityId: by('C2').id, ...GOAL, action });
    for (const action of [{ code: inactive.action_code, version: inactive.library_version }, { code: 'DAL-999', version: 'DRM-v1.1' }, { code: c1.action_code, version: c1.library_version }]) {
      const res = await goals(planId, a.p, body(action));
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('PRIORITY_NOT_ELIGIBLE');
    }
  });

  test('B07-048 a relational (C3) action that needs safety/context handling is refused until the goal carries a fallback / support plan', async () => {
    const { a, planId, by } = await releasedPlan();
    const c3 = (await activateActions('C3')).find((x) => /^Safety\/context/i.test(x.control_flags.control || ''));
    expect(c3).toBeTruthy();
    await priorities(planId, a.p, { priorityId: by('C3').id, selected: true });
    const action = { code: c3.action_code, version: c3.library_version };
    const bare = await goals(planId, a.p, { priorityId: by('C3').id, ...GOAL, action });
    expect(bare.status).toBe(422);
    expect(bare.body.error.code).toBe('PRIORITY_NOT_ELIGIBLE');
    const safe = await goals(planId, a.p, { priorityId: by('C3').id, ...GOAL, fallbackAction: 'If it feels unsafe I will stop and ask a trusted adult or counsellor for support', action });
    expect(safe.status).toBe(200);
  });

  test('B07-049 / B07-050 held-interpretation actions (Self-Worth C4.2, Savoring C2.10) are never selectable', async () => {
    const { a, planId, by } = await releasedPlan();
    const c4 = await addPriority(planId, 'C4');
    const held = [...(await activateActions('C4')), ...(await activateActions('C2'))].filter((x) => ['C4.2', 'C2.10'].includes(x.subdomain_code));
    expect(held.length).toBeGreaterThanOrEqual(6);
    await priorities(planId, a.p, { priorityId: c4, selected: true });
    await priorities(planId, a.p, { priorityId: by('C2').id, selected: true });
    for (const x of held) {
      const priorityId = x.subdomain_code === 'C4.2' ? c4 : by('C2').id;
      const res = await goals(planId, a.p, { priorityId, ...GOAL, action: { code: x.action_code, version: x.library_version } });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('PRIORITY_NOT_ELIGIBLE');
    }
    const goalIds = (await (await H.admin()).collection('growth_goals').find({ priority_id: { $in: [c4, by('C2').id] } }).toArray()).map((g) => g._id);
    expect(await count('growth_actions', { goal_id: { $in: goalIds } })).toBe(0);
  });

  test('B07-051 resilience (C6) actions are selectable and the library carries no stoicism / suppression instruction', async () => {
    const { a, planId } = await releasedPlan();
    const c6 = await addPriority(planId, 'C6');
    const actions = await activateActions('C6');
    expect(actions.some((x) => /^Anti-stoicism/i.test(x.control_flags.control || ''))).toBe(true);
    for (const x of actions) expect(x.action_text).not.toMatch(/suppress|push through|tough it out|ignore (?:your )?(?:feelings|emotions)|stay strong|stoic/i);
    await priorities(planId, a.p, { priorityId: c6, selected: true });
    const res = await goals(planId, a.p, { priorityId: c6, ...GOAL, action: { code: actions[0].action_code, version: actions[0].library_version } });
    expect(res.status).toBe(200);
  });
});

describe('reviews, and the plan while a safeguarding pathway is active (PG-10, BUILD 07 section 15)', () => {
  test('a review is unscored: no number or score-like field is accepted, and it must belong to a goal of this plan', async () => {
    const { a, planId, by } = await releasedPlan();
    await priorities(planId, a.p, { priorityId: by('C1').id, selected: true });
    const saved = await goals(planId, a.p, { priorityId: by('C1').id, ...GOAL });
    const goalId = saved.body.priorities.find((x) => x.domain === 'C1').goal.id;
    const review = { goalId, reviewDate: '2030-02-01', whatHappened: 'I asked twice', barrier: 'Felt rushed', learning: 'Prepare a question first', adjustment: 'Write it down', nextStep: 'Try again Monday' };
    expect((await post(`/growth-plans/${planId}/reviews`, a.p, review)).status).toBe(200);
    for (const extra of [{ score: 4 }, { rating: 5 }, { progressPercent: 80 }, { reliableChange: true }]) expect((await post(`/growth-plans/${planId}/reviews`, a.p, { ...review, ...extra })).status).toBe(400);
    expect((await post(`/growth-plans/${planId}/reviews`, a.p, { ...review, goalId: ZERO_ID })).status).toBe(404);
    expect(await count('growth_reviews', { goal_id: goalId })).toBe(1);
  });

  test('B07-060 when P5 fires the ACTIVE plan pauses: it can no longer be edited, and nothing about the pathway is exposed', async () => {
    const { a, planId, by } = await releasedPlan();
    await priorities(planId, a.p, { priorityId: by('C1').id, selected: true });
    await goals(planId, a.p, { priorityId: by('C1').id, ...GOAL }); // plan is ACTIVE
    const fired = await internal('post', `/internal/attempts/${a.id}/pathways`, { pathwayCode: 'P5', triggerCode: 'Q09', decisionSource: 'SYSTEM' });
    expect(fired.status).toBe(200);
    const shown = await plan(planId, a.p);
    expect(shown.status).toBe(200);
    expect(shown.body.status).toBe('PAUSED');
    expect(JSON.stringify(shown.body)).not.toMatch(/P5|safeguard|crisis|Q09|escalat/i);
    const blocked = await priorities(planId, a.p, { priorityId: by('C2').id, selected: true });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('INVALID_STATE');
    expect((await goals(planId, a.p, { priorityId: by('C1').id, ...GOAL })).status).toBe(422);
  });
});
