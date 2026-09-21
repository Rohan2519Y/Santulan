/*
 * Staged release (B07-078, 079, AT-18; BUILD 07 section 10) on MongoDB. The prescriptive layers - PRIORITY, ACTION, the growth plan
 * and the P1-P4 pathway decisions - are generated and stored while a real participant sees only the descriptive layers. The release is
 * the audited developmentRelease switch: flipping it (data, no deploy, no restart) changes visibility and NOTHING else - every stored
 * snapshot, its released flag and the report fingerprint stay byte-identical.
 */
const p = require('../helpers/contractPipeline');
const rules = require('../../../src/modules/santulan/domain/reportRules');
const { closeClient } = require('../../../src/modules/santulan/store/client');

const { f, H, P, get, post, internal, scoredAttempt, approveRules, clearRules, activateActions, generate, growthPlanOf, flipViaApi, ZERO_ID } = p;

const DESCRIPTIVE = ['PROFILE', 'MEANING', 'PATTERN', 'STRENGTH', 'GROWTH'];
const layersOf = (body) => [...new Set(body.sections.map((s) => s.type))];
const stored = async (reportId) => (await P.sectionsOf(reportId)).map((s) => `${s.section_type}:${s.domain_code}:${s.content_version}:${s.is_released_to_participant}:${s.content_snapshot}`);

beforeAll(async () => { await p.openAdolescentSet(); });
beforeEach(() => P.approveWording(p.currentSet().setId));
afterEach(async () => { await clearRules(); await p.resetSwitches(); });
afterAll(async () => { await f.closeOpenSets(); await f.cleanupFixtures(); await closeClient(); await H.closeAll(); });

async function syntheticPipeline() {
  await approveRules([
    { domain: 'C1', layer: 'PRIORITY', text: 'A capability I may want to strengthen: noticing my energy levels.' },
    { domain: 'C2', layer: 'PRIORITY', text: 'A capability I may want to strengthen: pausing before I respond.' },
  ]);
  await activateActions('C1');
  const a = await scoredAttempt({ s2: true });
  const made = await generate(a.id);
  expect(made.body.state).toBe('REPORT_READY');
  const plan = await growthPlanOf(a.id);
  return { a, reportId: made.body.reportId, planId: plan && plan._id };
}

describe('the prescriptive pipeline is generated and stored, but hidden (B07-078, B07-079)', () => {
  test('B07-078 PRIORITY, ACTION, the growth plan and P1-P4 exist in the database while the participant sees only the descriptive layers', async () => {
    const { a, reportId, planId } = await syntheticPipeline();

    // stored: hidden prescriptive sections, a DRAFT growth plan with ranked candidates, nothing selected yet
    const sections = await P.sectionsOf(reportId);
    expect(sections.filter((s) => s.is_released_to_participant).map((s) => s.section_type).every((t) => DESCRIPTIVE.includes(t))).toBe(true);
    expect(sections.filter((s) => !s.is_released_to_participant).map((s) => `${s.section_type}:${s.domain_code}`)).toEqual(['PRIORITY:C1', 'PRIORITY:C2', 'ACTION:C1']);
    expect(planId).toBeTruthy();
    const db = await H.admin();
    const candidates = await db.collection('growth_priorities').find({ plan_id: planId }).sort({ candidate_rank: 1 }).toArray();
    expect(candidates.map((c) => [c.domain_code, c.candidate_rank, c.participant_selected])).toEqual([['C1', 1, false], ['C2', 2, false]]);

    // P1-P4 are generated for the attempt (P1 needs a participant-selected priority: the choice is made as the server would after release)
    await db.collection('growth_priorities').updateOne({ plan_id: planId, domain_code: 'C1' }, { $set: { participant_selected: true } });
    const decide = (body) => internal('post', `/internal/attempts/${a.id}/pathways`, body);
    expect((await decide({ pathwayCode: 'P1', triggerCode: 'SELECTED_PRIORITY', decisionSource: 'SYSTEM', domainCode: 'C1' })).body).toMatchObject({ created: true, status: 'S1' });
    expect((await decide({ pathwayCode: 'P2', triggerCode: 'PARTICIPANT_REQUEST', decisionSource: 'PARTICIPANT' })).body.created).toBe(true);
    expect((await decide({ pathwayCode: 'P3', triggerCode: 'PARTICIPANT_REQUEST', decisionSource: 'PARTICIPANT' })).body.created).toBe(true);
    expect((await decide({ pathwayCode: 'P4', triggerCode: 'AUTHORISED_REFERRAL', decisionSource: 'HUMAN_REVIEW' })).body.created).toBe(true);
    expect((await db.collection('pathway_decisions').find({ source_attempt_id: a.id }).sort({ pathway_code: 1 }).toArray()).map((r) => r.pathway_code)).toEqual(['P1', 'P2', 'P3', 'P4']);

    // ...and none of it reaches the participant
    const report = await get(`/reports/${reportId}`, a.p);
    expect(report.status).toBe(200);
    expect(layersOf(report.body)).toEqual(DESCRIPTIVE);
    expect(JSON.stringify(report.body)).not.toMatch(/PRIORITY|ACTION|strengthen|P[1-5]\b|pathway/i);
    expect((await get(`/growth-plans/${planId}`, a.p)).status).toBe(404);
    for (const path of ['priorities', 'goals', 'reviews']) expect((await post(`/growth-plans/${planId}/${path}`, a.p, {})).status).toBe(400); // strict schemas run first
    expect((await post(`/growth-plans/${planId}/priorities`, a.p, { priorityId: ZERO_ID, selected: true })).status).toBe(404);
  });

  test('B07-079 a real pilot participant with the release off sees the descriptive report and none of the prescriptive content', async () => {
    const { a, reportId } = await syntheticPipeline();
    const shown = (await get(`/reports/${reportId}`, a.p)).body;
    expect(shown.state).toBe('REPORT_READY');
    expect(layersOf(shown)).toEqual(DESCRIPTIVE);
  });
});

describe('flipping the release is data, not code (B07-078, AT-18)', () => {
  test('switching the release on changes visibility only: every stored snapshot and the fingerprint are byte-identical, no restart, and it can be withdrawn again', async () => {
    const { a, reportId, planId } = await syntheticPipeline();
    const before = await stored(reportId);
    const hash = (await (await H.admin()).collection('reports').findOne({ _id: reportId })).content_hash;
    expect(layersOf((await get(`/reports/${reportId}`, a.p)).body)).toEqual(DESCRIPTIVE);
    expect((await get(`/growth-plans/${planId}`, a.p)).status).toBe(404);

    expect((await flipViaApi('developmentRelease', true, 'development release approved')).status).toBe(200); // the authorised release: an audited switch, same process, no deploy
    expect(await stored(reportId)).toEqual(before);
    const released = await get(`/reports/${reportId}`, a.p);
    expect(layersOf(released.body)).toEqual([...DESCRIPTIVE, 'PRIORITY', 'ACTION']);
    expect(released.body.sections.filter((s) => s.type === 'PRIORITY').map((s) => s.domain)).toEqual(['C1', 'C2']);
    expect(released.body.sections.find((s) => s.type === 'ACTION').content).toMatch(/"code":"DAL-/); // the approved library action, verbatim
    const plan = await get(`/growth-plans/${planId}`, a.p);
    expect(plan.status).toBe(200);
    expect(plan.body.priorities.map((x) => x.domain)).toEqual(['C1', 'C2']);

    expect((await flipViaApi('developmentRelease', false, 'development release withdrawn')).status).toBe(200); // withdrawn: hidden again, still no change to any snapshot
    expect(await stored(reportId)).toEqual(before);
    expect(layersOf((await get(`/reports/${reportId}`, a.p)).body)).toEqual(DESCRIPTIVE);
    expect((await get(`/growth-plans/${planId}`, a.p)).status).toBe(404);
    expect((await (await H.admin()).collection('reports').findOne({ _id: reportId })).content_hash).toBe(hash);
    expect(hash).toBe(rules.fingerprint(await P.sectionsOf(reportId)));
  });

  test('a participant credential cannot flip a section\'s released flag or the switch', async () => {
    const { a, reportId } = await syntheticPipeline();
    const admin = await f.admin('ACTIVE', 'SUPER_ADMIN');
    expect((await post('/admin/release-flags/developmentRelease', a.p, { value: true, reason: 'attempted by participant' })).status).toBe(403);
    expect(layersOf((await get(`/reports/${reportId}`, a.p)).body)).toEqual(DESCRIPTIVE);
    expect((await post('/admin/release-flags/developmentRelease', admin, { value: true, reason: 'authorised development release' })).status).toBe(200);
    expect(layersOf((await get(`/reports/${reportId}`, a.p)).body)).toContain('PRIORITY');
  });
});
