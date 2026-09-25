/*
 * Scoring master end to end (spec US8 acceptance 1-11; SC-015..SC-022): attempt -> answers -> submit -> quality -> score -> report through
 * the real endpoints on the SCRATCH database, with the governed switches and the governed wording loader. The set has 10 core questions per
 * domain so completeness can be 100 / 90 / 80 / 60 %.
 */
const request = require('supertest');
const app = require('../../../src/app');
const f = require('../helpers/committed');
const H = require('../helpers/mongoHarness');
const P = require('../helpers/pipeline');
const { scanClaims } = require('../helpers/claimsScanner');
const { loadWording } = require('../../../scripts/wording-load');
const { closeClient } = require('../../../src/models/db/client');

const INTERNAL = { 'X-Internal-Api-Key': 'test-internal-key' };
const DOMAINS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'];
const LAYERS = ['MEANING', 'PATTERN', 'STRENGTH', 'GROWTH'];
const api = () => request(app);
const auth = (who) => ({ Authorization: `Bearer ${who.token}` });
const post = (p, who, body = {}) => api().post(`/api/v1${p}`).set(auth(who)).send(body);
const get = (p, who) => api().get(`/api/v1${p}`).set(auth(who));
const internal = (method, p, body) => api()[method](`/api/v1${p}`).set(INTERNAL).send(body);

let S;
let admin;
beforeAll(async () => { S = await f.openSet({ ageGroup: 'ADOLESCENT', perDomain: 10 }); admin = await f.admin(); });
afterAll(async () => {
  for (const flag of ['pilotS2', 'advancedEvidence', 'developmentRelease', 'pathwayRelease']) await post(`/admin/release-flags/${flag}`, admin, { value: false, reason: 'reset after tests' });
  await (await H.admin()).collection('audit_logs').deleteMany({ action_type: 'WORDING_APPROVED' });
  await f.closeOpenSets(); await f.cleanupFixtures(); await closeClient(); await H.closeAll();
});

/** answer(item) -> position | null; runs the whole journey through the endpoints and returns the ids and score rows. */
async function journey(answer = () => 3) {
  const p = await f.participant(15);
  const created = await post('/attempts', p);
  expect(created.status).toBe(201);
  const id = created.body.attemptId;
  expect((await post(`/attempts/${id}/sessions/resume`, p)).status).toBe(200);
  await f.answerAll(id, answer);
  expect((await post(`/attempts/${id}/submit`, p, { submissionKey: `sub-${f.u()}-${f.u()}` })).status).toBe(200);
  expect((await internal('post', `/internal/attempts/${id}/quality`, {})).body.outcome).toBe('CLEAR');
  expect((await internal('post', `/internal/attempts/${id}/score`, { scoringVersion: 'domain-mean-v1' })).body.outcome).toBe('SCORED');
  return { p, id, scores: await P.scoresOf(id) };
}
/** Answers the first `n` questions of every domain (in display order) with position 4, leaves the rest unanswered. */
const firstN = (n) => { const seen = {}; return (i) => { seen[i.domainCode] = (seen[i.domainCode] || 0) + 1; return seen[i.domainCode] <= n ? 4 : null; }; };
const flip = (flag, value, reason) => post(`/admin/release-flags/${flag}`, admin, { value, reason });

describe('the four statuses through the endpoints (SC-015, SC-016)', () => {
  test.each([
    [10, 'COMPLETE', 'S1', 4], [9, 'COMPLETE_WITH_MISSING', 'S1', 4], [8, 'INCOMPLETE', 'S1', 4], [6, 'INSUFFICIENT', 'S0', null],
  ])('%i of 10 answered in every domain is %s (default evidence %s)', async (answered, status, evidence, mean) => {
    const a = await journey(firstN(answered));
    expect(a.scores).toHaveLength(7);
    for (const s of a.scores) {
      expect(s).toMatchObject({ completeness_status: status, score_status: evidence, valid_items: answered, eligible_items: 10, raw_score: mean });
      expect(s.completeness_rate).toBeCloseTo(answered / 10, 5);
    }
    const flags = (await internal('get', `/internal/attempts/${a.id}/quality-flags`)).body.flags;
    const q07 = flags.filter((x) => x.code === 'Q07').map((x) => x.domainCode).sort();
    expect(q07).toEqual(['INCOMPLETE', 'INSUFFICIENT'].includes(status) ? DOMAINS : []); // Q07 is raised for every incomplete or insufficient domain
    expect((await get(`/attempts/${a.id}/scores`, a.p)).status).toBe(404); // the participant score endpoint is withdrawn
  });
});

describe('the release switches, the fail-closed report and governed wording (SC-017..SC-022)', () => {
  test('all switches off: every domain S1, the report is the PROFILE only (seven NOT_ENOUGH_DATA) and carries no capability wording', async () => {
    const a = await journey();
    expect(a.scores.every((s) => s.score_status === 'S1')).toBe(true);
    const made = await internal('post', `/internal/attempts/${a.id}/report`, {});
    expect(made.body.state).toBe('REPORT_READY');
    const shown = await get(`/reports/${made.body.reportId}`, a.p);
    expect(shown.status).toBe(200);
    expect(shown.body.sections.map((s) => s.type)).toEqual(['PROFILE']);
    const profile = JSON.parse(shown.body.sections[0].content);
    expect(profile.domains).toHaveLength(7);
    expect(profile.domains.every((d) => d.display === 'NOT_ENOUGH_DATA' && d.score === null)).toBe(true);
    expect(scanClaims(shown.body)).toEqual([]);
  });

  test('pilotS2 on gives S2; with NO approved wording the report ends FAILED_RETRYABLE (WORDING_MISSING) and the attempt stays SCORED; governed wording then completes it on retry', async () => {
    await flip('pilotS2', true, 'pilot week one approved');
    const a = await journey(() => 4);
    expect(a.scores.every((s) => s.score_status === 'S2' && s.raw_score === 4)).toBe(true);
    const made = await internal('post', `/internal/attempts/${a.id}/report`, {});
    expect(made.body.state).toBe('FAILED_RETRYABLE');
    const row = await (await H.admin()).collection('reports').findOne({ _id: made.body.reportId });
    expect(row).toMatchObject({ last_error_code: 'WORDING_MISSING', content_hash: null });
    expect((await P.attemptOf(a.id)).status).toBe('SCORED');
    expect((await get(`/reports/${made.body.reportId}`, a.p)).body.error.code).toBe('REPORT_NOT_READY');

    // governed loading: one approved wording per S2 domain and layer (as scripts/wording-load.js --approve does)
    const rules = DOMAINS.flatMap((domain) => LAYERS.map((layer) => ({ domain, band: null, evidenceState: 'S2', locale: 'en', layer, version: 'e2e-v1', text: `Approved ${layer.toLowerCase()} wording for ${domain}.` })));
    const spec = { questionSet: S.label, revision: 1, rules };
    const client = await H.rawAdminClient();
    expect(await loadWording(client, H.DB_NAME, spec, { approve: true })).toMatchObject({ inserted: 28, approved: 28 });

    const retried = await internal('post', `/internal/reports/${made.body.reportId}/retry`, {});
    expect(retried.body).toMatchObject({ state: 'REPORT_READY', retryCount: 1 });
    const done = await (await H.admin()).collection('reports').findOne({ _id: made.body.reportId });
    expect(done.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await P.attemptOf(a.id)).status).toBe('REPORT_READY');
    const shown = await get(`/reports/${made.body.reportId}`, a.p);
    expect(shown.status).toBe(200);
    expect(shown.body.sections.filter((s) => s.type !== 'PROFILE')).toHaveLength(28);
    expect(JSON.parse(shown.body.sections[0].content).domains.every((d) => d.display === 'PLOTTED' && d.score === 4)).toBe(true);
    expect(scanClaims(shown.body)).toEqual([]);

    // a second approved wording for the same dimension is refused
    const again = { ...spec, rules: [{ ...rules[0], version: 'e2e-v2', text: 'A competing wording.' }] };
    await expect(loadWording(client, H.DB_NAME, again, { approve: true })).rejects.toThrow(/second approved wording/);
  });

  test('every switch change is in the audit log with its reason, actor and value; the reports and scores of participants contain no claims', async () => {
    await flip('pilotS2', true, 'audit trail check on');
    await flip('pilotS2', false, 'audit trail check off');
    const rows = await (await H.admin()).collection('audit_logs').find({ action_type: 'RELEASE_FLAG_CHANGED', target_entity: 'release_flag:pilotS2', reason: /^audit trail check/ }).sort({ occurred_at: 1 }).toArray();
    expect(rows.map((r) => [r.reason, r.new_state.value, r.actor_id])).toEqual([['audit trail check on', true, admin.adminUserId], ['audit trail check off', false, admin.adminUserId]]);
    const list = await get('/admin/release-flags', admin);
    expect(list.body.pilotS2).toMatchObject({ value: false, reason: 'audit trail check off' });
    expect(scanClaims(list.body)).toEqual([]);
  });
});
