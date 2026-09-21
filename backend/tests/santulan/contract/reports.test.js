/*
 * Report API contract (B07-009..013, 026..033, 069, 070, AT-18, RC-09..12) on MongoDB. Through the real app and the runtime
 * credential on the SCRATCH database; it opens an adolescent question set for its duration.
 */
const p = require('../helpers/contractPipeline');
const { scanClaims } = require('../helpers/claimsScanner');
const rules = require('../../../src/modules/santulan/domain/reportRules');
const { closeClient } = require('../../../src/modules/santulan/store/client');

const { f, H, P, api, post, get, internal, scoredAttempt, terminalAttempt, approveRules, clearRules, generate, attemptStatus, reportService } = p;
const failingRenderer = async () => { throw new Error('forced render failure'); };
const audit = async (targetId) => (await (await H.admin()).collection('audit_logs').find({ target_id: targetId }).sort({ occurred_at: 1 }).toArray()).map((r) => r.action_type);
const reportRow = async (id) => (await H.admin()).collection('reports').findOne({ _id: id });
const count = async (coll, filter) => (await H.admin()).collection(coll).countDocuments(filter);

beforeAll(async () => { await p.openAdolescentSet(); });
beforeEach(() => P.approveWording(p.currentSet().setId));
afterEach(async () => { await clearRules(); await p.resetSwitches(); });
afterAll(async () => { await f.closeOpenSets(); await f.cleanupFixtures(); await closeClient(); await H.closeAll(); });

describe('access and request schemas', () => {
  test('report generation and retry are internal; participant / admin / missing credentials are refused; bodies must be empty', async () => {
    const a = await scoredAttempt({ s2: true });
    const admin = await f.admin();
    const url = `/api/v1/internal/attempts/${a.id}/report`;
    expect((await api().post(url).send({})).status).toBe(403);
    expect((await api().post(url).set({ Authorization: `Bearer ${a.p.token}` }).send({})).status).toBe(403);
    expect((await api().post(url).set({ Authorization: `Bearer ${admin.token}` }).send({})).status).toBe(403); // generation is the worker's, not an admin's
    expect((await api().post(url).set({ 'X-Internal-Api-Key': 'wrong' }).send({})).status).toBe(403);
    const forged = await internal('post', `/internal/attempts/${a.id}/report`, { content: 'forged', sections: [] });
    expect(forged.status).toBe(400);
    expect(forged.body.error.code).toBe('VALIDATION_ERROR');
    expect((await internal('post', '/internal/attempts/not-a-uuid/report', {})).status).toBe(404);
    expect((await internal('post', `/internal/attempts/${p.ZERO_ID}/report`, {})).status).toBe(404);
    expect(await count('reports', { attempt_id: a.id })).toBe(0); // nothing was created by any refused call
    expect((await api().post(`/api/v1/internal/reports/${p.ZERO_ID}/retry`).send({})).status).toBe(401); // no credentials at all (the route also accepts a super admin token)
    expect((await api().post(`/api/v1/internal/reports/${p.ZERO_ID}/retry`).set({ Authorization: `Bearer ${a.p.token}` }).send({})).status).toBe(403);
  });

  test('B07-070 only the owning participant can retrieve a report: admins and institution admins are refused on the participant route', async () => {
    const a = await scoredAttempt({ s2: true });
    const { reportId } = (await generate(a.id)).body;
    const admin = await f.admin();
    const inst = await f.admin('INACTIVE', 'INSTITUTION_ADMIN');
    expect((await get(`/reports/${reportId}`, admin)).status).toBe(403);
    expect((await get(`/reports/${reportId}`, inst)).status).toBe(403);
    expect((await api().get(`/api/v1/reports/${reportId}`)).status).toBe(401);
    expect((await get('/reports/not-a-uuid', a.p)).status).toBe(404);
  });
});

describe('the participant retrieval gate and controlled retry (AT-18, RC-09, RC-10, RC-12)', () => {
  test('B07-001/004/005 a failed generation is invisible, leaves the attempt SCORED, and a retry (audited) makes it REPORT_READY without a retake or rescore', async () => {
    const a = await scoredAttempt({ s2: true });
    const scoresBefore = (await P.scoresOf(a.id)).map((s) => s._id);
    const failed = await reportService.generateReport(a.id, { correlationId: 'test-corr-failed', renderer: failingRenderer });
    expect(failed).toMatchObject({ state: 'FAILED_RETRYABLE', retryCount: 0 });
    expect(await attemptStatus(a.id)).toBe('SCORED');
    const shown = await get(`/reports/${failed.reportId}`, a.p); // B07-006 / RC-10: only ready or terminal states are visible
    expect(shown.status).toBe(404);
    expect(shown.body.error.code).toBe('REPORT_NOT_READY');
    expect(await count('report_sections', { report_id: failed.reportId })).toBe(0); // B07-076

    const retried = await internal('post', `/internal/reports/${failed.reportId}/retry`, {});
    expect(retried.status).toBe(200);
    expect(retried.body).toMatchObject({ reportId: failed.reportId, state: 'REPORT_READY', retryCount: 1 });
    expect(await attemptStatus(a.id)).toBe('REPORT_READY');
    expect((await P.scoresOf(a.id)).map((s) => s._id)).toEqual(scoresBefore);
    expect(await count('assessment_attempts', { participant_id: a.p.participantId })).toBe(1);
    expect(await count('response_events', { attempt_id: a.id, event_type: 'REPORT_RETRY' })).toBe(1);
    expect(await audit(failed.reportId)).toEqual(expect.arrayContaining(['REPORT_FAILED', 'REPORT_RETRIED', 'REPORT_GENERATED'])); // RC-12
    const ok = await get(`/reports/${failed.reportId}`, a.p);
    expect(ok.status).toBe(200);
    expect(ok.body.state).toBe('REPORT_READY');
    expect(ok.body.sections[0]).toMatchObject({ type: 'PROFILE', locale: 'en', order: 1 });
    expect((await internal('post', `/internal/reports/${failed.reportId}/retry`, {})).status).toBe(409); // no longer FAILED_RETRYABLE
  });

  test('B07-077 two simultaneous retries make exactly one transition (one 200, one refusal) and retry_count is 1', async () => {
    const a = await scoredAttempt({ s2: true });
    const failed = await reportService.generateReport(a.id, { renderer: failingRenderer });
    const admin = await f.admin();
    const [one, two] = await Promise.all([
      internal('post', `/internal/reports/${failed.reportId}/retry`, {}),
      post(`/internal/reports/${failed.reportId}/retry`, admin, {}),
    ]);
    expect([one.status, two.status].sort()).toEqual([200, 409]);
    expect((await reportRow(failed.reportId)).retry_count).toBe(1);
    expect(await count('response_events', { attempt_id: a.id, event_type: 'REPORT_RETRY' })).toBe(1);
  });

  test('the same generation request converges on one report (idempotent) and a normal report writes no export or admin side effect (B07-074)', async () => {
    const a = await scoredAttempt({ s2: true });
    const [x, y] = await Promise.all([generate(a.id), generate(a.id)]);
    expect([x.status, y.status]).toEqual([200, 200]);
    expect(x.body.reportId).toBe(y.body.reportId);
    expect(await count('reports', { attempt_id: a.id })).toBe(1);
    expect(x.body.state).toBe('REPORT_READY');
    expect(await count('report_sections', { report_id: x.body.reportId, section_type: 'PROFILE' })).toBe(1);
    expect(await count('research_exports', { requested_by: { $exists: true }, created_at: { $gt: new Date(Date.now() - 60000) }, source_assessment_version_id: p.currentSet().setId })).toBe(0);
  });

  test('B07-069 another participant\'s report is refused with the same not-ready response', async () => {
    const a = await scoredAttempt({ s2: true });
    const other = await scoredAttempt({ s2: true });
    const { reportId } = (await generate(a.id)).body;
    const res = await get(`/reports/${reportId}`, other.p);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('REPORT_NOT_READY');
  });

  test('D-M18 GET /attempts/{id} gives the participant the report id only once the report is visible to them (no other detail)', async () => {
    const a = await scoredAttempt({ s2: true });
    expect((await get(`/attempts/${a.id}`, a.p)).body.reportId).toBeNull();
    const failed = await reportService.generateReport(a.id, { renderer: failingRenderer });
    expect((await get(`/attempts/${a.id}`, a.p)).body.reportId).toBeNull(); // FAILED_RETRYABLE is not visible
    await internal('post', `/internal/reports/${failed.reportId}/retry`, {});
    const model = (await get(`/attempts/${a.id}`, a.p)).body;
    expect(model.reportId).toBe(failed.reportId);
    expect(JSON.stringify(model)).not.toMatch(/score|FAILED|retry|hash/i);
    const other = await scoredAttempt({ s2: true });
    expect((await get(`/attempts/${a.id}`, other.p)).status).toBe(404); // another participant never learns the id
  });

  test('a report can be generated only from a scored, held or invalid attempt', async () => {
    const a = await P.submittedAttempt(p.currentSet());
    const res = await generate(a.attemptId);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_STATE');
    expect(await count('reports', { attempt_id: a.attemptId })).toBe(0);
  });
});

describe('T11 and T12 are neutral (BUILD 07 sections 5-6, B07-009..013)', () => {
  const T11 = 'Your responses are being reviewed.';
  const T12 = 'This attempt could not be processed for a report.';

  test('B07-009/010/011 every quality-hold reason, Q09 included, yields the identical T11 report with no flag code, severity or rationale', async () => {
    const plain = await terminalAttempt('QUALITY_HOLD');
    const safeguarding = await terminalAttempt('QUALITY_HOLD', { q09: true });
    const views = [];
    for (const a of [plain, safeguarding]) {
      const made = await generate(a.id);
      expect(made.status).toBe(200);
      expect(made.body.state).toBe('UNDER_REVIEW');
      const shown = await get(`/reports/${made.body.reportId}`, a.p);
      expect(shown.status).toBe(200);
      views.push(shown.body);
      expect(await attemptStatus(a.id)).toBe('QUALITY_HOLD'); // report generation never moves a held attempt
    }
    const strip = (v) => ({ ...v, reportId: 'x' });
    expect(strip(views[0])).toEqual(strip(views[1]));
    expect(views[0]).toEqual({ reportId: views[0].reportId, state: 'UNDER_REVIEW', sections: [{ type: 'UNDER_REVIEW', locale: 'en', contentVersion: 't11-v1', order: 1, content: T11 }] });
    expect(JSON.stringify(views)).not.toMatch(/Q0\d|CRITICAL|severity|safeguard|flag|hold|risk|detector/i);
  });

  test('B07-013 T12 carries the fixed copy and no reason - not even for an invalid attempt that also carries a safeguarding flag', async () => {
    const plain = await terminalAttempt('INVALID');
    const flagged = await terminalAttempt('INVALID', { q09: true });
    expect(await attemptStatus(flagged.id)).toBe('INVALID');
    const views = [];
    for (const a of [plain, flagged]) {
      const made = await generate(a.id);
      expect(made.body.state).toBe('NOT_ELIGIBLE');
      views.push((await get(`/reports/${made.body.reportId}`, a.p)).body);
    }
    expect({ ...views[0], reportId: 'x' }).toEqual({ ...views[1], reportId: 'x' });
    expect(views[0].sections).toEqual([{ type: 'NOT_ELIGIBLE', locale: 'en', contentVersion: 't12-v1', order: 1, content: T12 }]);
    expect(JSON.stringify(views)).not.toMatch(/Q0\d|CRITICAL|safeguard|flag|duplicate|mismatch/i);
  });

  test('a T11 / T12 report is complete on creation: its fingerprint covers its single section and generation is idempotent', async () => {
    const a = await terminalAttempt('QUALITY_HOLD');
    const first = (await generate(a.id)).body;
    const second = (await generate(a.id)).body;
    expect(second.reportId).toBe(first.reportId);
    const row = await reportRow(first.reportId);
    const sections = await P.sectionsOf(first.reportId);
    expect(sections).toHaveLength(1);
    expect(row).toMatchObject({ generation_status: 'UNDER_REVIEW', report_type: 'T11' });
    expect(row.content_hash).toBe(rules.fingerprint(sections));
  });
});

describe('content boundaries (BUILD 07 section 8, B07-026..033)', () => {
  test('B07-026 S0 / S1 / SH domains: the report shows the seven axes as not-enough-data and no capability interpretation', async () => {
    // the default evidence is S1 (research only) for every domain; approved wording exists but must not be used for S1 domains
    await clearRules();
    await approveRules(['C1', 'C2'].map((d) => ({ domain: d, state: 'S1', layer: 'MEANING', text: `Meaning of ${d}.` })));
    const a = await scoredAttempt({ s2: false });
    const made = await generate(a.id);
    const shown = (await get(`/reports/${made.body.reportId}`, a.p)).body;
    expect(shown.sections.map((s) => s.type)).toEqual(['PROFILE']);
    const profile = JSON.parse(shown.sections[0].content);
    expect(profile.domains).toHaveLength(7);
    expect(profile.domains.every((d) => d.score === null && d.display === 'NOT_ENOUGH_DATA' && d.message === 'Not enough data yet')).toBe(true);
    expect(scanClaims(shown)).toEqual([]);
  });

  test('B07-027/029..033 an S2 report is descriptive and cautious: no subdomain score, band label, percentile, norm, reliable change or typing', async () => {
    await clearRules();
    await P.approveWording(p.currentSet().setId, { text: (d, layer) => ({
      MEANING: `This domain (${d}) explores how you notice and work with your body and energy.`,
      PATTERN: `Your responses describe how often you use these capabilities in everyday situations (${d}).`,
      STRENGTH: `You reported using several capabilities fairly often (${d}).`,
      GROWTH: `A capability that may be useful to develop further is pausing before you respond (${d}).`,
    })[layer] });
    const a = await scoredAttempt({ s2: true });
    const made = await generate(a.id);
    const shown = (await get(`/reports/${made.body.reportId}`, a.p)).body;
    const layers = ['MEANING', 'PATTERN', 'STRENGTH', 'GROWTH'];
    expect(shown.sections.map((s) => [s.type, s.domain || null])).toEqual([['PROFILE', null], ...p.DOMAINS.flatMap((d) => layers.map((l) => [l, d]))]);
    expect(shown.sections.map((s) => s.order)).toEqual(shown.sections.map((_, i) => i + 1));
    expect(shown.sections.every((s) => s.locale === 'en' && typeof s.contentVersion === 'string')).toBe(true);
    const profile = JSON.parse(shown.sections[0].content);
    expect(profile.scale).toEqual({ min: 1, max: 5 });
    expect(profile.domains.map((d) => d.code)).toEqual(p.DOMAINS);
    expect(profile.domains.every((d) => d.display === 'PLOTTED' && d.score === 3 && d.completeness === 1 && d.completenessStatus === 'COMPLETE')).toBe(true);
    expect(scanClaims(shown)).toEqual([]);
    expect(JSON.stringify(shown)).not.toMatch(/subdomain|percentile|norm|reliable/i);
    expect(shown.sections.map((s) => s.type)).not.toEqual(expect.arrayContaining(['PRIORITY', 'ACTION'])); // hidden until the development release
  });

  test('a domain without enough answers is shown as not-enough-data (never plotted at the scale minimum) and gets no interpretation', async () => {
    const a = await scoredAttempt({ s2: true, value: (i) => (i.domainCode === 'C1' ? null : 3) });
    const made = await generate(a.id);
    expect(made.body.state).toBe('REPORT_READY');
    const shown = (await get(`/reports/${made.body.reportId}`, a.p)).body;
    const profile = JSON.parse(shown.sections[0].content);
    const c1 = profile.domains.find((d) => d.code === 'C1');
    expect(c1).toMatchObject({ display: 'NOT_ENOUGH_DATA', score: null, completeness: null });
    expect(profile.domains.filter((d) => d.display === 'PLOTTED')).toHaveLength(6);
    expect(shown.sections.filter((s) => s.domain === 'C1')).toEqual([]);
    expect(JSON.stringify(profile)).not.toMatch(/"score":1[,}]/);
  });

  test('B07-078 a domain at S2 with a missing layer of approved wording FAILS THE WHOLE REPORT CLOSED, and a retry after the wording is approved completes it', async () => {
    await clearRules();
    await P.approveWording(p.currentSet().setId, { domains: p.DOMAINS.filter((d) => d !== 'C2') });
    await P.approveWording(p.currentSet().setId, { domains: ['C2'], layers: ['MEANING', 'PATTERN', 'STRENGTH'] }); // C2 GROWTH is missing
    const a = await scoredAttempt({ s2: true });
    const made = await generate(a.id);
    expect(made.body.state).toBe('FAILED_RETRYABLE');
    const row = await reportRow(made.body.reportId);
    expect(row).toMatchObject({ generation_status: 'FAILED_RETRYABLE', last_error_code: 'WORDING_MISSING', content_hash: null });
    expect(await count('report_sections', { report_id: made.body.reportId })).toBe(0); // no partial report is stored
    expect(await attemptStatus(a.id)).toBe('SCORED');
    expect((await get(`/reports/${made.body.reportId}`, a.p)).body.error.code).toBe('REPORT_NOT_READY');
    expect(JSON.stringify((await (await H.admin()).collection('audit_logs').find({ target_id: made.body.reportId }).toArray()))).not.toMatch(/GROWTH|C2/); // no wording detail leaks into the audit trail

    await P.approveWording(p.currentSet().setId, { domains: ['C2'], layers: ['GROWTH'] });
    const retried = await internal('post', `/internal/reports/${made.body.reportId}/retry`, {});
    expect(retried.body).toMatchObject({ state: 'REPORT_READY', retryCount: 1 });
  });

  test('the content_hash is the fingerprint of the ordered stored sections', async () => {
    const a = await scoredAttempt({ s2: true });
    const made = await generate(a.id);
    const row = await reportRow(made.body.reportId);
    expect(row.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.content_hash).toBe(rules.fingerprint(await P.sectionsOf(made.body.reportId)));
  });

  test('PRIORITY and ACTION sections are generated but stay hidden until the development release switch is ON', async () => {
    await p.approveRules(['C1', 'C2'].map((d) => ({ domain: d, layer: 'PRIORITY', text: `A capability I may want to strengthen (${d}).` })));
    const a = await scoredAttempt({ s2: true });
    const made = await generate(a.id);
    const stored = (await P.sectionsOf(made.body.reportId)).filter((s) => ['PRIORITY', 'ACTION'].includes(s.section_type));
    expect(stored.map((s) => [s.section_type, s.domain_code, s.is_released_to_participant])).toEqual([['PRIORITY', 'C1', false], ['PRIORITY', 'C2', false]]);
    const hidden = (await get(`/reports/${made.body.reportId}`, a.p)).body;
    expect(hidden.sections.map((s) => s.type)).not.toContain('PRIORITY');
    await p.setSwitch('developmentRelease', true);
    const released = (await get(`/reports/${made.body.reportId}`, a.p)).body;
    expect(released.sections.filter((s) => s.type === 'PRIORITY').map((s) => s.domain)).toEqual(['C1', 'C2']);
    await p.setSwitch('developmentRelease', false);
    expect((await get(`/reports/${made.body.reportId}`, a.p)).body.sections.map((s) => s.type)).not.toContain('PRIORITY');
  });
});
